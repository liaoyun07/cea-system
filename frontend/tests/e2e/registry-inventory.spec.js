import { test, expect } from '@playwright/test';

const digest = (i) => `sha256:${i.toString(16).padStart(64, '0')}`;
async function open(page, handler) {
  await page.route('**/registries', (route) =>
    route.fulfill({
      json: [
        { id: 'a', address: 'a:5000' },
        { id: 'b', address: 'b:5000' },
      ],
    }),
  );
  await page.route('**/registries/*/inventory?*', handler);
  await page.goto('/');
  await page.getByLabel('账号', { exact: true }).fill(process.env.CEA_E2E_USER);
  await page.getByLabel('密码', { exact: true }).fill(process.env.CEA_E2E_PASSWORD);
  await page.getByRole('button', { name: '连接工作空间 →', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: '镜像仓库', exact: true }).click();
}
const table = (page) => page.getByRole('table', { name: '实际镜像库存' });
test('registry auto lists images, paginates images across paths and filters optionally', async ({ page }) => {
  const rows = Array.from({ length: 25 }, (_, i) => ({
    repository: 'lab/alpha',
    digest: digest(i),
    tags: [`v${i}`],
  }));
  rows.push({ repository: 'lab/beta', digest: digest(0), tags: [] });
  const requests = [];
  await open(page, (route) => {
    const p = new URL(route.request().url()).searchParams;
    requests.push(Object.fromEntries(p));
    const filtered = rows.filter((r) => r.repository.includes(p.get('repository') || ''));
    const index = p.has('afterRepository')
      ? filtered.findIndex(
          (r) => r.repository === p.get('afterRepository') && r.digest === p.get('afterDigest'),
        ) + 1
      : 0;
    const images = filtered.slice(index, index + 20),
      last = images.at(-1);
    return route.fulfill({
      json: {
        images,
        next: index + 20 < filtered.length ? { repository: last.repository, digest: last.digest } : null,
      },
    });
  });
  await expect(table(page).locator('tbody tr')).toHaveCount(20);
  expect(requests[0]).toEqual({ limit: '20' });
  await expect(page.getByLabel('镜像仓库路径')).toHaveValue('');
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(table(page).locator('tbody tr')).toHaveCount(6);
  await expect(table(page)).toContainText('lab/beta');
  await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await expect(table(page).locator('tbody tr')).toHaveCount(20);
  await page.getByLabel('镜像仓库路径').fill('beta');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await expect(table(page).locator('tbody tr')).toHaveCount(1);
  await expect(table(page)).toContainText('无标签 · 000000000000…');
  await expect(page.getByRole('button', { name: '上一页', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '清除', exact: true }).click();
  await expect(table(page).locator('tbody tr')).toHaveCount(20);
  await page.setViewportSize({ width: 390, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: '.local/evidence/registry-inventory-narrow.png', fullPage: true });
});

test('row details and deletion use row repository even for shared digests', async ({ page }) => {
  let rows = ['lab/alpha', 'lab/beta'].map((repository) => ({ repository, digest: digest(0), tags: ['v1'] }));
  const detailRequests = [];
  await page.route('**/registries/*/image?*', (route) => {
    const p = new URL(route.request().url()).searchParams;
    detailRequests.push({ method: route.request().method(), ...Object.fromEntries(p) });
    if (route.request().method() === 'DELETE') {
      rows = rows.filter((r) => r.repository !== p.get('repository'));
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({
      json: {
        repository: p.get('repository'),
        digest: digest(0),
        tags: ['v1'],
        mediaType: 'test',
        layerBytes: 12,
        created: null,
        platforms: [],
        blockers: [],
      },
    });
  });
  await open(page, (route) => route.fulfill({ json: { images: rows, next: null } }));
  await expect(table(page).locator('tbody tr')).toHaveCount(2);
  await table(page)
    .getByRole('row')
    .filter({ hasText: 'lab/beta' })
    .getByRole('button', { name: '镜像详情', exact: true })
    .click();
  await expect(page.getByRole('region', { name: '镜像详情' })).toContainText('lab/beta');
  await expect(page.getByRole('region', { name: '镜像详情' })).toContainText(digest(0));
  page.once('dialog', (d) => d.accept(`lab/beta@${digest(0)}`));
  await page.getByRole('button', { name: '从当前仓库删除镜像', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('仓库已确认删除 manifest');
  await expect(table(page).locator('tbody tr')).toHaveCount(1);
  await expect(table(page)).toContainText('lab/alpha');
  expect(detailRequests.map((r) => [r.method, r.repository])).toEqual([
    ['GET', 'lab/beta'],
    ['DELETE', 'lab/beta'],
  ]);
  expect(detailRequests.every((r) => r.digest === digest(0))).toBe(true);
  expect(detailRequests[1].confirmation).toBe(`lab/beta@${digest(0)}`);
});

test('inventory shows tags or short digests while detail uses the full digest', async ({ page }) => {
  const rows = [
    { repository: 'lab/train', digest: `sha256:${'a1'.repeat(32)}`, tags: ['v1', 'stable'] },
    { repository: 'lab/train', digest: `sha256:${'b2'.repeat(32)}`, tags: [] },
    { repository: 'lab/train', digest: `sha256:${'c3'.repeat(32)}`, tags: [] },
  ];
  let requested;
  await page.route('**/registries/*/image?*', (route) => {
    requested = Object.fromEntries(new URL(route.request().url()).searchParams);
    return route.fulfill({
      json: { ...rows[1], mediaType: 'test', layerBytes: 12, created: null, platforms: [], blockers: [] },
    });
  });
  await open(page, (route) => route.fulfill({ json: { images: rows, next: null } }));
  await expect(table(page).getByRole('columnheader')).toHaveText(['镜像路径', '标签 / 短摘要', '操作']);
  const cells = table(page).locator('tbody tr td:nth-child(2)');
  await expect(cells).toHaveText(['v1, stable', '无标签 · b2b2b2b2b2b2…', '无标签 · c3c3c3c3c3c3…']);
  await expect(table(page)).not.toContainText('sha256:');
  await expect(table(page)).not.toContainText('a1a1a1a1a1a1');
  await page.screenshot({ path: '.local/evidence/registry-identifiers-desktop.png', fullPage: true });
  await table(page).getByRole('button', { name: '镜像详情', exact: true }).nth(1).click();
  await expect(page.getByRole('region', { name: '镜像详情' })).toContainText(rows[1].digest);
  expect(requested).toEqual({ repository: rows[1].repository, digest: rows[1].digest });
  await page.setViewportSize({ width: 390, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: '.local/evidence/registry-identifiers-narrow.png', fullPage: true });
});

test('empty and failed searches clear old rows and late responses cannot replace switched registry', async ({
  page,
}) => {
  let release, started, finished;
  const slow = new Promise((r) => (release = r)),
    sent = new Promise((r) => (started = r)),
    delivered = new Promise((r) => (finished = r));
  await open(page, async (route) => {
    const url = new URL(route.request().url()),
      query = url.searchParams.get('repository');
    if (query === 'slow') {
      started();
      await slow;
    }
    if (query === 'error') return route.fulfill({ status: 503, json: { message: 'inventory unavailable' } });
    await route.fulfill({
      json: {
        images:
          query === 'missing'
            ? []
            : [
                {
                  repository: url.pathname.includes('/b/') ? 'lab/second' : 'lab/first',
                  digest: digest(1),
                  tags: ['v1'],
                },
              ],
        next: null,
      },
    });
    if (query === 'slow') finished();
  });
  await expect(table(page)).toContainText('lab/first');
  await page.getByLabel('镜像仓库路径').fill('missing');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await expect(page.getByText('没有符合筛选条件的镜像', { exact: true })).toBeVisible();
  await page.getByLabel('镜像仓库路径').fill('error');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(table(page).locator('tbody tr')).toHaveCount(0);
  await page.getByRole('button', { name: '清除', exact: true }).click();
  await expect(table(page)).toContainText('lab/first');
  await page.getByLabel('镜像仓库路径').fill('slow');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await sent;
  await page.getByRole('combobox', { name: '镜像仓库', exact: true }).selectOption('b');
  await expect(table(page)).toContainText('lab/second');
  release();
  await delivered;
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await expect(page.getByLabel('镜像仓库路径')).toHaveValue('');
  await expect(table(page)).not.toContainText('lab/first');
  await page.screenshot({ path: '.local/evidence/registry-inventory-desktop.png', fullPage: true });
});
