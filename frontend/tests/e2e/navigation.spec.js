import { test, expect } from '@playwright/test';

const modules = [
  '云边端协同数据流处理',
  '模块化边缘服务部署',
  '智能任务卸载',
  '多云协作',
  '基础资源管理',
  '系统管理',
];
const menus = [
  '运行总览',
  '数据流编排',
  '数据流执行记录',
  '数据集管理',
  '应用与镜像',
  '镜像仓库',
  '边缘服务部署',
  '服务资源管理',
  '任务卸载决策记录',
  '应用分发记录',
  '边缘数据处理策略',
  '边缘数据处理记录',
  '集群管理',
  '集群运行资源',
  '边缘网关管理',
  '终端设备接入',
  '用户管理',
  '个人中心',
];
async function login(page, user = process.env.CEA_E2E_USER) {
  await page.goto('/');
  await page.getByLabel('账号', { exact: true }).fill(user);
  await page.getByLabel('密码', { exact: true }).fill(process.env.CEA_E2E_PASSWORD);
  await page.getByRole('button', { name: '连接工作空间 →', exact: true }).click();
  await expect(page.getByRole('navigation')).toBeVisible();
}
const nav = (page, name) => page.getByRole('navigation').getByRole('button', { name, exact: true }).click();

test('proposal modules, system brand, matching headings and dark scrollable navigation', async ({ page }) => {
  await login(page);
  await expect(page).toHaveTitle('云边端协同数据流处理系统');
  await expect(page.locator('.brand strong')).toHaveText('云边端协同数据流处理系统');
  await expect(page.locator('.nav-caption')).toHaveText(modules);
  await expect(page.locator('.nav-caption').first()).toHaveCSS('font-size', '16px');
  await expect(page.locator('.nav-caption').first()).toHaveCSS('font-weight', '700');
  await expect(page.locator('.nav-caption').first()).toHaveCSS('color', 'rgb(228, 220, 241)');
  await expect(page.getByRole('navigation').getByRole('button')).toHaveText(menus);
  const active = page.getByRole('navigation').locator('[aria-current="page"]');
  const overview = page.getByRole('navigation').getByRole('button', { name: '运行总览', exact: true });
  await expect(active).toHaveCSS('font-weight', '700');
  await expect(overview).toHaveCSS('font-weight', '400');
  await expect(overview).toHaveCSS('padding-left', '24px');
  await active.hover();
  await expect(active).toHaveCSS('background-color', 'rgb(60, 46, 89)');
  await overview.hover();
  await expect(overview).toHaveCSS('background-color', 'rgb(51, 44, 70)');
  await overview.focus();
  await page.keyboard.press('Tab');
  await expect(active).toBeFocused();
  await expect(active).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Enter');
  await expect(page.locator('h1')).toHaveText('数据流编排');
  const style = await page.locator('.sidebar nav').evaluate((el) => ({
    width: getComputedStyle(el).scrollbarWidth,
    color: getComputedStyle(el).scrollbarColor,
    overflows: el.scrollHeight > el.clientHeight,
  }));
  expect(style.width).toBe('thin');
  expect(style.color).toContain('rgba(0, 0, 0, 0)');
  expect(style.overflows).toBe(true);
  await page.screenshot({ path: '.local/evidence/nav01-desktop.png', fullPage: true });
  for (const name of menus) {
    await nav(page, name);
    await expect(page.locator('h1')).toHaveText(name);
    await expect(page.locator('.breadcrumb button')).toHaveText(name);
    if (name === '用户管理')
      await expect(page.getByRole('button', { name: '＋ 新建用户', exact: true })).toBeEnabled();
    await expect(page.getByRole('navigation').locator('[aria-current="page"]')).toHaveAttribute(
      'aria-label',
      name,
    );
  }
  await nav(page, '集群运行资源');
  await expect(page.getByRole('tab')).toHaveText(['节点']);
  await nav(page, '服务资源管理');
  await expect(page.getByRole('tab')).toHaveText(['Service', 'Ingress', 'Kubernetes Namespace']);
  await page.setViewportSize({ width: 900, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await nav(page, '个人中心');
  await expect(page.getByRole('navigation').getByRole('button')).toHaveText(menus);
  await expect(active).toBeInViewport();
  await expect(active).toHaveCSS('padding-left', '14px');
  await expect(page.locator('.brand strong')).toBeVisible();
  await expect(page.locator('.brand strong span')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: '.local/evidence/nav01-narrow.png', fullPage: true });
});

test('ordinary user navigation hides admin only menu without losing system grouping', async ({ page }) => {
  await login(page, 'viewer');
  await expect(
    page.getByRole('navigation').getByRole('button', { name: '用户管理', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('navigation').getByRole('button')).toHaveText(
    menus.filter((name) => name !== '用户管理'),
  );
  await expect(page.locator('.nav-caption')).toHaveText(modules);
  await nav(page, '个人中心');
  await expect(page.locator('h1')).toHaveText('个人中心');
});

test('distribution pagination resets on version change and ignores an obsolete request', async ({ page }) => {
  await login(page);
  await page.route('**/applications?*', (route) =>
    route.fulfill({
      json: [
        { applicationId: 'nav-a', version: 'v1' },
        { applicationId: 'nav-b', version: 'v2' },
      ],
    }),
  );
  let delayed;
  const history = async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('nav-b')) {
      await route.fulfill({ json: [] });
      return;
    }
    if (url.searchParams.get('offset') === '20') {
      delayed = route;
      return;
    }
    await route.fulfill({
      json: Array.from({ length: 21 }, (_, i) => ({
        id: String(i),
        applicationId: 'nav-a',
        version: 'v1',
        clusterId: 'history-edge',
        state: 'SUCCEEDED',
        requestedBy: 'owner',
        startedAt: '2026-09-17T00:00:00Z',
        finishedAt: '2026-09-17T00:00:01Z',
        sourceImage: 'registry/app@sha256:source',
        targetImage: 'edge/app@sha256:target',
      })),
    });
  };
  await page.route('**/image-distributions?*', history);
  await page.route('**/applications/*/versions/*/preparations?*', history);
  await nav(page, '应用分发记录');
  await expect(page.getByLabel('分发记录应用版本')).toHaveValue('');
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(20);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect.poll(() => !!delayed).toBe(true);
  await page.getByLabel('分发记录应用版本').selectOption('nav-b/v2');
  await expect(page.getByText('暂无分发记录', { exact: true })).toBeVisible();
  await delayed.fulfill({ json: [{ id: 'old', clusterId: 'obsolete-cluster' }] }).catch(() => {});
  await expect(page.getByText('第 1 页', { exact: true })).toBeVisible();
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '上一页', exact: true })).toBeDisabled();
});
