// Read-only smoke test against the actual deployed frontend/API; creates no Flow or Execution.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const settings = Object.fromEntries((await readFile(new URL('.env', import.meta.url), 'utf8'))
  .split(/\r?\n/).filter(line => /^[A-Z_0-9]+=/.test(line)).map(line => {
    const split = line.indexOf('=');
    return [line.slice(0, split), line.slice(split + 1)];
  }));
const evidence = new URL('../../.local/cea/browser/', import.meta.url);
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const logCounts = {};
const catalogCounts = {};
const page = await browser.newPage({ baseURL: 'http://127.0.0.1:' + settings.CEA_HTTP_PORT, viewport: { width: 1440, height: 1000 } });
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto('http://127.0.0.1:' + settings.CEA_HTTP_PORT);
  await page.getByLabel('账号', { exact: true }).fill(settings.BACKEND_USER);
  await page.getByLabel('密码', { exact: true }).fill(settings.BACKEND_PASSWORD);
  await page.getByRole('button', { name: '连接工作空间 →', exact: true }).click();
  await expect(page.getByRole('heading', { name: '流程', exact: true })).toBeVisible();
  for (const flow of ['fedavg', 'fedprox']) {
    await expect(page.getByRole('button', { name: flow, exact: true })).toBeVisible();
  }
  await page.screenshot({ path: fileURLToPath(new URL('flows.png', evidence)), fullPage: true });
  const authHeaders = { Authorization: 'Basic ' + Buffer.from(settings.BACKEND_USER + ':' + settings.BACKEND_PASSWORD).toString('base64') };
  const catalogPages = [
    ['应用与镜像', '/applications', 'applications'], ['集群资源', '/resources/clusters', 'clusters'],
    ['数据集', '/resources/datasets', 'datasets'], ['边缘网关', '/edge/gateways', 'gateways'],
    ['终端设备', '/edge/terminals', 'terminals'], ['边缘处理策略', '/edge/policies', 'policies'],
    ['卸载观测', '/offloading/samples', 'observations'],
  ];
  for (const [title, path, key] of catalogPages) {
    const response = await page.request.get('/api/namespaces/lab' + path + '?limit=20&offset=0', { headers: authHeaders });
    expect(response.status()).toBe(200);
    const rows = await response.json(); catalogCounts[key] = rows.length;
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: title, exact: true }).click();
    await expect(page.locator('h1')).toHaveText(title);
    await expect(page.locator('.table-wrap tbody tr')).toHaveCount(rows.length);
    if (!rows.length) await expect(page.locator('.empty h2')).toHaveText('暂无记录');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.screenshot({path: fileURLToPath(new URL('management-' + key + '.png', evidence)), fullPage: true});
    if (rows.length && ['applications', 'datasets'].includes(key)) {
      await page.locator('.table-wrap tbody tr').first().getByRole('button', {name: '详情 →', exact: true}).click();
      await expect(page.getByLabel(key === 'applications' ? '应用 ID' : '数据集 ID', {exact: true})).toBeDisabled();
      await expect(page.getByRole('alert')).toHaveCount(0);
      await page.screenshot({path: fileURLToPath(new URL('management-' + key + '-detail.png', evidence)), fullPage: true});
    }
  }
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '应用部署', exact: true }).click();
  const clustersResponse = await page.request.get('/api/namespaces/lab/resources/clusters?limit=100', { headers: authHeaders });
  expect(clustersResponse.status()).toBe(200);
  for (const cluster of await clustersResponse.json()) {
    const response = await page.request.get('/api/namespaces/lab/clusters/' + encodeURIComponent(cluster.id) + '/deployments', { headers: authHeaders });
    expect(response.status()).toBe(200);
    const rows = await response.json(); catalogCounts['deployments/' + cluster.id] = rows.length;
    await page.getByLabel('执行集群', {exact: true}).selectOption(cluster.id);
    await expect(page.getByRole('button', {name: '↻ 刷新状态', exact: true})).toBeEnabled();
    await expect(page.locator('.table-wrap tbody tr')).toHaveCount(rows.length);
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  await page.screenshot({path: fileURLToPath(new URL('management-deployments.png', evidence)), fullPage: true});
  await page.getByRole('navigation', {name: '主导航'}).getByRole('button', {name: '流程', exact: true}).click();
  for (const flow of ['fedavg', 'fedprox']) {
    await page.getByRole('button', { name: flow, exact: true }).click();
    await expect(page.getByLabel('Flow YAML')).toHaveValue(/core\.Loop/);
    await expect(page.getByRole('tab', { name: '可视化编排', exact: true })).toHaveAttribute('aria-selected', 'true');
    const savedSource = await page.getByLabel('Flow YAML').inputValue();
    await page.locator('[data-task="init"] > .task-card-header .task-select').click();
    const cloudChoice = page.getByRole('button', {name: /cloud · CLOUD/});
    const edgeChoice = page.getByRole('button', {name: /edge-a · EDGE/});
    await expect(cloudChoice).toHaveAttribute('aria-pressed', 'true');
    await expect(edgeChoice).toHaveAttribute('aria-pressed', 'false');
    await edgeChoice.click();
    await expect(edgeChoice).toHaveAttribute('aria-pressed', 'true');
    await expect(edgeChoice).toHaveCSS('background-color', 'rgb(100, 54, 187)');
    await page.getByRole('group', {name: '候选集群选择'}).screenshot({path: fileURLToPath(new URL(flow + '-cluster-selection.png', evidence))});
    await page.setViewportSize({width: 650, height: 900});
    await page.getByRole('group', {name: '候选集群选择'}).screenshot({path: fileURLToPath(new URL(flow + '-cluster-selection-narrow.png', evidence))});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await edgeChoice.click();
    await expect(edgeChoice).toHaveAttribute('aria-pressed', 'false');
    // Discard only this test's local draft; never save or submit against CEA.
    await page.getByRole('tab', {name: '源代码', exact: true}).click();
    await page.getByLabel('Flow YAML').fill(savedSource);
    await page.getByRole('tab', {name: '可视化编排', exact: true}).click();
    await page.setViewportSize({width: 1440, height: 1000});
    await page.locator('[data-task="train"] > .task-card-header .task-select').click();
    await expect(page.locator('.task-inspector h2')).toHaveText('train');
    await expect(page.getByLabel('应用与版本')).toBeVisible();
    await expect(page.getByText(/目录读取失败/)).toHaveCount(0);
    await page.screenshot({path: fileURLToPath(new URL(flow + '-no-code.png', evidence))});
    const original = await page.getByLabel('Flow YAML').inputValue();
    await page.getByRole('tab', {name: '并排编辑', exact: true}).click();
    await expect(page.getByLabel('Flow YAML')).toHaveValue(original);
    await page.screenshot({path: fileURLToPath(new URL(flow + '-split.png', evidence))});
    console.log(JSON.stringify({flow, layout: await page.evaluate(() => ({width: innerWidth, height: innerHeight, documentHeight: document.documentElement.scrollHeight, documentWidth: document.documentElement.scrollWidth}))}));
    await page.getByRole('button', { name: '流程', exact: true }).first().click();
  }
  await page.getByRole('button', { name: '执行', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '执行', exact: true })).toBeVisible();
  for (const flow of ['fedavg', 'fedprox']) {
    const row = page.getByRole('row').filter({ hasText: flow }).filter({ hasText: 'SUCCESS' }).first();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: '详情 →', exact: true }).click();
    await page.getByRole('tab', { name: /^任务实例/ }).click();
    await expect(page.locator('td > strong').filter({ hasText: /^train$/ })).toHaveCount(6);
    await page.getByRole('tab', { name: '输出', exact: true }).click();
    await expect(page.getByTestId('execution-outputs')).toContainText('completed_rounds');
    await page.screenshot({ path: fileURLToPath(new URL(flow + '-outputs.png', evidence)), fullPage: true });
    await page.getByRole('tab', { name: '日志', exact: true }).click();
    // These Application-only Flows do not emit core.Log entries. Compare with
    // the actual API; do not manufacture logs or claim Pod stdout is integrated.
    const executions = await page.request.get('/api/namespaces/lab/executions', {
      headers: { Authorization: 'Basic ' + Buffer.from(settings.BACKEND_USER + ':' + settings.BACKEND_PASSWORD).toString('base64') }
    });
    expect(executions.status()).toBe(200);
    const execution = (await executions.json()).find(run => run.flowId === flow && run.state === 'SUCCESS');
    const logs = await page.request.get('/api/namespaces/lab/executions/' + execution.id + '/logs', {
      headers: { Authorization: 'Basic ' + Buffer.from(settings.BACKEND_USER + ':' + settings.BACKEND_PASSWORD).toString('base64') }
    });
    expect(logs.status()).toBe(200);
    logCounts[flow] = (await logs.json()).length;
    if (logCounts[flow] === 0) await expect(page.getByLabel('执行日志')).toContainText('暂无日志');
    else await expect(page.getByLabel('执行日志')).not.toContainText('暂无日志');
    await page.getByRole('button', { name: '执行', exact: true }).first().click();
  }
  expect(errors).toEqual([]);
  const result = { result: 'PASS', scope: 'real deployed frontend: read-only management catalogs/details and four-cluster deployment lists, both saved Flows, Loop YAML, both successful executions, six training instances each, outputs and log empty-state consistent with API', logCounts, catalogCounts, limitation: 'Application Pod stdout is not collected into Execution logs by the current runtime; no management writes against CEA business data', checkedAt: new Date().toISOString() };
  await writeFile(new URL('result.json', evidence), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  await page.screenshot({ path: fileURLToPath(new URL('failure.png', evidence)), fullPage: true });
  throw error;
} finally {
  await browser.close();
}
