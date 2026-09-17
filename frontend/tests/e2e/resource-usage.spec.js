import { test, expect } from '@playwright/test';

const node = (name) => ({
  name,
  ready: 'True',
  unschedulable: false,
  addresses: ['InternalIP: 127.0.0.1'],
  capacity: { cpu: '8', memory: '8Gi', pods: '110' },
  allocatable: { cpu: '8', memory: '8Gi', pods: '110' },
});
const metric = (name, cpuCores, memoryBytes, status = 'AVAILABLE') => ({
  name,
  usage: { cpuCores, memoryBytes, status, timestamp: '2026-09-18T00:00:00Z', window: 'PT10S' },
});
async function open(page) {
  await page.goto('/');
  await page.getByLabel('账号', { exact: true }).fill(process.env.CEA_E2E_USER);
  await page.getByLabel('密码', { exact: true }).fill(process.env.CEA_E2E_PASSWORD);
  await page.getByRole('button', { name: '连接工作空间 →', exact: true }).click();
  await page.route('**/resources/clusters?*', (route) =>
    route.fulfill({ json: ['a', 'b'].map((id) => ({ id, kind: 'EDGE', enabled: true })) }),
  );
  await page.route('**/kubernetes/nodes?*', (route) =>
    route.fulfill({ json: { items: [node('one')], continueToken: 'next-page' } }),
  );
  await page.getByRole('navigation').getByRole('button', { name: '集群运行资源', exact: true }).click();
}
const refresh = (page) => page.getByRole('button', { name: '刷新资源', exact: true }).click();

test('resource rings use authoritative cluster ratios and all-node usage, not current page averages', async ({
  page,
}) => {
  await page.route('**/kubernetes/usage/nodes', (route) =>
    route.fulfill({
      json: {
        cpuPercent: 25,
        memoryPercent: 75,
        nodes: [metric('one', 1, 2 * 1073741824), metric('two', 5, 10 * 1073741824)],
      },
    }),
  );
  await open(page);
  await expect(page.getByRole('img', { name: '集群 CPU 使用率 25.0%', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: '集群内存使用率 75.0%', exact: true })).toBeVisible();
  await expect(page.locator('.usage-card.cpu')).toContainText('6.000 核');
  await expect(page.locator('.usage-card.memory')).toContainText('12.00 GiB');
  await expect(page.locator('.usage-card.cpu .ring-value')).toHaveAttribute('stroke-dasharray', '25 100');
  await expect(page.getByRole('table', { name: '节点' }).locator('tbody tr')).toHaveCount(1);
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const card of await page.locator('.usage-card').all()) {
      expect(await card.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    await page.screenshot({ path: `.local/evidence/ui15-rings-${width}.png`, fullPage: true });
  }
});

test('resource rings distinguish zero, full, over-capacity and unavailable samples', async ({ page }) => {
  let sample = { cpuPercent: 0, memoryPercent: 100, nodes: [metric('one', 0, 8 * 1073741824)] };
  await page.route('**/kubernetes/usage/nodes', (route) => route.fulfill({ json: sample }));
  await open(page);
  await expect(page.getByRole('img', { name: '集群 CPU 使用率 0.0%', exact: true })).toBeVisible();
  await expect(page.locator('.usage-card.cpu .ring-value')).toHaveCount(0);
  await expect(page.locator('.usage-card.cpu')).toContainText('0.000 核');
  await expect(page.locator('.usage-card.memory .ring-value')).toHaveAttribute('stroke-dasharray', '100 100');
  sample = { cpuPercent: 125, memoryPercent: 100, nodes: [metric('one', 10, 8 * 1073741824)] };
  await refresh(page);
  await expect(page.getByRole('img', { name: '集群 CPU 使用率 125.0%', exact: true })).toBeVisible();
  await expect(page.locator('.usage-card.cpu .ring-value')).toHaveAttribute('stroke-dasharray', '100 100');
  for (const status of ['STALE', 'MISSING', 'INVALID']) {
    sample = { cpuPercent: null, memoryPercent: null, nodes: [metric('one', null, null, status)] };
    await refresh(page);
    await expect(page.getByRole('button', { name: '刷新资源', exact: true })).toBeEnabled();
    await expect(page.getByRole('img', { name: '集群 CPU 使用率 —', exact: true })).toBeVisible();
    await expect(page.locator('.ring-value')).toHaveCount(0);
    await expect(page.locator('.usage-card.cpu')).toContainText('用量不可用');
    await expect(page.locator('.usage-overview')).not.toContainText('0.0%');
  }
});

test('resource refresh failure and switching clusters clear old ring readings', async ({ page }) => {
  let fail = false,
    delayed;
  await page.route('**/kubernetes/usage/nodes', async (route) => {
    if (route.request().url().includes('/clusters/b/')) {
      delayed = route;
      return;
    }
    await route.fulfill(
      fail
        ? { status: 503, json: { message: 'metrics unavailable' } }
        : { json: { cpuPercent: 20, memoryPercent: 30, nodes: [metric('one', 1.6, 1073741824)] } },
    );
  });
  await open(page);
  await expect(page.getByRole('img', { name: '集群 CPU 使用率 20.0%', exact: true })).toBeVisible();
  fail = true;
  await refresh(page);
  await expect(page.getByRole('alert')).toContainText('用量不可用');
  await expect(page.locator('.ring-value')).toHaveCount(0);
  fail = false;
  await refresh(page);
  await expect(page.getByRole('img', { name: '集群 CPU 使用率 20.0%', exact: true })).toBeVisible();
  await page.getByLabel('资源集群', { exact: true }).selectOption('b');
  await expect.poll(() => !!delayed).toBe(true);
  await expect(page.locator('.usage-overview')).toContainText('正在采样');
  await expect(page.locator('.ring-value')).toHaveCount(0);
  await page.getByLabel('资源集群', { exact: true }).selectOption('a');
  await expect(page.getByRole('img', { name: '集群 CPU 使用率 20.0%', exact: true })).toBeVisible();
  await delayed.fulfill({ json: { cpuPercent: 99, memoryPercent: 99, nodes: [] } }).catch(() => {});
  await expect(page.getByRole('img', { name: '集群 CPU 使用率 20.0%', exact: true })).toBeVisible();
});
