import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const base = '/api/namespaces/lab';
const auth = (user = process.env.CEA_E2E_USER) => ({
  Authorization: 'Basic ' + Buffer.from(`${user}:${process.env.CEA_E2E_PASSWORD}`).toString('base64'),
});
const unique = () => `ep-${randomUUID().slice(0, 8)}`;
async function get(request, path) {
  const response = await request.get(base + path, { headers: auth() });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function put(request, path, data) {
  const response = await request.put(base + path, { headers: auth(), data });
  expect(response.ok(), await response.text()).toBeTruthy();
}
async function login(page, user = process.env.CEA_E2E_USER) {
  await page.goto('/');
  await page.getByLabel('账号', { exact: true }).fill(user);
  await page.getByLabel('密码', { exact: true }).fill(process.env.CEA_E2E_PASSWORD);
  await page.getByRole('button', { name: '连接工作空间 →' }).click();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '边缘数据处理记录', exact: true })
    .click();
  await expect(page.locator('h1')).toHaveText('边缘数据处理记录');
}
async function setup(request, tasks) {
  await put(request, '/resources/clusters/edge-origin', { id: 'edge-origin', kind: 'EDGE', enabled: true });
  await put(request, '/edge/gateways/gateway-browser', {
    clusterId: 'edge-origin',
    principal: 'gateway-test',
    enabled: true,
  });
  const terminal = unique(),
    policy = unique();
  await put(request, `/edge/terminals/${terminal}`, { gatewayId: 'gateway-browser', enabled: true });
  const data = {
    clusterId: 'edge-origin',
    eventType: policy,
    enabled: true,
    expectedRevision: 0,
    source: `schemaVersion: 1\nnamespace: lab\nid: ${policy}\ntasks:\n${tasks}\n`,
  };
  await put(request, `/edge/policies/${policy}`, data);
  return { terminal, policy, data };
}
async function event(request, fixture) {
  const response = await request.post(`${base}/edge-access/terminals/${fixture.terminal}/events`, {
    headers: { ...auth('gateway-test'), 'Idempotency-Key': unique() },
    data: { eventType: fixture.policy, inputs: {} },
  });
  expect(response.status(), await response.text()).toBe(202);
  return (await response.json()).executionId;
}

test('edge history paginates real policy executions, keeps snapshots and opens shared result detail', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const fixture = await setup(
    request,
    '  - {id: process, type: core.Log, message: processed}\noutputs:\n  result: {source: TASK_OUTPUT, taskId: process, port: message}',
  );
  const ids = [];
  for (let i = 0; i < 21; i++) ids.push(await event(request, fixture));
  await expect.poll(async () => (await get(request, `/executions/${ids.at(-1)}`)).state).toBe('SUCCESS');
  await put(request, `/edge/policies/${fixture.policy}`, {
    ...fixture.data,
    expectedRevision: 1,
    enabled: false,
  });
  // A newer ordinary execution must not displace records before server-side pagination.
  const regular = unique();
  const saved = await request.post(`${base}/flows/${regular}/revisions`, {
    headers: auth(),
    data: {
      expectedRevision: 0,
      source: fixture.data.source.replace(`id: ${fixture.policy}`, `id: ${regular}`),
    },
  });
  expect(saved.status(), await saved.text()).toBe(201);
  const ordinary = await request.post(base + '/executions', {
    headers: { ...auth(), 'Idempotency-Key': unique() },
    data: { flowId: regular, inputs: {} },
  });
  expect(ordinary.status(), await ordinary.text()).toBe(202);
  await login(page, 'viewer');
  await page.getByRole('combobox', { name: '策略', exact: true }).selectOption(fixture.policy);
  const rows = page.locator('.edge-record-table tbody tr');
  await expect(rows).toHaveCount(20);
  const expected = await get(
    request,
    `/edge/processing-records?policyId=${fixture.policy}&limit=20&offset=0`,
  );
  expect(await rows.locator('.mono').allTextContents()).toEqual(expected.map((r) => r.execution.id));
  await expect(rows.first()).toContainText(fixture.terminal);
  await expect(rows.first()).toContainText('gateway-browser');
  await expect(rows.first()).toContainText('edge-origin');
  await expect(rows.first()).toContainText('r1');
  await expect(
    page.getByRole('combobox', { name: '策略', exact: true }).locator('option:checked'),
  ).toContainText('已停用');
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(ids[0]);
  await page.getByRole('button', { name: '详情与结果 →', exact: true }).click();
  await expect(page.locator('h1')).toContainText(fixture.policy);
  await page.getByRole('tab', { name: '输出', exact: true }).click();
  await expect(page.locator('.execution-page')).toContainText('processed');
  await page.getByRole('button', { name: '← 返回处理记录', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(page.locator('.pagination')).toContainText('第 2 页');
  await page.getByRole('combobox', { name: '状态', exact: true }).selectOption('FAILED');
  await expect(page.locator('.empty h2')).toHaveText('暂无处理记录');
  await expect(page.locator('.pagination')).toContainText('第 1 页');
  await page.getByRole('combobox', { name: '状态', exact: true }).selectOption('SUCCESS');
  await expect(rows).toHaveCount(20);
  await page.screenshot({ path: '.local/evidence/edge-records-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: '.local/evidence/edge-records-narrow.png', fullPage: true });
});

test('failed edge work is visible and a query outage is not presented as empty success', async ({
  page,
  request,
}) => {
  const fixture = await setup(
    request,
    '  - {id: timeout, type: core.Sleep, duration: PT5S, timeout: PT0.2S}',
  );
  const id = await event(request, fixture);
  await expect.poll(async () => (await get(request, `/executions/${id}`)).state).toBe('FAILED');
  await login(page);
  await page.getByRole('combobox', { name: '策略', exact: true }).selectOption(fixture.policy);
  await page.getByRole('combobox', { name: '状态', exact: true }).selectOption('FAILED');
  await expect(page.locator('.edge-record-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.edge-record-table .status')).toHaveText('FAILED');
  await page.route('**/edge/processing-records?*', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'UNAVAILABLE', message: 'test query outage' }),
    }),
  );
  await page.getByRole('button', { name: '↻ 刷新', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('503');
  await expect(page.locator('.empty')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeDisabled();
  await page.unroute('**/edge/processing-records?*');
  await page.getByRole('button', { name: '↻ 刷新', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.edge-record-table tbody tr')).toHaveCount(1);
});
