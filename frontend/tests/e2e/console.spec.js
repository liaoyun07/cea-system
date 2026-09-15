import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const auth =
  'Basic ' + Buffer.from(`${process.env.CEA_E2E_USER}:${process.env.CEA_E2E_PASSWORD}`).toString('base64');
const apiBase = '/api/namespaces/lab';
const unique = () => `ui-${randomUUID().slice(0, 8)}`;
const source = (id, extra = '') =>
  `schemaVersion: 1\nnamespace: lab\nid: ${id}\ninputs:\n  name: {type: STRING, defaultValue: World}\ntasks:\n  - id: greet\n    type: core.Log\n    message: "Hello {{ inputs.name }}"\noutputs:\n  greeting: {source: TASK_OUTPUT, taskId: greet, port: message}\n${extra}`;
async function login(page) {
  await page.goto('/');
  await page.getByLabel('账号', { exact: true }).fill(process.env.CEA_E2E_USER);
  await page.getByLabel('密码', { exact: true }).fill(process.env.CEA_E2E_PASSWORD);
  await page.getByRole('button', { name: '连接工作空间 →', exact: true }).click();
  await expect(page.getByRole('heading', { name: '流程', exact: true })).toBeVisible();
}
async function save(page, id, yaml = source(id)) {
  await page.getByRole('button', { name: '＋ 新建流程', exact: true }).click();
  await page.getByLabel('流程 ID', { exact: true }).fill(id);
  await page.getByRole('tab', { name: '源代码', exact: true }).click();
  await page.getByLabel('Flow YAML').fill(yaml);
  await page.getByRole('button', { name: '保存修订', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已保存修订 r1');
}
async function start(page) {
  await page.getByRole('button', { name: '▷ 执行', exact: true }).click();
  await page.getByRole('button', { name: '启动执行', exact: true }).click();
}
async function seed(request, id, yaml = source(id)) {
  const response = await request.post(`${apiBase}/flows/${id}/revisions`, {
    headers: { Authorization: auth },
    data: { expectedRevision: 0, source: yaml },
  });
  expect(response.status()).toBe(201);
}

test.beforeEach(async ({ page }) => {
  page.uiErrors = [];
  page.on('pageerror', (e) => page.uiErrors.push(e.message));
});
test.afterEach(async ({ page }) => {
  expect(page.uiErrors).toEqual([]);
});

test('authentication errors, namespace permission and memory-only credentials', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('账号', { exact: true }).fill('owner');
  await page.getByLabel('密码', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: '连接工作空间 →', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('401');
  await page.getByLabel('密码', { exact: true }).fill(process.env.CEA_E2E_PASSWORD);
  await page.getByLabel('命名空间', { exact: true }).fill('forbidden');
  await page.getByRole('button', { name: '连接工作空间 →', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('403');
  await login(page);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  await page.reload();
  await expect(page.getByRole('heading', { name: '连接工作空间' })).toBeVisible();
});
test('real YAML save, preview, execution, outputs, logs and attempts', async ({ page }) => {
  const id = unique();
  await login(page);
  await save(page, id);
  await page.getByRole('button', { name: '✓ 校验', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('校验通过');
  await page.getByRole('button', { name: '▷ 执行', exact: true }).click();
  await page.locator('#input-name').fill('CEA');
  await page.screenshot({ path: '.local/evidence/editor.png', fullPage: true });
  await page.getByRole('button', { name: '预览输入', exact: true }).click();
  await expect(page.getByText('输入校验通过', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '启动执行', exact: true }).click();
  await expect(page.locator('h1 .status')).toHaveText('SUCCESS');
  await page.getByRole('tab', { name: '输出', exact: true }).click();
  await expect(page.getByTestId('execution-outputs')).toContainText('Hello CEA');
  await page.getByRole('tab', { name: '日志', exact: true }).click();
  await expect(page.locator('.log-entry pre')).toContainText('Hello CEA');
  await page.getByRole('tab', { name: /任务实例/ }).click();
  await page.getByRole('button', { name: '尝试详情' }).click();
  await expect(page.locator('.attempt')).toContainText('SUCCESS');
  await expect(page.getByTestId('task-outputs')).toContainText('Hello CEA');
  await expect(page.getByTestId('task-duration')).toHaveText(/\d+\.\d{2} s/);
  await page.screenshot({ path: '.local/evidence/execution.png', fullPage: true });
});

test('execution topology separates real rounds/items, If scopes, outputs and historical revisions', async ({
  page,
  request,
}) => {
  const id = unique();
  const yaml = `schemaVersion: 1
namespace: lab
id: ${id}
tasks:
  - id: rounds
    type: core.Repeat
    repeat:
      iterations: {source: LITERAL, value: 2}
    tasks:
      - id: clients
        type: core.Loop
        loop:
          values: {source: LITERAL, value: [false, 0]}
          concurrency: 2
        tasks:
          - id: branch
            type: core.If
            condition: 'true'
            then:
              - id: train
                type: core.Log
                message: 'value={{ item.value }}'
            else:
              - id: unused
                type: core.Log
                message: skipped
`;
  await login(page);
  await save(page, id, yaml);
  await start(page);
  await expect(page.locator('h1 .status')).toHaveText('SUCCESS', { timeout: 30000 });
  const executionId = await page.locator('.execution-id').textContent();
  const rows = await (
    await request.get(`${apiBase}/executions/${executionId.trim()}/tasks`, {
      headers: { Authorization: auth },
    })
  ).json();
  const changed = await request.post(`${apiBase}/flows/${id}/revisions`, {
    headers: { Authorization: auth },
    data: { expectedRevision: 1, source: source(id) },
  });
  expect(changed.status()).toBe(201);
  const revisionRequests = [];
  page.on('request', (r) => {
    if (r.url().includes(`/executions/${executionId.trim()}/definition`)) revisionRequests.push(r.url());
  });
  await page.getByRole('tab', { name: '拓扑', exact: true }).click();
  await page.getByRole('button', { name: '展开 rounds', exact: true }).click();
  await page.getByLabel('迭代实例', { exact: true }).selectOption('2');
  await page.getByRole('button', { name: '展开 clients', exact: true }).click();
  await page.getByLabel('迭代实例', { exact: true }).selectOption('2');
  await expect(page.getByTestId('graph-item')).toHaveText('0');
  await page.getByRole('button', { name: '展开 branch', exact: true }).click();
  await page.getByRole('button', { name: '查看 train 实例', exact: true }).click();
  const loop = rows.find((r) => r.taskId === 'clients' && r.iteration === 2);
  const train = rows.find((r) => r.taskId === 'train' && r.parentTaskRunId === loop.id && r.iteration === 2);
  await expect(page.getByLabel('任务实例详情')).toContainText(train.id);
  await expect(page.getByTestId('task-outputs')).toContainText('value=0');
  await expect(page.locator('.attempt')).toContainText('SUCCESS');
  await page.screenshot({ path: '.local/evidence/graph-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 650, height: 1000 });
  await page.screenshot({ path: '.local/evidence/graph-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByLabel('条件分支', { exact: true }).selectOption('else');
  await expect(page.locator('[data-task="unused"]')).toHaveAttribute('data-state', 'SKIPPED');
  await page
    .getByRole('navigation', { name: '拓扑层级' })
    .getByRole('button', { name: 'clients', exact: true })
    .click();
  await page.getByLabel('迭代实例', { exact: true }).selectOption('1');
  await expect(page.getByTestId('graph-item')).toHaveText('false');
  await page
    .getByRole('navigation', { name: '拓扑层级' })
    .getByRole('button', { name: 'rounds', exact: true })
    .click();
  await page.getByLabel('迭代实例', { exact: true }).selectOption('1');
  await page.getByRole('button', { name: '查看 clients 实例', exact: true }).click();
  await expect(page.getByLabel('任务实例详情')).toContainText(
    rows.find((r) => r.taskId === 'clients' && r.iteration === 1).id,
  );
  expect(revisionRequests.length).toBeGreaterThan(0);
  expect(revisionRequests.every((url) => url.endsWith(`/executions/${executionId.trim()}/definition`))).toBe(
    true,
  );
  // A missing source must not hide task outputs or fall back to the newest flow.
  await page.getByRole('tab', { name: /任务实例/ }).click();
  await page.route(`**/executions/${executionId.trim()}/definition`, (route) =>
    route.fulfill({ status: 403, body: 'revision access denied' }),
  );
  await page.getByRole('tab', { name: '拓扑', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('403');
  await page.getByRole('tab', { name: /任务实例/ }).click();
  await page.locator('tr').filter({ hasText: train.id }).getByRole('button', { name: '尝试详情' }).click();
  await expect(page.getByTestId('task-outputs')).toContainText('value=0');
});

test('real DAG and Parallel graphs render dependency edges and separate lifecycle phases', async ({
  page,
}) => {
  const id = unique();
  await login(page);
  await save(
    page,
    id,
    `schemaVersion: 1
namespace: lab
id: ${id}
tasks:
  - id: dag
    type: core.Dag
    tasks:
      - {id: join, type: core.Log, message: joined, dependsOn: [a, b]}
      - {id: b, type: core.Log, message: b}
      - {id: a, type: core.Log, message: a}
  - id: parallel
    type: core.Parallel
    tasks:
      - {id: x, type: core.Log, message: x}
      - {id: y, type: core.Log, message: y}
finally:
  - {id: clean, type: core.Log, message: clean}
`,
  );
  await start(page);
  await expect(page.locator('h1 .status')).toHaveText('SUCCESS');
  await page.getByRole('tab', { name: '拓扑', exact: true }).click();
  await page.getByRole('button', { name: '展开 dag', exact: true }).click();
  await expect(page.locator('[data-edge]')).toHaveCount(2);
  await expect(page.locator('[data-edge="a->join"]')).toHaveCount(1);
  await expect(page.locator('[data-task="join"]')).toHaveAttribute('data-state', 'SUCCESS');
  await page.screenshot({ path: '.local/evidence/graph-dag.png', fullPage: true });
  await page
    .getByRole('navigation', { name: '拓扑层级' })
    .getByRole('button', { name: '任务', exact: true })
    .click();
  await page.getByRole('button', { name: '展开 parallel', exact: true }).click();
  await expect(page.locator('[data-edge]')).toHaveCount(0);
  await expect(page.locator('.graph-node')).toHaveCount(2);
  await page.getByLabel('执行阶段', { exact: true }).selectOption('finally');
  await expect(page.locator('[data-task="clean"]')).toHaveAttribute('data-state', 'SUCCESS');
});

test('task table sorts actual starts, keeps unstarted tasks last and refreshes the selected instance', async ({
  page,
  request,
}) => {
  const id = unique();
  await login(page);
  await save(
    page,
    id,
    `schemaVersion: 1
namespace: lab
id: ${id}
tasks:
  - id: clients
    type: core.Loop
    loop:
      values: {source: LITERAL, value: [a, b]}
      concurrency: 2
    tasks:
      - {id: train, type: core.Sleep, duration: PT6S}
  - {id: aggregate, type: core.Log, message: aggregated}
  - {id: evaluate, type: core.Log, message: evaluated}
`,
  );
  await start(page);
  await page.getByRole('tab', { name: /任务实例/ }).click();
  const table = page.getByRole('table', { name: '任务实例列表', exact: true });
  const trainRows = table
    .locator('tbody tr')
    .filter({ has: page.locator('td > strong', { hasText: /^train$/ }) });
  await expect(trainRows).toHaveCount(2);
  await expect(trainRows.locator('.status')).toHaveText(['RUNNING', 'RUNNING']);
  await expect(table.locator('tbody tr td > strong')).toHaveText([
    'clients',
    'train',
    'train',
    'aggregate',
    'evaluate',
  ]);
  await expect(table.getByRole('columnheader', { name: '开始时间', exact: true })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  await expect(table.locator('tbody tr').filter({ hasText: 'aggregate' }).locator('td').nth(5)).toHaveText(
    '—',
  );
  const executionId = (await page.locator('.execution-id').textContent()).trim();
  const tasks = await (
    await request.get(`${apiBase}/executions/${executionId}/tasks`, { headers: { Authorization: auth } })
  ).json();
  // The API still returns creation order; only the table uses chronological order.
  expect(tasks.map((task) => task.taskId)).toEqual(['clients', 'aggregate', 'evaluate', 'train', 'train']);
  const selectedId = (await trainRows.first().locator('small').textContent()).trim();
  await trainRows.first().getByRole('button', { name: '尝试详情', exact: true }).click();
  await expect(page.getByLabel('任务实例详情')).toContainText(selectedId);
  await expect(page.locator('h1 .status')).toHaveText('SUCCESS');
  await expect(table.locator('tbody tr td > strong')).toHaveText([
    'clients',
    'train',
    'train',
    'aggregate',
    'evaluate',
  ]);
  await expect(page.getByLabel('任务实例详情')).toContainText(selectedId);
  await expect(page.locator('.attempt')).toContainText('SUCCESS');
  await page.getByRole('button', { name: '↻ 刷新', exact: true }).click();
  await expect(table.locator('tbody tr td > strong')).toHaveText([
    'clients',
    'train',
    'train',
    'aggregate',
    'evaluate',
  ]);
  await expect(page.getByLabel('任务实例详情')).toContainText(selectedId);
  await page.screenshot({ path: '.local/evidence/task-order-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: '.local/evidence/task-order-narrow.png', fullPage: true });
  await page.getByRole('tab', { name: '拓扑', exact: true }).click();
  await page.getByRole('button', { name: '展开 clients', exact: true }).click();
  await page.getByRole('button', { name: '查看 train 实例', exact: true }).click();
  await expect(page.getByLabel('任务实例详情')).toContainText(
    tasks.find((task) => task.taskId === 'train' && task.iteration === 1).id,
  );
});

test('both federated flows expose explicit dataset SELECT controls without execution', async ({ page }) => {
  await login(page);
  for (const name of ['fedavg', 'fedprox']) {
    const id = unique();
    const yaml = readFileSync(
      new URL(`../../../examples/federated/${name}.yaml`, import.meta.url),
      'utf8',
    ).replace(`id: ${name}`, `id: ${id}`);
    await save(page, id, yaml);
    await page.getByRole('button', { name: '▷ 执行', exact: true }).click();
    await expect(page.locator('select#input-training_dataset')).toHaveValue('mnist-train/v1');
    await expect(page.locator('select#input-test_dataset')).toHaveValue('mnist-test/v1');
    for (const dataset of ['cifar10', 'cifar100']) {
      await page.locator('select#input-training_dataset').selectOption(`${dataset}-train/v1`);
      await page.locator('select#input-test_dataset').selectOption(`${dataset}-test/v1`);
      await expect(page.locator('select#input-training_dataset')).toHaveValue(`${dataset}-train/v1`);
      await expect(page.locator('select#input-test_dataset')).toHaveValue(`${dataset}-test/v1`);
    }
    await page.getByRole('button', { name: '关闭执行参数', exact: true }).click();
    await page
      .getByRole('navigation', { name: '主导航' })
      .getByRole('button', { name: '流程', exact: true })
      .click();
  }
});
test('invalid YAML, stale revision conflict and unsaved navigation keep draft', async ({ page, request }) => {
  const id = unique();
  await login(page);
  await save(page, id);
  const original = source(id);
  await page.getByLabel('Flow YAML').fill(original + 'unknownField: true\n');
  await page.getByRole('button', { name: '✓ 校验', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('422');
  await expect(page.getByRole('button', { name: '▷ 执行', exact: true })).toBeDisabled();
  await page.getByLabel('Flow YAML').fill(original + 'description: browser-draft\n');
  const response = await request.post(`${apiBase}/flows/${id}/revisions`, {
    headers: { Authorization: auth },
    data: { expectedRevision: 1, source: original + 'description: other-editor\n' },
  });
  expect(response.status()).toBe(201);
  await page.getByRole('button', { name: '保存修订', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('409');
  await expect(page.getByLabel('Flow YAML')).toHaveValue(original + 'description: browser-draft\n');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('navigation').getByRole('button', { name: '执行', exact: true }).click();
  await expect(page.getByLabel('Flow YAML')).toBeVisible();
  await page.getByLabel('Flow YAML').fill('');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('navigation').getByRole('button', { name: '流程', exact: true }).click();
  await expect(page.getByLabel('Flow YAML')).toHaveValue('');
});
test('lost submit response retries same request and creates only one execution', async ({
  page,
  request,
}) => {
  const id = unique();
  await login(page);
  await save(page, id);
  let intercepted = 0,
    keys = [];
  await page.route('**/api/namespaces/lab/executions', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(route.request().headers()['idempotency-key']);
    if (intercepted++ === 0) {
      const real = await route.fetch();
      expect(real.status()).toBe(202);
      await route.abort('failed');
    } else await route.continue();
  });
  await start(page);
  await expect(page.getByRole('button', { name: '原请求重试' })).toBeVisible();
  await expect(page.locator('#input-name')).toBeDisabled();
  await page.getByRole('button', { name: '原请求重试' }).click();
  await expect(page.locator('h1 .status')).toHaveText('SUCCESS');
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  const rows = await (
    await request.get(`${apiBase}/executions?limit=100`, { headers: { Authorization: auth } })
  ).json();
  expect(rows.filter((r) => r.flowId === id)).toHaveLength(1);
});
test('cancel a real Sleep execution; no fake terminal state', async ({ page }) => {
  const id = unique(),
    yaml = `schemaVersion: 1\nnamespace: lab\nid: ${id}\ntasks:\n  - id: wait\n    type: core.Sleep\n    duration: PT20S\n`;
  await login(page);
  await save(page, id, yaml);
  await start(page);
  await expect(page.locator('h1 .status')).toHaveText('RUNNING');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '取消执行', exact: true }).click();
  await expect(page.locator('h1 .status')).toHaveText('KILLED');
  await page.getByRole('tab', { name: '拓扑', exact: true }).click();
  await expect(page.locator('[data-task="wait"]')).toHaveAttribute('data-state', 'KILLED');
});
test('main terminal remains success while afterExecution continues', async ({ page }) => {
  const id = unique(),
    yaml = source(
      id,
      `afterExecution:\n  - id: post-wait\n    type: core.Sleep\n    duration: PT5S\n  - id: notify\n    type: core.Log\n    message: "after done"\n`,
    );
  await login(page);
  await save(page, id, yaml);
  await start(page);
  await expect(page.locator('h1 .status')).toHaveText('SUCCESS');
  await expect(page.getByText('主执行已结束，后处理仍在运行。这里会继续刷新后处理状态。')).toBeVisible();
  await expect(page.locator('.refresh-note')).toContainText('执行和后处理均已结束');
  await page.getByRole('tab', { name: '日志', exact: true }).click();
  await expect(page.locator('.log-lines')).toContainText('after done');
});
test('search empty state, backend schema and mobile layout', async ({ page }) => {
  await login(page);
  await page.getByLabel('搜索流程').fill(unique());
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.getByRole('heading', { name: '暂无流程' })).toBeVisible();
  await page.getByRole('button', { name: '＋ 新建流程', exact: true }).click();
  await page.getByRole('tab', { name: '结构参考' }).click();
  await expect(page.locator('.schema-code')).toContainText('schemaVersion');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/evidence/mobile.png', fullPage: true });
});

test('typed inputs, required rejection and explicit pinned revision', async ({ page, request }) => {
  const id = unique();
  const yaml = `schemaVersion: 1\nnamespace: lab\nid: ${id}\ninputs:\n  count: {type: INTEGER, required: true}\n  rate: {type: NUMBER, defaultValue: 0.25}\n  flag: {type: BOOLEAN, defaultValue: false}\n  config: {type: OBJECT, defaultValue: {mode: fast}}\n  items: {type: ARRAY, defaultValue: [1, 2]}\ntasks: [{id: log, type: core.Log, message: typed-inputs}]\noutputs:\n  count: {source: INPUT, name: count}\n  rate: {source: INPUT, name: rate}\n  flag: {source: INPUT, name: flag}\n  config: {source: INPUT, name: config}\n  items: {source: INPUT, name: items}\n`;
  await login(page);
  await save(page, id, yaml);
  await page.getByRole('button', { name: '▷ 执行', exact: true }).click();
  await page.getByRole('button', { name: '启动执行', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('required');
  await page.locator('.input-field').filter({ hasText: 'count' }).getByRole('checkbox').check();
  await page.locator('#input-count').fill('3');
  const updated = await request.post(`${apiBase}/flows/${id}/revisions`, {
    headers: { Authorization: auth },
    data: { expectedRevision: 1, source: yaml + 'description: concurrent-revision\n' },
  });
  expect(updated.status()).toBe(201);
  await page.getByRole('button', { name: '启动执行', exact: true }).click();
  await expect(page.locator('h1 .status')).toHaveText('SUCCESS');
  await expect(page.locator('dd').filter({ hasText: /^r1$/ })).toBeVisible();
  await page.getByRole('tab', { name: '输出', exact: true }).click();
  const output = JSON.parse(await page.getByTestId('execution-outputs').textContent());
  expect(output).toEqual({ count: 3, rate: 0.25, flag: false, config: { mode: 'fast' }, items: [1, 2] });
});

test('failed task reports backend error and attempt, not success', async ({ page }) => {
  const id = unique(),
    yaml = `schemaVersion: 1\nnamespace: lab\nid: ${id}\ntasks:\n  - id: timeout\n    type: core.Sleep\n    duration: PT5S\n    timeout: PT0.2S\n    retry: {type: constant, maxAttempts: 2, interval: PT0.1S}\n`;
  await login(page);
  await save(page, id, yaml);
  await start(page);
  await expect(page.locator('h1 .status')).toHaveText('FAILED');
  await expect(page.getByRole('alert')).toContainText('主执行错误');
  await page.getByRole('tab', { name: /任务实例/ }).click();
  await page.getByRole('button', { name: '尝试详情' }).click();
  await expect(page.locator('.attempt')).toHaveCount(2);
  await expect(page.locator('.attempt').first()).toContainText('FAILED');
  await expect(page.locator('.attempt').last()).toContainText('FAILED');
  await page.getByRole('tab', { name: '拓扑', exact: true }).click();
  await expect(page.locator('[data-task="timeout"]')).toHaveAttribute('data-state', 'FAILED');
});

test('server pagination and editing existing source round-trip', async ({ page, request }) => {
  const group = unique();
  for (let i = 0; i < 21; i++) await seed(request, `${group}-${String(i).padStart(2, '0')}`);
  await login(page);
  await page.getByLabel('搜索流程').fill(group);
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(20);
  await page.screenshot({ path: '.local/evidence/flows.png', fullPage: true });
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: '编辑 →' }).click();
  await expect(page.getByLabel('Flow YAML')).toHaveValue(source(`${group}-20`));
});

test('dynamic instances drain incremental logs and stop polling after navigation', async ({ page }) => {
  const id = unique();
  const yaml = `schemaVersion: 1\nnamespace: lab\nid: ${id}\ntasks:\n  - id: clients\n    type: core.Loop\n    loop:\n      values: {source: LITERAL, value: ${JSON.stringify(Array.from({ length: 105 }, (_, i) => i))}}\n      concurrency: 20\n    tasks:\n      - id: log\n        type: core.Log\n        message: pagination-probe\n`;
  const queries = [];
  page.on('request', (request) => {
    if (request.url().includes('/logs?')) queries.push(request.url());
  });
  await login(page);
  await save(page, id, yaml);
  await start(page);
  await expect(page.locator('h1 .status')).toHaveText('SUCCESS', { timeout: 30000 });
  await expect(page.locator('.refresh-note')).toContainText('执行和后处理均已结束');
  await page.getByRole('tab', { name: '日志', exact: true }).click();
  await expect(page.locator('.log-entry pre').filter({ hasText: 'pagination-probe' })).toHaveCount(105);
  expect(queries.some((url) => !url.includes('afterId=0&'))).toBe(true);
  await page.getByRole('navigation').getByRole('button', { name: '流程', exact: true }).click();
  const before = queries.length;
  await page.waitForTimeout(2300); // Prove the 2-second poll no longer runs after unmount.
  expect(queries).toHaveLength(before);
});
