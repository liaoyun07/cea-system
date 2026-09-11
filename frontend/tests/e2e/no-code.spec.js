import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { parse } from 'yaml';
const auth =
  'Basic ' + Buffer.from(`${process.env.CEA_E2E_USER}:${process.env.CEA_E2E_PASSWORD}`).toString('base64');
const headers = { Authorization: auth };
const base = '/api/namespaces/lab';
const unique = () => `nc-${randomUUID().slice(0, 8)}`;
async function open(page, id, source) {
  await page.goto('/');
  await page.getByLabel('账号', { exact: true }).fill(process.env.CEA_E2E_USER);
  await page.getByLabel('密码', { exact: true }).fill(process.env.CEA_E2E_PASSWORD);
  await page.getByRole('button', { name: '连接工作空间 →', exact: true }).click();
  await page.getByRole('button', { name: '＋ 新建流程', exact: true }).click();
  await page.getByLabel('流程 ID', { exact: true }).fill(id);
  if (source) {
    await page.getByRole('tab', { name: '源代码', exact: true }).click();
    await page.getByLabel('Flow YAML').fill(source);
    await page.getByRole('tab', { name: '可视化编排', exact: true }).click();
  } else await page.getByRole('button', { name: '创建空流程', exact: true }).click();
  await expect(page.locator('.task-canvas')).toBeVisible();
}
async function add(page, group, type, id) {
  await page.getByRole('button', { name: `添加到 ${group}`, exact: true }).click();
  await page.getByLabel('任务类型', { exact: true }).selectOption(type);
  await page.getByLabel('任务 ID', { exact: true }).fill(id);
  await page.getByRole('button', { name: '添加到流程', exact: true }).click();
  await expect(page.locator('.task-inspector h2')).toHaveText(id);
}
async function field(page, path, value) {
  const control = page.locator(`[data-field="${path}"]`).locator(':scope > input, :scope > textarea');
  await control.fill(value);
  await control.blur();
}
test.beforeEach(async ({ page }) => {
  page.uiErrors = [];
  page.on('pageerror', (e) => page.uiErrors.push(e.message));
});
test.afterEach(async ({ page }) => {
  expect(page.uiErrors).toEqual([]);
});

