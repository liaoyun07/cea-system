import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.layoutErrors = [];
  page.layoutWrites = [];
  page.on('pageerror', (e) => page.layoutErrors.push(e.message));
  page.on('request', (r) => {
    if (r.url().includes('/api/') && r.method() !== 'GET') page.layoutWrites.push(r.method());
  });
  await page.goto('/');
  await page.getByLabel('账号', { exact: true }).fill(process.env.CEA_E2E_USER);
  await page.getByLabel('密码', { exact: true }).fill(process.env.CEA_E2E_PASSWORD);
  await page.getByRole('button', { name: '连接工作空间 →', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: '应用与镜像', exact: true }).click();
  await expect(page.getByRole('button', { name: '＋ 注册应用版本', exact: true })).toBeEnabled();
});

test.afterEach(async ({ page }) => {
  expect(page.layoutErrors).toEqual([]);
  expect(page.layoutWrites).toEqual([]);
});

async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    (await page.evaluate(() => innerWidth)) + 1,
  );
}

test('application actions stay together and wrap without overflow', async ({ page }) => {
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const actions = page.getByRole('group', { name: '应用操作', exact: true });
    await expect(actions.getByRole('button')).toHaveText(['＋ 注册应用版本', '上传镜像', '在线构建']);
    const boxes = await actions.getByRole('button').evaluateAll((buttons) =>
      buttons.map((button) => {
        const r = button.getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
      }),
    );
    for (let i = 1; i < boxes.length; i++) {
      const previous = boxes[i - 1],
        current = boxes[i];
      if (Math.abs(current.y - previous.y) < 1) {
        expect(current.x - previous.right).toBeCloseTo(8, 0);
      } else {
        expect(current.y - previous.bottom).toBeCloseTo(8, 0);
      }
    }
    if (width === 1440) {
      const heading = await page.locator('.page-heading').boundingBox();
      expect(boxes[2].right).toBeCloseTo(heading.x + heading.width, 0);
    }
    await noOverflow(page);
    await page.screenshot({ path: `.local/evidence/catalog-actions-${width}.png`, fullPage: true });
  }
});

for (const entry of ['＋ 注册应用版本', '上传镜像', '在线构建']) {
  test(`parameter card labels and draft values remain correct through ${entry}`, async ({ page }) => {
    await page.getByRole('button', { name: entry, exact: true }).click();
    await expect(page.getByLabel('应用 ID', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '＋ 添加参数', exact: true }).click();
    const card = page.getByRole('group', { name: '参数 1', exact: true });
    await expect(card.getByRole('heading', { name: '参数 1', exact: true })).toHaveCount(1);
    expect(
      await card.locator('label').evaluateAll((labels) =>
        labels.map((label) =>
          [...label.childNodes]
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent)
            .join('')
            .trim(),
        ),
      ),
    ).toEqual(['名称', '类型', '默认值（JSON）', '允许值（JSON）', '必填', '数据集参数（STRING）']);
    await card.getByLabel('参数 1 · 名称', { exact: true }).fill('MODEL');
    await expect(card.getByLabel('参数 1 · 类型').locator('option')).toHaveText([
      'STRING',
      'INTEGER',
      'NUMBER',
      'BOOLEAN',
      'OBJECT',
      'ARRAY',
      'SELECT',
    ]);
    await card.getByLabel('参数 1 · 类型').selectOption('SELECT');
    await expect(card.getByLabel('参数 1 · 允许值 JSON')).toHaveAttribute('required', '');
    await card.getByLabel('参数 1 · 类型').selectOption('OBJECT');
    await expect(card.getByLabel('参数 1 · 默认值 JSON')).toHaveJSProperty('tagName', 'TEXTAREA');
    await card.getByLabel('参数 1 · 默认值 JSON').fill('{"batch":32}');
    await card.getByLabel('参数 1 · 类型').selectOption('ARRAY');
    await card.getByLabel('参数 1 · 默认值 JSON').fill('[1,2]');
    await card.getByLabel('参数 1 · 类型').selectOption('STRING');
    await card.getByLabel('参数 1 · 默认值 JSON', { exact: true }).fill('"mlp"');
    await card.getByLabel('参数 1 · 允许值 JSON', { exact: true }).fill('["mlp", "cnn"]');
    await card.getByLabel('必填', { exact: true }).check();
    const defaultBox = await card.getByLabel('参数 1 · 默认值 JSON', { exact: true }).boundingBox();
    const choicesBox = await card.getByLabel('参数 1 · 允许值 JSON', { exact: true }).boundingBox();
    expect(defaultBox.y).toBeCloseTo(choicesBox.y, 0);
    expect(choicesBox.x).toBeGreaterThan(defaultBox.x);
    await page.screenshot({ path: `.local/evidence/catalog-parameter-${entry}-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 1000 });
    await noOverflow(page);
    await expect(card.getByLabel('参数 1 · 默认值 JSON', { exact: true })).toHaveValue('"mlp"');
    await expect(card.getByLabel('参数 1 · 允许值 JSON', { exact: true })).toHaveValue('["mlp", "cnn"]');
    await page.screenshot({ path: `.local/evidence/catalog-parameter-${entry}-narrow.png`, fullPage: true });
    await page.getByRole('button', { name: '＋ 添加参数', exact: true }).click();
    const second = page.getByRole('group', { name: '参数 2', exact: true });
    await second.getByLabel('参数 2 · 名称', { exact: true }).fill('DATASET');
    await second.getByLabel('数据集参数（STRING）', { exact: true }).check();
    await second.getByLabel('参数 2 · 数据格式', { exact: true }).fill('pt');
    await expect(second.getByLabel('参数 2 · 允许值 JSON', { exact: true })).toHaveCount(0);
    await expect(second.getByLabel('参数 2 · 允许的数据集版本', { exact: true })).toBeVisible();
    await second.getByLabel('参数 2 · 类型').selectOption('SELECT');
    await expect(second.getByLabel('数据集参数（STRING）')).not.toBeChecked();
    await expect(second.getByLabel('数据集参数（STRING）')).toBeDisabled();
    await second.getByLabel('参数 2 · 类型').selectOption('STRING');
    await second.getByLabel('数据集参数（STRING）').check();
    await card.getByRole('button', { name: '移除参数 1', exact: true }).click();
    await expect(page.locator('.parameter-card')).toHaveCount(1);
    await expect(card.getByLabel('参数 1 · 名称', { exact: true })).toHaveValue('DATASET');
    await expect(card.getByLabel('参数 1 · 数据格式', { exact: true })).toHaveValue('pt');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: '← 返回列表', exact: true }).click();
    await expect(page.getByRole('group', { name: '应用操作', exact: true })).toBeVisible();
  });
}
