import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const headers = {
  Authorization:
    'Basic ' + Buffer.from(`${process.env.CEA_E2E_USER}:${process.env.CEA_E2E_PASSWORD}`).toString('base64'),
};
const base = '/api/namespaces/lab';
async function createAndStart(page, id, yaml) {
  await page.goto('/');
  await page.getByLabel('账号', { exact: true }).fill(process.env.CEA_E2E_USER);
  await page.getByLabel('密码', { exact: true }).fill(process.env.CEA_E2E_PASSWORD);
  await page.getByRole('button', { name: '连接工作空间 →', exact: true }).click();
  await page.getByRole('button', { name: '＋ 新建流程', exact: true }).click();
  await page.getByLabel('流程 ID', { exact: true }).fill(id);
  await page.getByRole('tab', { name: '源代码', exact: true }).click();
  await page.getByLabel('Flow YAML').fill(yaml);
  await page.getByRole('button', { name: '保存修订', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已保存修订 r1');
  await page.getByRole('button', { name: '▷ 执行', exact: true }).click();
  await page.getByRole('button', { name: '启动执行', exact: true }).click();
}

test('real Job JSON artifacts display per-instance numeric metrics, errors, pinned history and responsive charts', async ({
  page,
  request,
}) => {
  test.setTimeout(150000);
  const id = `metrics-${randomUUID().slice(0, 8)}`,
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let result = await request.put(`${base}/resources/clusters/runtime-edge`, {
    headers,
    data: { id: 'runtime-edge', kind: 'EDGE', enabled: true },
  });
  expect(result.ok()).toBeTruthy();
  result = await request.put(`${base}/applications/${id}/versions/v1`, {
    headers,
    data: {
      applicationId: id,
      version: 'v1',
      image: 'ui-registry:5000/alpine:v1',
      parameters: { ROUND: { type: 'INTEGER', required: true } },
    },
  });
  expect(result.ok()).toBeTruthy();
  const command = [
    'sh',
    '-c',
    `printf '{"loss":%s,"accuracy":0.8,"algorithm":"fixture"}' "$ROUND" > /cea-work/out/metrics.json; printf '{"loss":0}' > /cea-work/out/zero.json; printf '[]' > /cea-work/out/invalid.json; printf '{"name":"no numeric metrics"}' > /cea-work/out/text.json`,
  ];
  const yaml = `schemaVersion: 1\nnamespace: lab\nid: ${id}\ntasks:\n  - id: rounds\n    type: core.Loop\n    loop:\n      values: {source: LITERAL, value: [1, 2]}\n      concurrency: 2\n    tasks:\n      - id: measure\n        type: platform.Application\n        timeout: PT60S\n        container:\n          applicationId: ${id}\n          version: v1\n          candidateClusters: [runtime-edge]\n          parameters:\n            ROUND: {source: ITEM, path: [value]}\n          command: ${JSON.stringify(command)}\n          outputFiles: [metrics.json, zero.json, invalid.json, text.json]\n`;
  await createAndStart(page, id, yaml);
  await expect(page.locator('h1 .status')).toHaveText('SUCCESS', { timeout: 90000 });
  const executionId = (await page.locator('.execution-id').textContent()).trim();
  result = await request.post(`${base}/flows/${id}/revisions`, {
    headers,
    data: {
      expectedRevision: 1,
      source: `schemaVersion: 1\nnamespace: lab\nid: ${id}\ntasks: [{id: new, type: core.Log, message: changed}]`,
    },
  });
  expect(result.status()).toBe(201);
  await page.getByRole('tab', { name: 'Metrics', exact: true }).click();
  await expect(page.getByLabel('指标名称')).toHaveValue('accuracy');
  await page.getByLabel('指标名称').selectOption('loss');
  await expect(page.locator('.metric-bar')).toHaveCount(2);
  await expect(page.locator('.metric-bar').first()).toHaveAttribute('data-value', '1');
  await expect(page.locator('.metric-bar').last()).toHaveAttribute('data-value', '2');
  await page.getByRole('button', { name: '刷新指标', exact: true }).click();
  await expect(page.locator('.metric-bar')).toHaveCount(2);
  await expect(page.getByLabel('指标名称')).toHaveValue('loss');
  await expect(page.getByRole('table', { name: '指标明细' })).toContainText('rounds[1] / measure');
  await expect(page.getByRole('table', { name: '指标明细' })).toContainText('rounds[2] / measure');
  const runs = await (await request.get(`${base}/executions/${executionId}/tasks`, { headers })).json();
  for (const run of runs.filter((run) => run.taskId === 'measure')) {
    const data = await (
      await request.get(`${base}/executions/${executionId}/tasks/${run.id}/output-json?port=metrics.json`, {
        headers,
      })
    ).json();
    await expect(page.locator(`.metric-bar[data-task-run="${run.id}"]`)).toHaveAttribute(
      'data-value',
      String(data.loss),
    );
  }
  await page.screenshot({ path: '.local/evidence/metrics-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: '.local/evidence/metrics-narrow.png', fullPage: true });
  await page.getByLabel('指标产物').selectOption('zero.json');
  await expect(page.locator('.metric-bar').first()).toHaveAttribute('data-value', '0');
  await page.getByLabel('指标产物').selectOption('invalid.json');
  await expect(page.getByRole('alert')).toHaveCount(2);
  await expect(page.locator('.metric-bar')).toHaveCount(0);
  await page.getByLabel('指标产物').selectOption('text.json');
  await expect(page.getByRole('cell', { name: '无数值指标', exact: true })).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('an execution with no declared metric artifact shows an empty state without fabricating values', async ({
  page,
}) => {
  const id = `empty-${randomUUID().slice(0, 8)}`;
  await createAndStart(
    page,
    id,
    `schemaVersion: 1\nnamespace: lab\nid: ${id}\ntasks: [{id: log, type: core.Log, message: no-metrics}]`,
  );
  await expect(page.locator('h1 .status')).toHaveText('SUCCESS');
  await page.getByRole('tab', { name: 'Metrics', exact: true }).click();
  await expect(page.getByText('此执行未声明 JSON 指标产物', { exact: true })).toBeVisible();
  await expect(page.locator('.metric-bar')).toHaveCount(0);
});
