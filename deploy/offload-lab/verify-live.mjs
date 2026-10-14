// Read-only deployment/compatibility check and screenshot; never starts experiments.
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from '../../frontend/node_modules/playwright-core/index.mjs';
import { folder, root, read, docker } from './setup.mjs';

const env = Object.fromEntries(readFileSync(`${root}/deploy/cea/.env`, 'utf8').split(/\r?\n/).filter(l => /^[A-Z_0-9]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const headers = { Authorization: 'Basic ' + Buffer.from(`${env.BACKEND_USER}:${env.BACKEND_PASSWORD}`).toString('base64') };
const base = `http://127.0.0.1:${env.CEA_API_PORT}`;
const get = async path => {
  const response = await fetch(base + '/api/namespaces/lab' + path, { headers, signal: AbortSignal.timeout(20000) });
  assert(response.ok, `${path}: ${response.status}`);
  return response.json();
};
const devices = await get('/edge/offload-lab/devices');
assert.equal(devices.length, 30);
assert(devices.every(d => d.resource && Date.now() / 1000 - d.resource.sampledAt < 15));
const runs = await get('/edge/offload-lab/runs');
const before = read(`${folder}/before.json`), flows = [];
for (let offset = 0;; offset += 100) {
  const page = await get(`/flows?limit=100&offset=${offset}`);
  flows.push(...page); if (page.length < 100) break;
}
assert.deepEqual(flows, before.flows, 'existing Flow definitions must not change');
const preserved = before.services.filter(s => !['/cea-backend-1', '/cea-frontend-1'].includes(s.name));
const now = JSON.parse(docker(['inspect', ...preserved.map(s => s.name)]));
for (const old of preserved) {
  const current = now.find(s => s.Name === old.name);
  assert(current && current.Id === old.id && current.State.StartedAt === old.startedAt, `unrelated service restarted: ${old.name}`);
}
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${env.CEA_HTTP_PORT || 18080}`);
  await page.getByLabel('账号', { exact: true }).fill(env.BACKEND_USER);
  await page.getByLabel('密码', { exact: true }).fill(env.BACKEND_PASSWORD);
  await page.getByRole('button', { name: '连接工作空间 →', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: '终端设备接入', exact: true }).click();
  await page.getByRole('cell', { name: 'oil-terminal-030', exact: true }).waitFor();
  await page.getByRole('button', { name: '负载与调度', exact: true }).click();
  await page.getByRole('heading', { name: '单任务端到端耗时' }).waitFor();
  await page.waitForTimeout(3500);
  const widths = await page.locator('.offload-lab .bar > div').evaluateAll(items => items.map(e => e.getBoundingClientRect().width / e.parentElement.getBoundingClientRect().width));
  const latest = runs[0] ? await get('/edge/offload-lab/runs/' + runs[0].id) : null;
  if (latest?.summary.submitted) {
    for (const [index, destination] of ['TERMINAL', 'EDGE', 'CLOUD'].entries())
      assert(Math.abs(widths[index] - latest.summary.destinations[destination] / latest.summary.submitted) < .005, 'destination bar differs from counts');
  }
  await page.screenshot({ path: `${folder}/live-page.png`, fullPage: true });
  assert.equal(await page.getByRole('alert').count(), 0);
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
const evidence = { at: new Date().toISOString(), devices: devices.length, runs: runs.map(r => ({ id: r.id, state: r.state, cleanup: r.cleanup })), preservedServices: preserved.length, preservedFlows: flows.length, realPage: 'PASS' };
writeFileSync(`${folder}/live-verification.json`, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));
