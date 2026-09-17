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
const metricsEvidence = {};
const inspectionEvidence = {};
const operationsEvidence = {usage: {}, preparations: {}};
const podUsageRequests = [];
const page = await browser.newPage({ baseURL: 'http://127.0.0.1:' + settings.CEA_HTTP_PORT, viewport: { width: 1440, height: 1000 } });
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  if (request.url().includes('/kubernetes/usage/pods')) podUsageRequests.push(request.url());
});
try {
  await page.goto('http://127.0.0.1:' + settings.CEA_HTTP_PORT);
  await page.getByLabel('账号', { exact: true }).fill(settings.BACKEND_USER);
  await page.getByLabel('密码', { exact: true }).fill(settings.BACKEND_PASSWORD);
  await page.getByRole('button', { name: '连接工作空间 →', exact: true }).click();
  await expect(page.getByRole('heading', { name: '数据流编排', exact: true })).toBeVisible();
  for (const flow of ['fedavg', 'fedprox']) {
    await expect(page.getByRole('button', { name: flow, exact: true })).toBeVisible();
  }
  await page.screenshot({ path: fileURLToPath(new URL('flows.png', evidence)), fullPage: true });
  const authHeaders = { Authorization: 'Basic ' + Buffer.from(settings.BACKEND_USER + ':' + settings.BACKEND_PASSWORD).toString('base64') };
  await page.getByRole('navigation', {name: '主导航'}).getByRole('button', {name: '运行总览', exact: true}).click();
  const summaryResponse = await page.request.get('/api/namespaces/lab/executions/overview?days=7', {headers: authHeaders});
  expect(summaryResponse.status()).toBe(200);
  const summary = await summaryResponse.json();
  inspectionEvidence.overview = summary;
  await expect(page.locator('[data-count="执行总数"]')).toHaveText(String(summary.days.reduce((sum, row) => sum + row.count, 0)));
  await page.screenshot({path: fileURLToPath(new URL('overview.png', evidence)), fullPage: true});
  await page.setViewportSize({width: 390, height: 1000});
  await page.getByLabel('总览时间范围').selectOption('30');
  await expect(page.locator('.daily-column')).toHaveCount(30);
  await expect(page.locator('.daily-column').last()).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: fileURLToPath(new URL('overview-narrow.png', evidence)), fullPage: true});
  await page.setViewportSize({width: 1440, height: 1000});
  await page.getByRole('navigation', {name: '主导航'}).getByRole('button', {name: '集群运行资源', exact: true}).click();
  inspectionEvidence.clusters = {};
  for (const cluster of ['cloud', 'edge-a', 'edge-b', 'edge-c']) {
    await page.getByLabel('资源集群').selectOption(cluster);
    const rows = {};
    for (const [endpoint, title] of [['nodes', '节点'], ['services', 'Service'], ['namespace', 'Kubernetes Namespace']]) {
      await page.getByRole('navigation', {name: '主导航'}).getByRole('button', {name: endpoint === 'services' ? '服务与访问入口' : '集群运行资源', exact: true}).click();
      await page.getByLabel('资源集群').selectOption(cluster);
      const suffix = endpoint === 'namespace' ? 'namespaces' : endpoint === 'services' ? 'namespaces/cea-lab/services' : endpoint;
      const response = await page.request.get('/api/namespaces/lab/clusters/' + cluster + '/kubernetes/' + suffix, {headers: authHeaders});
      expect(response.status()).toBe(200);
      const value = await response.json(); rows[endpoint] = value;
      await page.getByRole('tab', {name: title, exact: true}).click();
      await expect(page.getByRole('table', {name: title, exact: true}).locator('tbody tr')).toHaveCount(endpoint === 'nodes' ? value.items.length : value.length);
      if (endpoint === 'namespace') {
        expect(value.find(row => row.executionDefault).name).toBe('cea-lab');
        await expect(page.getByRole('table', {name: title, exact: true})).toContainText('cea-lab');
      } else if (endpoint === 'nodes') {
        expect(value.items.length).toBeGreaterThan(0);
        await expect(page.getByRole('table', {name: title, exact: true})).toContainText(value.items[0].name);
      }
    }
    inspectionEvidence.clusters[cluster] = rows;
  }
  await page.screenshot({path: fileURLToPath(new URL('kubernetes-resources.png', evidence)), fullPage: true});
  await page.getByRole('navigation', {name: '主导航'}).getByRole('button', {name: '数据流编排', exact: true}).click();
  // SELECT deployment probe: edit/validate/preview a draft only; never save or execute it in CEA.
  const selectId = 'ui-select-readonly';
  const selectSource = (await readFile(new URL('../../examples/select-input.yaml', import.meta.url), 'utf8'))
    .replace('id: select-input', 'id: ' + selectId);
  await page.getByRole('button', {name: '＋ 新建流程', exact: true}).click();
  await page.getByLabel('流程 ID', {exact: true}).fill(selectId);
  await page.getByRole('tab', {name: '源代码', exact: true}).click();
  await page.getByLabel('Flow YAML').fill(selectSource);
  await page.getByRole('tab', {name: '可视化编排', exact: true}).click();
  await page.getByRole('button', {name: '流程设置', exact: true}).click();
  await expect(page.locator('[data-field="inputs.region.type"] > select')).toHaveValue('SELECT');
  await expect(page.locator('[data-field="inputs.region.defaultValue"] > select')).toHaveValue('edge-a');
  await expect(page.locator('[data-field="inputs.region.values"] > .array-fields > .schema-field')).toHaveCount(3);
  await page.getByRole('button', {name: '✓ 校验', exact: true}).click();
  await expect(page.getByRole('status')).toContainText('校验通过');
  await page.screenshot({path: fileURLToPath(new URL('select-definition.png', evidence))});
  for (const [region, status] of [['cloud', 200], ['outside-options', 422]]) {
    const preview = await page.request.post('/api/namespaces/lab/flows/' + selectId + '/preview', {
      headers: authHeaders, data: {source: selectSource, inputs: {region}}
    });
    expect(preview.status()).toBe(status);
    if (status === 200) expect((await preview.json()).inputs.region).toBe('cloud');
  }
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('navigation', {name: '主导航'}).getByRole('button', {name: '数据流编排', exact: true}).click();
  const catalogPages = [
    ['应用与镜像', '/applications', 'applications'], ['集群管理', '/resources/clusters', 'clusters'],
    ['数据集管理', '/resources/datasets', 'datasets'], ['边缘网关管理', '/edge/gateways', 'gateways'],
    ['终端设备接入', '/edge/terminals', 'terminals'], ['边缘数据处理策略', '/edge/policies', 'policies'],
    ['任务卸载决策记录', '/offloading/samples', 'observations'],
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
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '边缘服务部署', exact: true }).click();
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
  await page.getByRole('navigation', {name: '主导航'}).getByRole('button', {name: '数据流编排', exact: true}).click();
  for (const flow of ['fedavg', 'fedprox']) {
    await page.getByRole('button', { name: flow, exact: true }).click();
    await expect(page.getByLabel('Flow YAML')).toHaveValue(/core\.Loop/);
    await expect(page.getByRole('tab', { name: '可视化编排', exact: true })).toHaveAttribute('aria-selected', 'true');
    const savedSource = await page.getByLabel('Flow YAML').inputValue();
    await page.locator('[data-task="clients"] > .task-card-header .task-select').click();
    const loopValues = page.locator('.loop-values-field');
    const loopValuesField = loopValues.locator('..');
    await expect(loopValuesField.locator(':scope > .field-heading .required')).toBeVisible();
    await expect(loopValuesField.locator('..')).toHaveJSProperty('tagName', 'FIELDSET');
    await expect(page.locator('.task-inspector [data-task-identity="type"] input')).toHaveValue('core.Loop');
    await expect(page.locator('.task-inspector [data-task-identity="id"] input')).toHaveValue('clients');
    await expect(loopValues.getByRole('button', {name: 'Array', exact: true})).toHaveCount(0);
    await expect(loopValues.getByLabel('集合来源')).toHaveValue('LITERAL');
    await expect(loopValues.locator('[data-loop-item]')).toHaveCount(3);
    expect(JSON.parse(await loopValues.getByLabel('第 1 项', {exact: true}).inputValue())).toEqual({id: 'edge-a', clusters: ['edge-a']});
    await expect(loopValues.locator('[data-loop-item] textarea')).toHaveCount(3);
    await expect(loopValues.locator('[data-loop-item] select')).toHaveCount(0);
    await page.screenshot({path: fileURLToPath(new URL(flow + '-loop-values.png', evidence))});
    await page.setViewportSize({width: 650, height: 900});
    await loopValues.screenshot({path: fileURLToPath(new URL(flow + '-loop-values-narrow.png', evidence))});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.setViewportSize({width: 1440, height: 1000});
    await page.getByRole('button', {name: '流程设置', exact: true}).click();
    await expect(page.locator('[data-field="inputs.clients"]')).toHaveCount(0);
    await page.getByRole('button', {name: '▷ 执行', exact: true}).click();
    await expect(page.locator('.run-panel')).not.toContainText('clients');
    await expect(page.locator('select#input-training_dataset')).toHaveValue('mnist-train/v1');
    await expect(page.locator('select#input-test_dataset')).toHaveValue('mnist-test/v1');
    await page.screenshot({path: fileURLToPath(new URL(flow + '-dataset-select.png', evidence)), fullPage: true});
    await page.getByRole('button', {name: '关闭执行参数', exact: true}).click();
    await page.locator('[data-task="init"] > .task-card-header .task-select').click();
    const cloudChoice = page.getByRole('button', {name: /cloud · CLOUD/});
    const edgeChoice = page.getByRole('button', {name: /edge-a · EDGE/});
    await expect(cloudChoice).toHaveAttribute('aria-pressed', 'true');
    await expect(edgeChoice).toHaveAttribute('aria-pressed', 'false');
    await edgeChoice.click();
    await expect(edgeChoice).toHaveAttribute('aria-pressed', 'true');
    await edgeChoice.hover();
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
    await page.getByRole('button', { name: '数据流编排', exact: true }).first().click();
  }
  await page.getByRole('button', { name: '数据流执行记录', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '数据流执行记录', exact: true })).toBeVisible();
  for (const flow of ['fedavg', 'fedprox']) {
    const row = page.getByRole('row').filter({ hasText: flow }).filter({ hasText: 'SUCCESS' }).first();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: '详情 →', exact: true }).click();
    await page.getByRole('tab', { name: /^任务实例/ }).click();
    await expect(page.locator('td > strong').filter({ hasText: /^train$/ })).toHaveCount(6);
    const currentId = (await page.locator('.execution-id').textContent()).trim();
    const taskResponse = await page.request.get('/api/namespaces/lab/executions/' + currentId + '/tasks', {headers: authHeaders});
    expect(taskResponse.status()).toBe(200);
    const taskRuns = await taskResponse.json();
    await page.getByRole('tab', {name: '拓扑', exact: true}).click();
    await expect(page.locator('[data-task="init"]')).toHaveAttribute('data-state', 'SUCCESS');
    await expect(page.locator('[data-edge="init->rounds"]')).toHaveCount(1);
    await page.getByRole('button', {name: '展开 rounds', exact: true}).click();
    await page.getByLabel('迭代实例', {exact: true}).selectOption('2');
    await page.screenshot({path: fileURLToPath(new URL(flow + '-round-topology.png', evidence)), fullPage: true});
    const clients = taskRuns.find(task => task.taskId === 'clients' && task.iteration === 2);
    const train = taskRuns.find(task => task.taskId === 'train' && task.parentTaskRunId === clients.id && task.iteration === 3);
    await page.getByRole('button', {name: '展开 clients', exact: true}).click();
    await page.getByLabel('迭代实例', {exact: true}).selectOption('3');
    await expect(page.getByTestId('graph-item')).toContainText('edge-c');
    await page.getByRole('button', {name: '查看 train 实例', exact: true}).click();
    await expect(page.getByLabel('任务实例详情')).toContainText(train.id);
    expect(JSON.parse(await page.getByTestId('task-outputs').textContent())).toEqual(train.outputs);
    await expect(page.getByTestId('task-duration')).toHaveText(((Date.parse(train.endedAt) - Date.parse(train.startedAt)) / 1000).toFixed(2) + ' s');
    await expect(page.locator('.attempt')).toContainText('SUCCESS');
    await page.screenshot({path: fileURLToPath(new URL(flow + '-task-graph.png', evidence)), fullPage: true});
    await page.setViewportSize({width: 650, height: 1000});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path: fileURLToPath(new URL(flow + '-task-graph-narrow.png', evidence)), fullPage: true});
    await page.setViewportSize({width: 1440, height: 1000});
    await page.getByRole('tab', {name: 'Metrics', exact: true}).click();
    await expect(page.getByLabel('指标任务', {exact: true})).toHaveValue('evaluate');
    await expect(page.getByLabel('指标产物', {exact: true})).toHaveValue('metrics.json');
    const evaluations = taskRuns.filter(task => task.taskId === 'evaluate' && task.state === 'SUCCESS');
    expect(evaluations).toHaveLength(2);
    const actualMetrics = [];
    for (const task of evaluations) {
      const response = await page.request.get('/api/namespaces/lab/executions/' + currentId + '/tasks/' + task.id + '/output-json?port=metrics.json', {headers: authHeaders});
      expect(response.status()).toBe(200);
      actualMetrics.push({taskRunId: task.id, iteration: task.iteration, values: await response.json()});
    }
    await expect(page.getByRole('button', {name: '刷新指标', exact: true})).toBeEnabled();
    for (const name of ['accuracy', 'loss', 'samples', 'round']) {
      await page.getByLabel('指标名称', {exact: true}).selectOption(name);
      await expect(page.locator('.metric-bar')).toHaveCount(evaluations.length);
      for (const entry of actualMetrics) {
        expect(Number.isFinite(entry.values[name])).toBe(true);
        await expect(page.locator('.metric-bar[data-task-run="' + entry.taskRunId + '"]')).toHaveAttribute('data-value', String(entry.values[name]));
        const metricRow = page.getByRole('table', {name: '指标明细'}).getByRole('row').filter({hasText: entry.taskRunId});
        await expect(metricRow.getByRole('cell').nth(2)).toHaveText(String(entry.values[name]));
        await expect(metricRow).toContainText('rounds[' + entry.iteration + ']');
        await expect(metricRow).toContainText('algorithm: ' + flow);
      }
    }
    await page.getByLabel('指标名称', {exact: true}).selectOption('accuracy');
    await page.getByRole('button', {name: '刷新指标', exact: true}).click();
    await expect(page.getByRole('button', {name: '刷新指标', exact: true})).toBeEnabled();
    await expect(page.getByLabel('指标名称', {exact: true})).toHaveValue('accuracy');
    await page.screenshot({path: fileURLToPath(new URL(flow + '-metrics.png', evidence)), fullPage: true});
    await page.setViewportSize({width: 390, height: 1000});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path: fileURLToPath(new URL(flow + '-metrics-narrow.png', evidence)), fullPage: true});
    await page.setViewportSize({width: 1440, height: 1000});
    await expect(page.getByRole('alert')).toHaveCount(0);
    metricsEvidence[flow] = {executionId: currentId, rows: actualMetrics};
    await page.getByRole('tab', { name: '输出', exact: true }).click();
    await expect(page.getByTestId('execution-outputs')).toContainText('completed_rounds');
    const artifact = page.locator('[data-artifact="' + evaluations[0].id + '/metrics.json"]');
    await artifact.getByRole('button', {name: '预览 JSON', exact: true}).click();
    await expect(page.getByTestId('artifact-json')).toBeVisible();
    expect(JSON.parse(await page.getByTestId('artifact-json').textContent())).toEqual(actualMetrics.find(row => row.taskRunId === evaluations[0].id).values);
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
    await page.getByRole('button', { name: '数据流执行记录', exact: true }).first().click();
  }
  // UI-08: read live usage/history and inspect the upload form without creating business records.
  await page.getByRole('navigation', {name: '主导航'}).getByRole('button', {name: '集群运行资源', exact: true}).click();
  for (const cluster of ['cloud', 'edge-a', 'edge-b', 'edge-c']) {
    await page.getByLabel('资源集群').selectOption(cluster);
    await page.getByRole('tab', {name: '节点', exact: true}).click();
    const nodeResponse = await page.request.get('/api/namespaces/lab/clusters/' + cluster + '/kubernetes/usage/nodes', {headers: authHeaders});
    expect(nodeResponse.status()).toBe(200);
    const nodes = await nodeResponse.json();
    expect(nodes.namespace).toBe('cea-lab');
    expect(nodes.nodes.length).toBeGreaterThan(0);
    for (const node of nodes.nodes) {
      expect(node.usage.status).toBe('AVAILABLE');
      expect(Number.isFinite(node.usage.cpuCores)).toBe(true);
      expect(Number.isFinite(node.usage.memoryBytes)).toBe(true);
      expect(node.usage.window).toMatch(/^PT/);
    }
    await expect(page.getByText(/集群 CPU 使用率 \d/)).toBeVisible();
    await expect(page.getByRole('table', {name: '节点', exact: true})).toContainText('可用');
    await page.screenshot({path: fileURLToPath(new URL('usage-' + cluster + '.png', evidence)), fullPage: true});
    await expect(page.getByRole('tablist', {name: 'Kubernetes 资源类型'}).getByRole('tab')).toHaveText(['节点', 'Kubernetes Namespace']);
    await expect(page.getByRole('tab', {name: '容器用量', exact: true})).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    operationsEvidence.usage[cluster] = {nodes};
  }
  await page.setViewportSize({width: 650, height: 1000});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: fileURLToPath(new URL('usage-narrow.png', evidence)), fullPage: true});
  await page.setViewportSize({width: 1440, height: 1000});
  await page.getByRole('navigation', {name: '主导航'}).getByRole('button', {name: '应用与镜像', exact: true}).click();
  const applications = await (await page.request.get('/api/namespaces/lab/applications?limit=100', {headers: authHeaders})).json();
  for (const app of applications) {
    const response = await page.request.get('/api/namespaces/lab/applications/' + encodeURIComponent(app.applicationId) + '/versions/' + encodeURIComponent(app.version) + '/preparations', {headers: authHeaders});
    expect(response.status()).toBe(200);
    operationsEvidence.preparations[app.applicationId + '/' + app.version] = await response.json();
  }
  await page.locator('.table-wrap tbody tr').first().getByRole('button', {name: '详情 →', exact: true}).click();
  await expect(page.getByRole('table', {name: '按需分发历史', exact: true})).toBeVisible();
  await page.screenshot({path: fileURLToPath(new URL('distribution-history.png', evidence)), fullPage: true});
  await page.getByRole('button', {name: '← 返回列表', exact: true}).click();
  await page.getByRole('button', {name: '上传镜像', exact: true}).click();
  await expect(page.locator('input[type=file]')).toBeVisible();
  await expect(page.getByLabel('镜像引用', {exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: '上传并登记', exact: true})).toBeVisible();
  await page.screenshot({path: fileURLToPath(new URL('upload-form.png', evidence)), fullPage: true});
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(podUsageRequests).toEqual([]);
  const result = { result: 'PASS', scope: 'real deployed frontend: federated metrics accuracy/loss/samples/round chart and table match authorized artifact API, round identity, refresh selection, desktop/390px; explicit federated dataset SELECT; historical execution topology, round 2/item 3 train ID/outputs/duration/attempts verified against API; unsaved SELECT validation, management catalogs and four-cluster deployment lists; both saved Flows and executions; log empty-state consistent with API', metricsEvidence, logCounts, catalogCounts, limitation: 'Application Pod stdout is not collected into Execution logs by the current runtime; no management writes against CEA business data', checkedAt: new Date().toISOString() };
  result.inspectionEvidence = inspectionEvidence;
  result.operationsEvidence = operationsEvidence;
  result.registryInventory = {};
  await page.getByRole('navigation', {name: '主导航'}).getByRole('button', {name: '镜像仓库', exact: true}).click();
  const registryList = await (await page.request.get('/api/namespaces/lab/registries', {headers: authHeaders})).json();
  expect(registryList).toHaveLength(4);
  const applicationDigests = new Map();
  for (const app of applications) {
    let digest = app.image.includes('@sha256:') ? app.image.split('@')[1] : null;
    if (!digest) {
      const source = registryList.find(registry => app.image.startsWith(registry.address + '/'));
      expect(source).toBeDefined();
      const separator = app.image.lastIndexOf(':'), repository = app.image.slice(source.address.length + 1, separator), tag = app.image.slice(separator + 1);
      const response = await page.request.get('/api/namespaces/lab/registries/' + source.id + '/images?repository=' + encodeURIComponent(repository), {headers: authHeaders});
      expect(response.status()).toBe(200);
      digest = (await response.json()).find(image => image.tags.includes(tag))?.digest;
      expect(digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
    applicationDigests.set(app.applicationId, [...(applicationDigests.get(app.applicationId) || []), digest]);
  }
  for (const registry of registryList) {
    await page.getByRole('combobox', {name: '镜像仓库', exact: true}).selectOption(registry.id);
    await expect(page.getByLabel('镜像仓库路径', {exact: true})).toBeEnabled();
    const paths = await (await page.request.get('/api/namespaces/lab/registries/' + registry.id + '/repositories', {headers: authHeaders})).json();
    const inventory = {};
    for (const repository of paths.repositories) {
      const response = await page.request.get('/api/namespaces/lab/registries/' + registry.id + '/images?repository=' + encodeURIComponent(repository), {headers: authHeaders});
      expect(response.status()).toBe(200); inventory[repository] = await response.json();
      // Inventory must not omit real digest-only copies merely because no preparation history exists.
      const candidates = new Set(applicationDigests.get(repository.slice('lab/'.length)) || []);
      for (const digest of candidates) {
        const direct = await page.request.get('/api/namespaces/lab/registries/' + registry.id + '/image?repository=' + encodeURIComponent(repository) + '&digest=' + digest, {headers: authHeaders});
        expect([200, 404]).toContain(direct.status());
        if (direct.status() === 200) expect(inventory[repository].map(image => image.digest)).toContain(digest);
      }
    }
    const example = paths.repositories.find(name => inventory[name].length > 0);
    if (example) {
      await page.getByLabel('镜像仓库路径', {exact: true}).fill(example);
      await page.getByRole('button', {name: '筛选', exact: true}).click();
      await expect(page.getByRole('table', {name: '实际镜像库存'})).toContainText(inventory[example][0].digest);
      await page.getByRole('button', {name: '镜像详情', exact: true}).first().click();
      await expect(page.getByRole('region', {name: '镜像详情'})).toContainText(inventory[example][0].digest);
      await expect(page.getByRole('alert')).toHaveCount(0);
    }
    result.registryInventory[registry.id] = inventory;
    await page.screenshot({path: fileURLToPath(new URL('registry-' + registry.id + '.png', evidence)), fullPage: true});
  }
  expect(errors).toEqual([]);
  await writeFile(new URL('result.json', evidence), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  await page.screenshot({ path: fileURLToPath(new URL('failure.png', evidence)), fullPage: true });
  throw error;
} finally {
  await browser.close();
}
