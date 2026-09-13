import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const base = '/api/namespaces/lab';
const auth = (name = process.env.CEA_E2E_USER, password = process.env.CEA_E2E_PASSWORD) => ({
  Authorization: 'Basic ' + Buffer.from(`${name}:${password}`).toString('base64'),
});
const unique = () => `ui10-${randomUUID().slice(0, 8)}`;
async function login(page, name = process.env.CEA_E2E_USER, password = process.env.CEA_E2E_PASSWORD) {
  await page.goto('/');
  await page.getByLabel('账号', { exact: true }).fill(name);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '连接工作空间 →', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
}
const nav = (page, name) =>
  page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true }).click();
async function api(request, path, method = 'get', data) {
  const r = await request[method](base + path, { headers: auth(), ...(data ? { data } : {}) });
  expect(r.ok(), await r.text()).toBeTruthy();
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}
test('flow removal retains historical execution graph, then history is removable', async ({
  page,
  request,
}) => {
  const id = unique();
  await api(request, `/flows/${id}/revisions`, 'post', {
    expectedRevision: 0,
    source: `schemaVersion: 1\nnamespace: lab\nid: ${id}\ntasks: [{id: greet, type: core.Log, message: retained-snapshot}]\n`,
  });
  const submitted = await request.post(base + '/executions', {
    headers: { ...auth(), 'Idempotency-Key': unique() },
    data: { flowId: id, inputs: {} },
  });
  expect(submitted.status()).toBe(202);
  const { executionId } = await submitted.json();
  await expect.poll(async () => (await api(request, `/executions/${executionId}`)).state).toBe('SUCCESS');
  await login(page);
  await page.getByLabel('搜索流程').fill(id);
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  page.once('dialog', (d) => d.accept(id));
  await page.getByRole('button', { name: '删除流程', exact: true }).click();
  await expect(page.getByRole('table')).not.toContainText(id);
  expect((await request.get(base + `/flows/${id}`, { headers: auth() })).status()).toBe(404);
  await nav(page, '执行');
  await page.getByRole('button', { name: executionId, exact: true }).click();
  await page.getByRole('tab', { name: '拓扑', exact: true }).click();
  await expect(page.locator('.execution-graph')).toContainText('greet');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({ path: '.local/evidence/ui10-history-snapshot.png', fullPage: true });
  await nav(page, '执行');
  page.once('dialog', (d) => d.accept(executionId));
  await page
    .getByRole('row')
    .filter({ hasText: executionId })
    .getByRole('button', { name: '删除历史', exact: true })
    .click();
  await expect(page.getByRole('table')).not.toContainText(executionId);
  expect(
    (await request.get(base + `/executions/${executionId}/definition`, { headers: auth() })).status(),
  ).toBe(404);
});
test('dataset version removal hides catalog but never reuses the version', async ({ page, request }) => {
  const id = unique();
  await api(request, '/resources/clusters/runtime-edge', 'put', {
    id: 'runtime-edge',
    kind: 'EDGE',
    enabled: true,
  });
  const data = {
    datasetId: id,
    version: 'v1',
    format: 'txt',
    locations: [{ clusterId: 'runtime-edge', uri: `s3://datasets/${id}/v1/data.txt` }],
  };
  await api(request, `/resources/datasets/${id}/versions/v1`, 'put', data);
  await login(page);
  await nav(page, '数据集');
  await page
    .getByRole('row')
    .filter({ hasText: id })
    .getByRole('button', { name: '详情 →', exact: true })
    .click();
  page.once('dialog', (d) => d.accept(id));
  await page.getByRole('button', { name: '删除数据集版本', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('原始文件保留');
  expect(
    (await request.get(base + `/resources/datasets/${id}/versions/v1`, { headers: auth() })).status(),
  ).toBe(404);
  expect(
    (await request.put(base + `/resources/datasets/${id}/versions/v1`, { headers: auth(), data })).status(),
  ).toBe(409);
});
test('administrator creates ordinary user; personal password change and disable are enforced', async ({
  page,
  request,
  browser,
}) => {
  const name = unique(),
    password = 'Initial-test-123',
    changed = 'Changed-test-456';
  await login(page);
  await nav(page, '用户管理');
  await page.getByRole('button', { name: '＋ 新建用户', exact: true }).click();
  await page.getByLabel('账号', { exact: true }).fill(name);
  await page.getByLabel('初始密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '保存用户', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: name })).toContainText('普通用户');
  await page.screenshot({ path: '.local/evidence/ui10-users.png', fullPage: true });
  const context = await browser.newContext({ baseURL: process.env.CEA_E2E_URL }),
    user = await context.newPage();
  try {
    await login(user, name, password);
    await expect(
      user.getByRole('navigation').getByRole('button', { name: '用户管理', exact: true }),
    ).toHaveCount(0);
    expect((await request.get(base + '/users', { headers: auth(name, password) })).status()).toBe(403);
    await nav(user, '个人中心');
    await user.getByLabel('当前密码', { exact: true }).fill(password);
    await user.getByLabel('新密码', { exact: true }).fill(changed);
    await user.getByLabel('确认新密码', { exact: true }).fill(changed);
    await user.screenshot({ path: '.local/evidence/ui10-profile.png', fullPage: true });
    await user.getByRole('button', { name: '修改密码并重新登录', exact: true }).click();
    await expect(user.getByRole('button', { name: '连接工作空间 →', exact: true })).toBeVisible();
    expect((await request.get(base + '/me', { headers: auth(name, password) })).status()).toBe(401);
    await login(user, name, changed);
    await nav(user, '个人中心');
    await user.setViewportSize({ width: 390, height: 844 });
    expect(await user.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const row = page.getByRole('row').filter({ hasText: name });
    await row.getByRole('button', { name: '重置密码', exact: true }).click();
    await page.getByLabel('新密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '确认重置', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('密码已重置');
    expect((await request.get(base + '/me', { headers: auth(name, changed) })).status()).toBe(401);
    await row.getByRole('button', { name: '编辑用户', exact: true }).click();
    await page.getByLabel('允许登录').uncheck();
    await page.getByRole('button', { name: '保存用户', exact: true }).click();
    await expect(row).toContainText('停用');
    expect((await request.get(base + '/me', { headers: auth(name, password) })).status()).toBe(401);
  } finally {
    await context.close();
  }
});

// Minimal uncompressed ZIP fixture, no dependency or fake builder. CRC validates real ZIP extraction.
function zip(entries) {
  const locals = [],
    central = [];
  let offset = 0;
  for (const [path, text] of Object.entries(entries)) {
    const name = Buffer.from(path),
      data = Buffer.from(text);
    let crc = 0xffffffff;
    for (const b of data) {
      crc ^= b;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50);
    l.writeUInt16LE(20, 4);
    l.writeUInt32LE(crc, 14);
    l.writeUInt32LE(data.length, 18);
    l.writeUInt32LE(data.length, 22);
    l.writeUInt16LE(name.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    locals.push(l, name, data);
    central.push(c, name);
    offset += l.length + name.length + data.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
test('online build imports real BuildKit export, shows logs and rejects failed Dockerfile', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  await login(page);
  await nav(page, '应用与镜像');
  await page.getByRole('button', { name: '在线构建', exact: true }).click();
  const id = unique();
  await page.getByLabel('应用 ID', { exact: true }).fill(id);
  await page.getByLabel('版本', { exact: true }).fill('v1');
  await page.locator('input[type=file]').setInputFiles({
    name: 'source.zip',
    mimeType: 'application/zip',
    buffer: zip({ Dockerfile: 'FROM scratch\nCOPY note /note\n', note: 'built in browser test' }),
  });
  await page.getByRole('button', { name: '构建并登记', exact: true }).click();
  await expect(page.getByRole('heading', { name: '构建日志', exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.locator('.json-preview').filter({ hasText: 'exporting' })).toBeVisible();
  const application = await api(request, `/applications/${id}/versions/v1`);
  expect(application.image).toMatch(/@sha256:[a-f0-9]{64}$/);
  await page.screenshot({ path: '.local/evidence/ui10-build.png', fullPage: true });
  await page.getByRole('button', { name: '← 返回列表', exact: true }).click();
  await page.getByRole('button', { name: '在线构建', exact: true }).click();
  const bad = unique();
  await page.getByLabel('应用 ID', { exact: true }).fill(bad);
  await page.getByLabel('版本', { exact: true }).fill('v1');
  await page.locator('input[type=file]').setInputFiles({
    name: 'invalid.zip',
    mimeType: 'application/zip',
    buffer: zip({ Dockerfile: 'INVALID instruction\n' }),
  });
  await page.getByRole('button', { name: '构建并登记', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('image build failed');
  expect((await request.get(base + `/applications/${bad}/versions/v1`, { headers: auth() })).status()).toBe(
    404,
  );
});