test('build, configure, save and execute a workflow through no-code only', async ({ page }) => {
  const id = unique();
  await open(page, id);
  await add(page, '任务', 'core.Log', 'hello');
  await field(page, 'tasks.0.message', 'Created with no-code');
  await page.getByRole('button', { name: '✓ 校验', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('校验通过');
  await page.getByRole('button', { name: '保存修订', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已保存修订 r1');
  await page.screenshot({ path: '.local/evidence/no-code-log.png', fullPage: true });
  await page.getByRole('button', { name: '▷ 执行', exact: true }).click();
  await page.getByRole('button', { name: '启动执行', exact: true }).click();
  await expect(page.locator('h1 .status')).toHaveText('SUCCESS');
  await page.getByRole('tab', { name: '日志', exact: true }).click();
  await expect(page.locator('.log-entry pre')).toContainText('Created with no-code');
});
test('Loop form executes every item and excludes invalid nested controls', async ({ page }) => {
  const id = unique();
  await open(page, id);
  await add(page, '任务', 'core.Loop', 'clients');
  const values = page.locator('[data-field="tasks.0.loop.values"]');
  for (let i = 1; i <= 3; i++) {
    await values.getByRole('button', { name: '＋ 添加到 values', exact: true }).click();
    const row = values.locator(`[data-loop-item="${i - 1}"]`);
    await row.getByLabel(`第 ${i} 项 类型`, { exact: true }).selectOption('number');
    await row.getByLabel(`第 ${i} 项`, { exact: true }).fill(String(i));
    await row.getByLabel(`第 ${i} 项`, { exact: true }).blur();
  }
  await field(page, 'tasks.0.loop.concurrency', '2');
  await page.getByRole('button', { name: '添加到 clients / 内部任务', exact: true }).click();
  await expect(page.getByLabel('任务类型').locator('option[value="core.Repeat"]')).toHaveCount(0);
  await expect(page.getByLabel('任务类型').locator('option[value="core.Loop"]')).toHaveCount(0);
  await page.getByLabel('任务 ID', { exact: true }).fill('train');
  await page.getByRole('button', { name: '添加到流程', exact: true }).click();
  await field(page, 'tasks.0.tasks.0.message', 'item={{ item.value }}');
  await page.getByRole('button', { name: '保存修订', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已保存修订 r1');
  await page.getByRole('button', { name: '▷ 执行', exact: true }).click();
  await page.getByRole('button', { name: '启动执行', exact: true }).click();
  await expect(page.locator('h1 .status')).toHaveText('SUCCESS');
  await page.getByRole('tab', { name: '日志', exact: true }).click();
  await expect(page.locator('.log-entry')).toHaveCount(3);
});
test('invalid YAML and task structure keep source; switching and field edit preserve comments', async ({
  page,
}) => {
  const id = unique(),
    source = `# preserved\nschemaVersion: 1\nnamespace: lab\nid: ${id}\ntasks:\n  - id: hello\n    type: core.Log\n    message: start # keep\nlabels: {owner: lab}\n`;
  await open(page, id, source);
  await page.locator('[data-task="hello"] > .task-card-header .task-select').click();
  await field(page, 'tasks.0.message', 'updated');
  await page.getByRole('tab', { name: '并排编辑', exact: true }).click();
  await expect(page.getByLabel('Flow YAML')).toHaveValue(/# preserved/);
  const value = await page.getByLabel('Flow YAML').inputValue();
  expect(value).toContain('# keep');
  expect(parse(value).labels).toEqual({ owner: 'lab' });
  for (const invalid of [
    'tasks: [',
    'tasks: [null]',
    'tasks: [{id: bad, type: core.Log, dependsOn: not-an-array}]',
    'inputs: not-an-object',
  ]) {
    await page.getByLabel('Flow YAML').fill(invalid);
    await expect(page.getByText('暂时无法显示 No-code', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Flow YAML')).toHaveValue(invalid);
  }
  await page.getByLabel('Flow YAML').fill(value);
  await expect(page.locator('.task-canvas')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('dependency-based upstream options include later task; deletion protects references', async ({
  page,
}) => {
  const id = unique(),
    source = `schemaVersion: 1\nnamespace: lab\nid: ${id}\ntasks:\n  - id: dag\n    type: core.Dag\n    tasks:\n      - id: target\n        type: platform.Application\n        dependsOn: [init]\n        container:\n          applicationId: shell\n          version: v1\n          candidateClusters: [cloud]\n          inputFiles:\n            model: {source: TASK_OUTPUT, taskId: init, port: message}\n      - id: init\n        type: core.Log\n        message: hello\n`;
  await open(page, id, source);
  await page.locator('[data-task="target"] > .task-card-header .task-select').click();
  await expect(page.getByLabel('上游任务').locator('option[value="init"]')).toHaveCount(1);
  await expect(page.getByLabel('上游任务')).toHaveValue('init');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '删除任务 init', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('仍被引用');
  await expect(page.locator('[data-task="init"]')).toHaveCount(1);
});
test('application contract, dataset restrictions, bindings and resource catalog use real APIs', async ({
  page,
  request,
}) => {
  const token = unique();
  for (const [path, data] of [
    [`/resources/clusters/${token}`, { id: token, kind: 'EDGE', enabled: true }],
    [
      `/resources/datasets/${token}/versions/v1`,
      {
        datasetId: token,
        version: 'v1',
        format: 'pt',
        locations: [{ clusterId: token, uri: `s3://datasets/${token}/data.pt` }],
      },
    ],
    [
      `/applications/${token}/versions/v1`,
      {
        applicationId: token,
        version: 'v1',
        image: 'registry.example/test:v1',
        parameters: {
          DATASET: {
            type: 'STRING',
            required: true,
            dataset: { format: 'pt', allowed: [{ datasetId: token, version: 'v1' }] },
          },
          RATE: { type: 'NUMBER', defaultValue: 0.25 },
        },
      },
    ],
  ]) {
    const response = await request.put(base + path, { headers, data });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  const id = unique();
  await open(page, id);
  await add(page, '任务', 'platform.Application', 'train');
  await page.getByLabel('应用与版本').selectOption(JSON.stringify([token, 'v1']));
  await page
    .locator('[data-field="tasks.0.container.command"]')
    .getByRole('button', { name: '＋ 添加一项', exact: true })
    .click();
  await field(page, 'tasks.0.container.command.0', 'python');
  const param = page.locator('[data-field="tasks.0.container.parameters.DATASET"]');
  await param.getByRole('button', { name: '＋ 设置 DATASET' }).click();
  await param.getByLabel('契约允许值').selectOption(JSON.stringify(`${token}/v1`));
  await page.getByRole('button', { name: `＋ ${token} · EDGE`, exact: true }).click();
  await expect(page.getByRole('button', { name: new RegExp(`${token} · EDGE`) })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('tab', { name: '源代码', exact: true }).click();
  const flow = parse(await page.getByLabel('Flow YAML').inputValue());
  expect(flow.inputs).toBeUndefined();
  expect(flow.tasks[0].container.parameters.DATASET).toEqual({ source: 'LITERAL', value: `${token}/v1` });
  expect(flow.tasks[0].container.candidateClusters).toEqual([token]);
  expect(flow.tasks[0].container.parameters.RATE).toBeUndefined();
  await page.getByRole('button', { name: '✓ 校验', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('校验通过');
});

test('candidate cluster buttons reflect YAML, toggle selection and survive save and reload', async ({
  page,
  request,
}) => {
  const first = unique(),
    second = unique(),
    disabled = unique();
  for (const [id, enabled] of [
    [first, true],
    [second, true],
    [disabled, false],
  ]) {
    const response = await request.put(`${base}/resources/clusters/${id}`, {
      headers,
      data: { id, kind: 'EDGE', enabled },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  const id = unique();
  await open(
    page,
    id,
    `schemaVersion: 1\nnamespace: lab\nid: ${id}\ntasks:\n  - id: train\n    type: platform.Application\n    timeout: PT5M\n    container:\n      applicationId: shell\n      version: v1\n      candidateClusters: [${first}]\n      command: [sh, -c, "echo hello"]\n`,
  );
  await page.locator('[data-task="train"] > .task-card-header .task-select').click();
  const firstButton = page.getByRole('button', { name: new RegExp(`${first} · EDGE`) });
  const secondButton = page.getByRole('button', { name: new RegExp(`${second} · EDGE`) });
  const disabledButton = page.getByRole('button', { name: new RegExp(`${disabled} · EDGE`) });
  await expect(firstButton).toHaveAttribute('aria-pressed', 'true');
  await expect(secondButton).toHaveAttribute('aria-pressed', 'false');
  await expect(disabledButton).toBeDisabled();
  expect(await firstButton.evaluate((button) => getComputedStyle(button).backgroundColor)).not.toBe(
    await secondButton.evaluate((button) => getComputedStyle(button).backgroundColor),
  );
  await secondButton.click();
  await expect(secondButton).toHaveAttribute('aria-pressed', 'true');
  await expect(secondButton).toContainText('✓');
  await expect(secondButton).toHaveCSS('background-color', 'rgb(100, 54, 187)');
  await expect(secondButton).toHaveCSS('color', 'rgb(255, 255, 255)');
  await firstButton.click();
  await expect(firstButton).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('tab', { name: '并排编辑', exact: true }).click();
  expect(parse(await page.getByLabel('Flow YAML').inputValue()).tasks[0].container.candidateClusters).toEqual(
    [second],
  );
  await page
    .getByLabel('Flow YAML')
    .fill((await page.getByLabel('Flow YAML').inputValue()).replace(second, first));
  await expect(firstButton).toHaveAttribute('aria-pressed', 'true');
  await expect(secondButton).toHaveAttribute('aria-pressed', 'false');
  await secondButton.click();
  await secondButton.click();
  expect(parse(await page.getByLabel('Flow YAML').inputValue()).tasks[0].container.candidateClusters).toEqual(
    [first],
  );
  await page.getByRole('button', { name: '改为参数引用', exact: true }).click();
  await expect(page.getByRole('group', { name: '候选集群选择' })).toHaveCount(0);
  expect(parse(await page.getByLabel('Flow YAML').inputValue()).tasks[0].container.candidateClusters).toEqual(
    { source: 'LITERAL', value: [first] },
  );
  await page.getByRole('button', { name: '改为固定列表', exact: true }).click();
  await expect(firstButton).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '保存修订', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已保存修订 r1');
  await page.getByRole('button', { name: '重新读取', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已读取最新修订 r1');
  await expect(firstButton).toHaveAttribute('aria-pressed', 'true');
  const response = await request.get(`${base}/flows/${id}`, { headers });
  const saved = await response.json();
  expect(parse(saved.source).tasks[0].container.candidateClusters).toEqual([first]);
  expect(saved.definition.tasks[0].container.candidateClusters).toEqual({
    source: 'LITERAL',
    value: [first],
  });
  await page.getByRole('tab', { name: '可视化编排', exact: true }).click();
  await page.locator('.cluster-picker').last().screenshot({ path: '.local/evidence/cluster-selection.png' });
  await page.setViewportSize({ width: 650, height: 900 });
  await secondButton.click();
  await expect(secondButton).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.task-inspector').screenshot({ path: '.local/evidence/cluster-selection-narrow.png' });
});
test('large task tree switches use one inspector, and catalog failure can be retried', async ({ page }) => {
  let reads = 0;
  page.on('request', (request) => {
    if (/\/applications\?/.test(request.url())) reads++;
  });
  await page.route('**/applications?**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"message":"catalog unavailable"}',
    }),
  );
  const id = unique();
  const source =
    `schemaVersion: 1\nnamespace: lab\nid: ${id}\ntasks:\n` +
    Array.from({ length: 120 }, (_, i) => `  - id: t${i}\n    type: core.Log\n    message: m${i}\n`).join(
      '',
    ) +
    '  - id: app\n    type: platform.Application\n    timeout: PT5M\n    container: {applicationId: missing, version: v1, candidateClusters: [], command: []}\n';
  await open(page, id, source);
  await expect(page.locator('.task-card')).toHaveCount(121);
  for (let i = 0; i < 30; i++) {
    await page.locator(`[data-task="t${i * 4}"] > .task-card-header .task-select`).click();
    await expect(page.locator('.task-inspector h2')).toHaveText(`t${i * 4}`);
  }
  await expect(page.locator('.task-inspector')).toHaveCount(1);
  await page.locator('[data-task="app"] > .task-card-header .task-select').click();
  await expect(page.getByText(/目录读取失败/)).toBeVisible();
  expect(reads).toBe(1);
  await page.unroute('**/applications?**');
  await page.getByRole('button', { name: '重试目录', exact: true }).click();
  await expect(page.getByText(/目录读取失败/)).toHaveCount(0);
  expect(reads).toBe(2);
});
test('FedAvg/FedProx no-code round-trip keeps executable DSL and scoped item references', async ({
  page,
}) => {
  for (const algorithm of ['fedavg', 'fedprox']) {
    const id = unique(),
      original = parse(
        readFileSync(new URL(`../../../examples/federated/${algorithm}.yaml`, import.meta.url), 'utf8'),
      );
    const text = readFileSync(
      new URL(`../../../examples/federated/${algorithm}.yaml`, import.meta.url),
      'utf8',
    ).replace(`id: ${algorithm}`, `id: ${id}`);
    await open(page, id, text);
    await page.locator('[data-task="clients"] > .task-card-header .task-select').click();
    const values = page.locator('.loop-values-field');
    await expect(values.getByLabel('集合来源')).toHaveValue('LITERAL');
    await expect(values.locator('[data-loop-item]')).toHaveCount(3);
    await expect(values.locator('[data-loop-item="0"]').getByLabel('id', { exact: true })).toHaveValue(
      'edge-a',
    );
    const train = page
      .locator('.task-card')
      .filter({ has: page.locator(':scope > .task-card-header .task-select strong', { hasText: 'train' }) });
    await train.locator(':scope > .task-card-header .task-select').click();
    await expect(
      page
        .getByLabel('参数来源')
        .filter({ has: page.locator('option[value="ITEM"]:not([disabled])') })
        .first(),
    ).toBeVisible();
    await page.getByRole('button', { name: '流程设置', exact: true }).click();
    await expect(page.locator('[data-field="inputs.clients"]')).toHaveCount(0);
    await field(page, 'description', 'Edited in No-code');
    await page.getByRole('tab', { name: '并排编辑', exact: true }).click();
    const next = parse(await page.getByLabel('Flow YAML').inputValue());
    expect(next.tasks).toEqual(original.tasks);
    expect(next.inputs).toEqual(original.inputs);
    await page.getByRole('button', { name: '✓ 校验', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('校验通过');
    await page.screenshot({ path: `.local/evidence/no-code-${algorithm}.png`, fullPage: true });
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: '断开连接', exact: true }).click();
  }
});
test('Loop values edit objects in place, reorder, preserve scalar types and execute without clients input', async ({
  page,
  request,
}) => {
  const id = unique();
  await open(
    page,
    id,
    `# Loop owns its collection\nschemaVersion: 1\nnamespace: lab\nid: ${id}\ntasks:\n  - id: each\n    type: core.Loop\n    loop:\n      values: {source: LITERAL, value: [{id: a, clusters: [edge-a], epochs: 1}, false, 0, ""]}\n      concurrency: 2\n      outputs:\n        items: {source: ITEM, path: [value]}\n    tasks:\n      - id: echo\n        type: core.Log\n        message: 'item={{ item.index }}'\noutputs:\n  items: {source: TASK_OUTPUT, taskId: each, port: items}\n`,
  );
  await page.locator('[data-task="each"] > .task-card-header .task-select').click();
  const values = page.locator('.loop-values-field');
  const first = values.locator('[data-loop-item="0"]');
  await first.getByLabel('id', { exact: true }).fill('updated');
  await first.getByLabel('id', { exact: true }).blur();
  const clusters = first.locator('[data-value-path="tasks.0.loop.values.value.0.clusters"]');
  await clusters.getByLabel('第 1 项', { exact: true }).fill('edge-c');
  await clusters.getByLabel('第 1 项', { exact: true }).blur();
  await first.getByLabel('第 1 项 新字段名', { exact: true }).fill('weight');
  await first
    .locator(':scope > .json-value-field > .json-value-children > .json-key-add')
    .getByRole('button', { name: '添加字段' })
    .click();
  await first.getByLabel('weight 类型', { exact: true }).selectOption('number');
  await first.getByLabel('weight', { exact: true }).fill('0.25');
  await first.getByLabel('weight', { exact: true }).blur();
  await values.getByRole('button', { name: '下移 values 第 1 项', exact: true }).click();
  await values.getByRole('button', { name: '＋ 添加到 values', exact: true }).click();
  const fifth = values.locator('[data-loop-item="4"]');
  await fifth.getByLabel('第 5 项', { exact: true }).fill('removed');
  await fifth.getByLabel('第 5 项', { exact: true }).blur();
  await values.getByRole('button', { name: '删除 values 第 5 项', exact: true }).click();
  await page.getByRole('button', { name: '保存修订', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已保存修订 r1');
  const saved = await (await request.get(`${base}/flows/${id}`, { headers })).json();
  expect(saved.definition.inputs).not.toHaveProperty('clients');
  const expected = [false, { id: 'updated', clusters: ['edge-c'], epochs: 1, weight: 0.25 }, 0, ''];
  expect(saved.definition.tasks[0].loop.values).toEqual({ source: 'LITERAL', value: expected });
  expect(saved.source).toContain('# Loop owns its collection');
  await values.screenshot({ path: '.local/evidence/loop-values.png' });
  await page.setViewportSize({ width: 650, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await values.screenshot({ path: '.local/evidence/loop-values-narrow.png' });
  await page.getByRole('button', { name: '▷ 执行', exact: true }).click();
  await expect(page.locator('.run-panel')).not.toContainText('clients');
  const submitted = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith('/executions'),
  );
  await page.getByRole('button', { name: '启动执行', exact: true }).click();
  const execution = await (await submitted).json();
  await expect(page.locator('h1 .status')).toHaveText('SUCCESS');
  const result = await (await request.get(`${base}/executions/${execution.executionId}`, { headers })).json();
  expect(result.outputs.items).toEqual(expected);
});

test('Loop source dropdown keeps existing Binding sources and requires confirmation', async ({
  page,
  request,
}) => {
  const id = unique();
  await open(
    page,
    id,
    `schemaVersion: 1\nnamespace: lab\nid: ${id}\ninputs:\n  items: {type: ARRAY, defaultValue: [1, 2]}\nvariables:\n  other: {source: LITERAL, value: [3, 4]}\ntasks:\n  - id: seed\n    type: core.Loop\n    loop:\n      values: {source: LITERAL, value: [5, 6]}\n      outputs:\n        numbers: {source: ITEM, path: [value]}\n    tasks: [{id: seed_log, type: core.Log, message: seed}]\n  - id: each\n    type: core.Loop\n    loop:\n      values: {source: INPUT, name: items}\n    tasks: [{id: log, type: core.Log, message: 'value={{ item.value }}'}]\n`,
  );
  await page.locator('[data-task="each"] > .task-card-header .task-select').click();
  const values = page.locator('.loop-values-field');
  await expect(values.getByLabel('流程输入引用')).toHaveValue('items');
  page.once('dialog', (dialog) => dialog.dismiss());
  await values.getByLabel('集合来源').selectOption('LITERAL');
  await expect(values.getByLabel('集合来源')).toHaveValue('INPUT');
  await expect(values.getByLabel('流程输入引用')).toHaveValue('items');
  page.once('dialog', (dialog) => dialog.accept());
  await values.getByLabel('集合来源').selectOption('LITERAL');
  await expect(values.locator('[data-loop-item]')).toHaveCount(2);
  await expect(values.getByLabel('第 1 项', { exact: true })).toHaveValue('1');
  page.once('dialog', (dialog) => dialog.accept());
  await values.getByLabel('集合来源').selectOption('VARIABLE');
  await values.getByLabel('流程变量引用').selectOption('other');
  page.once('dialog', (dialog) => dialog.accept());
  await values.getByLabel('集合来源').selectOption('TASK_OUTPUT');
  await values.getByLabel('上游任务').selectOption('seed');
  await values.getByLabel('输出端口').selectOption('numbers');
  await page.getByRole('button', { name: '保存修订', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已保存修订 r1');
  const saved = await (await request.get(`${base}/flows/${id}`, { headers })).json();
  expect(saved.definition.tasks[1].loop.values).toEqual({
    source: 'TASK_OUTPUT',
    taskId: 'seed',
    port: 'numbers',
  });
  expect(saved.definition.inputs.items.defaultValue).toEqual([1, 2]);
  await page.getByRole('button', { name: '▷ 执行', exact: true }).click();
  await page.getByRole('button', { name: '启动执行', exact: true }).click();
  await expect(page.locator('h1 .status')).toHaveText('SUCCESS');
});

test('Loop invalid numeric edits block saving and leave YAML intact until corrected', async ({ page }) => {
  const id = unique();
  await open(
    page,
    id,
    `schemaVersion: 1\nnamespace: lab\nid: ${id}\ntasks:\n  - id: each\n    type: core.Loop\n    loop:\n      values: {source: LITERAL, value: [1, 2]}\n    tasks: [{id: log, type: core.Log, message: hello}]\n`,
  );
  await page.locator('[data-task="each"] > .task-card-header .task-select').click();
  const values = page.locator('.loop-values-field');
  await values.getByLabel('第 1 项', { exact: true }).fill('9007199254740993');
  await values.getByLabel('第 1 项', { exact: true }).blur();
  await expect(page.getByRole('alert')).toContainText('有效数字');
  await expect(page.getByRole('button', { name: '保存修订', exact: true })).toBeDisabled();
  await expect(values.getByRole('button', { name: '下移 values 第 1 项', exact: true })).toBeDisabled();
  await values.getByLabel('第 1 项', { exact: true }).fill('0');
  await values.getByLabel('第 1 项', { exact: true }).blur();
  await expect(page.getByRole('alert')).toHaveCount(0);
  page.once('dialog', (dialog) => dialog.dismiss());
  await values.getByLabel('第 1 项 类型', { exact: true }).selectOption('string');
  await expect(values.getByLabel('第 1 项 类型', { exact: true })).toHaveValue('number');
  await expect(values.getByLabel('第 1 项', { exact: true })).toHaveValue('0');
  await page.getByRole('tab', { name: '并排编辑', exact: true }).click();
  expect(parse(await page.getByLabel('Flow YAML').inputValue()).tasks[0].loop.values.value).toEqual([0, 2]);
});

test('Loop creates an object element and nested array without source editing', async ({ page }) => {
  await open(page, unique());
  await add(page, '任务', 'core.Loop', 'each');
  await page.getByRole('button', { name: '移除 values', exact: true }).click();
  await page.getByRole('button', { name: '＋ 设置 values', exact: true }).click();
  const values = page.locator('.loop-values-field');
  await expect(values.getByLabel('集合来源')).toHaveValue('LITERAL');
  await expect(values.locator('[data-loop-item]')).toHaveCount(0);
  await values.getByRole('button', { name: '＋ 添加到 values', exact: true }).click();
  await values.getByLabel('第 1 项 类型', { exact: true }).selectOption('object');
  const root = values.locator('[data-value-path="tasks.0.loop.values.value.0"]');
  await root.getByLabel('第 1 项 新字段名', { exact: true }).fill('name');
  await root
    .locator(':scope > .json-value-children > .json-key-add')
    .getByRole('button', { name: '添加字段' })
    .click();
  await root.getByLabel('name', { exact: true }).fill('client');
  await root.getByLabel('name', { exact: true }).blur();
  await root.getByLabel('第 1 项 新字段名', { exact: true }).fill('locations');
  await root
    .locator(':scope > .json-value-children > .json-key-add')
    .getByRole('button', { name: '添加字段' })
    .click();
  await root.getByLabel('locations 类型', { exact: true }).selectOption('array');
  const list = root.locator('[data-value-path="tasks.0.loop.values.value.0.locations"]');
  await list.getByRole('button', { name: '添加到 locations', exact: true }).click();
  await list.getByLabel('第 1 项', { exact: true }).fill('edge-a');
  await list.getByLabel('第 1 项', { exact: true }).blur();
  await page.getByRole('tab', { name: '并排编辑', exact: true }).click();
  const source = await page.getByLabel('Flow YAML').inputValue();
  expect(parse(source).tasks[0].loop.values).toEqual({
    source: 'LITERAL',
    value: [{ name: 'client', locations: ['edge-a'] }],
  });
});

test('task required fields lead a single vertical form without an outer loop wrapper', async ({
  page,
  request,
}) => {
  const id = unique();
  const source = `schemaVersion: 1\nnamespace: lab\nid: ${id}\ninputs:\n  items: {type: ARRAY, defaultValue: [edge-a, edge-b]}\ntasks:\n  - id: each\n    type: core.Loop\n    loop:\n      values: {source: INPUT, name: items}\n    tasks: [{id: log, type: core.Log, message: '{{ item.value }}'}]\n`;
  await open(page, id, source);
  await page.locator('[data-task="each"] > .task-card-header .task-select').click();
  const inspector = page.locator('.task-inspector');
  const fields = inspector.locator('fieldset > .schema-field');
  expect(
    await fields.evaluateAll((nodes) => nodes.map((node) => node.dataset.taskIdentity || node.dataset.field)),
  ).toEqual(['type', 'id', 'tasks.0.loop.values', 'tasks.0.loop.concurrency', 'tasks.0.loop.outputs']);
  await expect(
    inspector.locator('[data-field="tasks.0.loop.values"] > .field-heading .required'),
  ).toBeVisible();
  await expect(inspector.locator('[data-field="tasks.0.loop"]')).toHaveCount(0);
  await expect(inspector.locator('[data-field="tasks.0.timeout"], [data-field="tasks.0.retry"]')).toHaveCount(
    0,
  );
  await expect(inspector.getByRole('button', { name: 'Array', exact: true })).toHaveCount(0);
  await expect(inspector.getByRole('button', { name: '引用', exact: true })).toHaveCount(0);
  await expect(inspector.getByLabel('集合来源')).toHaveValue('INPUT');
  await expect(inspector.getByLabel('流程输入引用')).toHaveValue('items');
  await inspector.screenshot({ path: '.local/evidence/task-form-order.png' });
  await page.setViewportSize({ width: 650, height: 900 });
  await inspector.screenshot({ path: '.local/evidence/task-form-order-narrow.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '保存修订', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已保存修订 r1');
  const saved = await (await request.get(`${base}/flows/${id}`, { headers })).json();
  expect(parse(saved.source)).toEqual(parse(source));
  await page.locator('[data-task="log"] > .task-card-header .task-select').click();
  expect(
    await fields.evaluateAll((nodes) => nodes.map((node) => node.dataset.taskIdentity || node.dataset.field)),
  ).toEqual(['type', 'id', 'tasks.0.tasks.0.message', 'tasks.0.tasks.0.timeout', 'tasks.0.tasks.0.retry']);
});

test('SELECT is authored in no-code, saved with values, previewed and executed as a string', async ({
  page,
  request,
}) => {
  const id = unique();
  await open(page, id);
  await add(page, '任务', 'core.Log', 'show');
  await field(page, 'tasks.0.message', 'Selected {{ inputs.region }}');
  await page.getByRole('button', { name: '流程设置', exact: true }).click();
  await page.getByRole('button', { name: '＋ 设置 流程输入', exact: true }).click();
  const inputs = page.locator('[data-field="inputs"]');
  await inputs.getByLabel('新增字段名称', { exact: true }).fill('region');
  await inputs.getByRole('button', { name: '添加', exact: true }).click();
  await page.locator('[data-field="inputs.region.type"]').getByRole('button', { name: /设置/ }).click();
  await expect(page.locator('[data-field="inputs.region.values"]')).toHaveCount(0);
  await page.locator('[data-field="inputs.region.type"] > select').selectOption('SELECT');
  const values = page.locator('[data-field="inputs.region.values"]');
  await values.getByRole('button', { name: '＋ 设置 values', exact: true }).click();
  for (const [index, option] of ['edge-a', 'cloud', '0'].entries()) {
    await values.getByRole('button', { name: '＋ 添加一项', exact: true }).click();
    await field(page, `inputs.region.values.${index}`, option);
  }
  const defaults = page.locator('[data-field="inputs.region.defaultValue"]');
  await defaults.getByRole('button', { name: /设置/ }).click();
  await defaults.locator('select').selectOption('cloud');
  await page.locator('[data-field="inputs.region.required"]').getByRole('button', { name: /设置/ }).click();
  await page.locator('[data-field="inputs.region.required"] > input').check();
  // Removing an option must not silently replace an existing default.
  await page.locator('[data-field="inputs.region.values.1"]').getByRole('button', { name: /移除/ }).click();
  await expect(defaults.locator('select')).toHaveValue('cloud');
  await page.getByRole('button', { name: '保存修订', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('must match');
  await values.getByRole('button', { name: '＋ 添加一项', exact: true }).click();
  await field(page, 'inputs.region.values.2', 'cloud');
  await page.getByRole('tab', { name: '并排编辑', exact: true }).click();
  expect(parse(await page.getByLabel('Flow YAML').inputValue()).inputs.region).toEqual({
    type: 'SELECT',
    values: ['edge-a', '0', 'cloud'],
    defaultValue: 'cloud',
    required: true,
  });
  await page.getByRole('button', { name: '保存修订', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已保存修订 r1');
  const stored = await request.get(`${base}/flows/${id}`, { headers });
  expect((await stored.json()).definition.inputs.region.values).toEqual(['edge-a', '0', 'cloud']);
  await page.getByRole('button', { name: '▷ 执行', exact: true }).click();
  await expect(page.locator('#input-region')).toHaveValue('cloud');
  await page.locator('#input-region').selectOption('0');
  await page.getByRole('button', { name: '预览输入', exact: true }).click();
  await expect(page.locator('.preview-result')).toContainText('"region": "0"');
  await page.locator('.run-panel').screenshot({ path: '.local/evidence/select-input.png' });
  await page.setViewportSize({ width: 650, height: 900 });
  await page.locator('.run-panel').screenshot({ path: '.local/evidence/select-input-narrow.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '启动执行', exact: true }).click();
  await expect(page.locator('h1 .status')).toHaveText('SUCCESS');
  await page.getByRole('tab', { name: '日志', exact: true }).click();
  await expect(page.locator('.log-entry')).toContainText('Selected 0');
});

test('SELECT without a default stays unselected and enforces required input', async ({ page }) => {
  const id = unique();
  await open(
    page,
    id,
    `schemaVersion: 1\nnamespace: lab\nid: ${id}\ninputs:\n  model: {type: SELECT, values: [mlp, cnn], required: true}\ntasks: [{id: show, type: core.Log, message: '{{ inputs.model }}'}]\n`,
  );
  await page.getByRole('button', { name: '保存修订', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已保存修订 r1');
  await page.getByRole('button', { name: '▷ 执行', exact: true }).click();
  const provide = page.locator('.input-field').getByRole('checkbox');
  await expect(provide).not.toBeChecked();
  await page.getByRole('button', { name: '启动执行', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('required');
  await provide.check();
  await expect(page.locator('#input-model')).toHaveValue('');
  await page.getByRole('button', { name: '预览输入', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('请选择列表中的值');
  await page.locator('#input-model').selectOption('cnn');
  await page.getByRole('button', { name: '启动执行', exact: true }).click();
  await expect(page.locator('h1 .status')).toHaveText('SUCCESS');
});

test('revision comparison and rollback create a new revision without overwriting history', async ({
  page,
  request,
}) => {
  const id = unique();
  await open(page, id);
  await add(page, '任务', 'core.Log', 'hello');
  await page.getByRole('button', { name: '保存修订', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('r1');
  await field(page, 'tasks.0.message', 'revision two');
  await page.getByRole('button', { name: '保存修订', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('r2');
  await page.getByRole('tab', { name: '修订历史', exact: true }).click();
  await page.getByRole('button', { name: /^r1 ·/ }).click();
  await expect(page.getByRole('heading', { name: '选中版本 r1' })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '回退为新修订' }).click();
  await expect(page.getByRole('status')).toContainText('修订 r3');
  const response = await request.get(`${base}/flows/${id}`, { headers });
  expect((await response.json()).definition.tasks[0].message).toBe('Hello');
});
