import { test, expect } from '@playwright/test';
const headers = {
  Authorization:
    'Basic ' + Buffer.from(`${process.env.CEA_E2E_USER}:${process.env.CEA_E2E_PASSWORD}`).toString('base64'),
};
const base = '/api/namespaces/lab';
async function login(page) {
  await page.goto('/');
  await page.getByLabel('账号', { exact: true }).fill(process.env.CEA_E2E_USER);
  await page.getByLabel('密码', { exact: true }).fill(process.env.CEA_E2E_PASSWORD);
  await page.getByRole('button', { name: '连接工作空间 →', exact: true }).click();
}
async function nav(page, name) {
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true }).click();
}

test('overview shows database counts and recent navigation with desktop and narrow layouts', async ({
  page,
  request,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  await nav(page, '运行总览');
  const response = await request.get(`${base}/executions/overview?days=7`, { headers });
  expect(response.ok()).toBeTruthy();
  const data = await response.json(),
    total = data.days.reduce((sum, row) => sum + row.count, 0);
  await expect(page.locator('[data-count="执行总数"]')).toHaveText(String(total));
  await expect(page.locator('.daily-bar')).toHaveCount(7);
  await page.screenshot({ path: '.local/evidence/overview-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('总览时间范围').selectOption('30');
  await expect(page.locator('.daily-bar')).toHaveCount(30);
  await expect(page.locator('.daily-column').last()).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: '.local/evidence/overview-narrow.png', fullPage: true });
  await page.getByRole('button', { name: '刷新总览', exact: true }).click();
  await expect(page.locator('.daily-bar')).toHaveCount(30);
  if (data.recent.length) {
    await page.getByRole('button', { name: data.recent[0].id, exact: true }).click();
    await expect(page.locator('.execution-id')).toHaveText(data.recent[0].id);
  }
  expect(errors).toEqual([]);
});

test('read-only Kubernetes inventory uses live configured namespace and exposes connection failures', async ({
  page,
  request,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const id of ['runtime-edge', 'unconnected'])
    expect(
      (
        await request.put(`${base}/resources/clusters/${id}`, {
          headers,
          data: { id, kind: 'EDGE', enabled: true },
        })
      ).ok(),
    ).toBeTruthy();
  await login(page);
  await nav(page, '集群运行资源');
  await page.getByLabel('资源集群').selectOption('runtime-edge');
  await expect(page.getByRole('table', { name: '节点', exact: true })).toContainText('True');
  const nodes = await (
    await request.get(`${base}/clusters/runtime-edge/kubernetes/nodes`, { headers })
  ).json();
  await expect(page.getByRole('table', { name: '节点', exact: true })).toContainText(nodes.items[0].name);
  await page.screenshot({ path: '.local/evidence/resources-desktop.png', fullPage: true });
  await nav(page, '服务资源管理');
  await page.getByLabel('资源集群').selectOption('runtime-edge');
  await page.getByRole('tab', { name: 'Service', exact: true }).click();
  await expect(page.getByLabel('Service Namespace', { exact: true })).toHaveValue('ui-test');
  await expect(page.getByRole('table', { name: 'Service', exact: true })).toContainText('inspection-service');
  await expect(page.getByRole('table', { name: 'Service', exact: true })).toContainText('80/TCP → 8080');
  await nav(page, '服务资源管理');
  await page.getByLabel('资源集群').selectOption('runtime-edge');
  await page.getByRole('tab', { name: 'Kubernetes Namespace', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Kubernetes Namespace', exact: true })).toContainText(
    'ui-test',
  );
  await expect(page.getByRole('table', { name: 'Kubernetes Namespace', exact: true })).not.toContainText(
    'kube-system',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: '.local/evidence/resources-narrow.png', fullPage: true });
  await page.getByLabel('资源集群').selectOption('unconnected');
  await expect(page.getByRole('alert')).toContainText('connection is not configured');
  await expect(page.getByRole('table')).toHaveCount(0);
  await page.getByLabel('资源集群').selectOption('runtime-edge');
  await expect(page.getByRole('table')).toContainText('ui-test');
  expect(errors).toEqual([]);
});
