// Read-only NAV-01b release check. Reads local credentials but never writes them to evidence.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium, expect } from '../../frontend/node_modules/@playwright/test/index.mjs';

const root = resolve(import.meta.dirname, '../..');
const directory = resolve(root, '.local/nav01b');
mkdirSync(directory, { recursive: true });
const settings = Object.fromEntries(readFileSync(resolve(import.meta.dirname, '.env'), 'utf8')
  .split(/\r?\n/).filter((line) => /^[A-Z_0-9]+=/.test(line)).map((line) => {
    const p = line.indexOf('='); return [line.slice(0, p), line.slice(p + 1)];
  }));
const url = `http://127.0.0.1:${settings.CEA_HTTP_PORT || 18080}`;
const headers = { Authorization: 'Basic ' + Buffer.from(`${settings.BACKEND_USER}:${settings.BACKEND_PASSWORD}`).toString('base64') };
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', windowsHide: true }).trim();
async function api(path) {
  const r = await fetch(`${url}/api/namespaces/lab${path}`, { headers });
  if (!r.ok) throw new Error(`Read ${path}: HTTP ${r.status}`);
  return r.json();
}
async function list(path) {
  const all = [];
  for (let offset = 0;; offset += 100) {
    const rows = await api(`${path}?limit=100&offset=${offset}`);
    all.push(...rows);
    if (rows.length < 100) return all;
  }
}
async function snapshot() {
  const ids = docker('ps', '-aq', '--filter', 'label=com.docker.compose.project=cea').split(/\s+/);
  const containers = JSON.parse(docker('inspect', ...ids)).map((c) => ({
    name: c.Name, id: c.Id, image: c.Image, started: c.State.StartedAt,
    running: c.State.Running, health: c.State.Health?.Status,
  })).sort((a,b) => a.name.localeCompare(b.name));
  const objects = {};
  for (const path of ['/flows', '/executions', '/applications', '/resources/datasets', '/edge/policies']) objects[path] = await list(path);
  return { at: new Date().toISOString(), containers, objects };
}
if (process.argv.includes('--snapshot')) {
  const before = await snapshot();
  writeFileSync(resolve(directory, 'before.json'), JSON.stringify(before, null, 2));
  console.log('Saved read-only release snapshot:', before.containers.length, 'CEA services.');
} else {
  const before = JSON.parse(readFileSync(resolve(directory, 'before.json'), 'utf8'));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], writes = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => { if (r.url().includes('/api/') && r.method() !== 'GET') writes.push(r.method()); });
    await page.goto(url);
    await page.getByLabel('账号', { exact: true }).fill(settings.BACKEND_USER);
    await page.getByLabel('密码', { exact: true }).fill(settings.BACKEND_PASSWORD);
    await page.getByRole('button', { name: '连接工作空间 →', exact: true }).click();
    const nav = (name) => page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
    await expect(page.locator('.brand strong')).toHaveText('云边端协同数据流处理系统');
    await expect(page.locator('.nav-caption').first()).toHaveCSS('font-size', '16px');
    await expect(page.locator('.nav-caption').first()).toHaveCSS('font-weight', '700');
    await expect(page.locator('.nav-caption').first()).toHaveCSS('color', 'rgb(228, 220, 241)');
    await expect(page).toHaveTitle('云边端协同数据流处理系统');
    const menus = ['运行总览', '数据流编排', '数据流执行记录', '数据集管理', '应用与镜像', '镜像仓库', '边缘服务部署', '服务与访问入口', '任务卸载决策记录', '应用分发记录', '边缘数据处理策略', '边缘数据处理记录', '集群管理', '集群运行资源', '边缘网关管理', '终端设备接入', '用户管理', '个人中心'];
    await expect(page.getByRole('navigation').getByRole('button')).toHaveText(menus);
    await expect(page.getByRole('navigation').locator('[aria-current="page"]')).toHaveCSS('font-weight', '700');
    await expect(page.getByRole('navigation').getByRole('button', { name: '运行总览', exact: true })).toHaveCSS('font-weight', '400');
    for (const name of menus) {
      await nav(name); await expect(page.locator('h1')).toHaveText(name);
      if (name === '用户管理') await expect(page.getByRole('button', { name: '＋ 新建用户', exact: true })).toBeEnabled();
    }
    await nav('服务与访问入口');
    await expect(page.getByRole('tab')).toHaveText(['Service', 'Ingress']);
    for (const cluster of ['cloud', 'edge-a', 'edge-b', 'edge-c']) {
      await page.getByLabel('资源集群').selectOption(cluster);
      await page.getByRole('tab', { name: 'Service', exact: true }).click();
      await expect(page.getByRole('table', { name: 'Service', exact: true })).toBeVisible();
      await page.getByRole('tab', { name: 'Ingress', exact: true }).click();
      await expect(page.getByRole('table', { name: 'Ingress', exact: true })).toContainText('ing01-http-demo');
    }
    await nav('应用分发记录');
    let checked;
    for (const app of before.objects['/applications']) {
      const records = await api(`/applications/${encodeURIComponent(app.applicationId)}/versions/${encodeURIComponent(app.version)}/preparations?limit=20&offset=0`);
      if (!records.length) continue;
      checked = `${app.applicationId}/${app.version}`;
      await page.getByLabel('分发记录应用版本').selectOption(checked);
      await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(records.length);
      await expect(page.getByRole('table')).toContainText(records[0].clusterId);
      await page.screenshot({ path: resolve(directory, 'distributions.png'), fullPage: true });
      break;
    }
    expect(checked).toBeTruthy();
    await nav('集群运行资源');
    await expect(page.getByRole('tab')).toHaveText(['节点', 'Kubernetes Namespace']);
    await nav('运行总览');
    await expect(page.locator('h1')).toHaveText('运行总览');
    await expect(page.getByRole('button', { name: '刷新总览', exact: true })).toBeEnabled();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.locator('.sidebar nav').evaluate((el) => { el.scrollTop = 0; });
    await page.mouse.move(600, 70);
    await page.screenshot({ path: resolve(directory, 'desktop.png'), fullPage: true });
    await page.locator('.sidebar').screenshot({ path: resolve(directory, 'sidebar.png') });
    await page.setViewportSize({ width: 900, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await nav('个人中心');
    await expect(page.getByRole('navigation').getByRole('button')).toHaveText(menus);
    await expect(page.getByRole('navigation').locator('[aria-current="page"]')).toBeInViewport();
    await expect(page.locator('.brand strong span')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: resolve(directory, 'narrow.png'), fullPage: true });
    expect(errors).toEqual([]); expect(writes).toEqual([]);
    const after = await snapshot();
    expect(after.objects).toEqual(before.objects);
    const untouched = before.containers.filter((c) => c.name !== '/cea-frontend-1');
    for (const c of untouched) {
      const current = after.containers.find((row) => row.name === c.name);
      expect(current.id).toBe(c.id); expect(current.started).toBe(c.started);
      expect(current.running).toBe(true);
    }
    expect(after.containers.find((c) => c.name === '/cea-frontend-1').health).toBe('healthy');
    const result = { status: 'PASS', at: after.at, menus, checkedDistribution: checked,
      preservedServices: untouched.length, objects: Object.fromEntries(Object.entries(after.objects).map(([k,v]) => [k,v.length])),
      frontend: after.containers.find((c) => c.name === '/cea-frontend-1'), errors, writes };
    writeFileSync(resolve(directory, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
}
