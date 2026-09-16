import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const base = '/api/namespaces/lab';
const headers = {
  Authorization:
    'Basic ' + Buffer.from(`${process.env.CEA_E2E_USER}:${process.env.CEA_E2E_PASSWORD}`).toString('base64'),
};
const unique = () => `op-${randomUUID().slice(0, 8)}`;
async function login(page, user = process.env.CEA_E2E_USER) {
  await page.goto('/');
  await page.getByLabel('账号', { exact: true }).fill(user);
  await page.getByLabel('密码', { exact: true }).fill(process.env.CEA_E2E_PASSWORD);
  await page.getByRole('button', { name: '连接工作空间 →', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
}
async function nav(page, name) {
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true }).click();
}
async function get(request, path) {
  const r = await request.get(base + path, { headers });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
async function put(request, path, data) {
  const r = await request.put(base + path, { headers, data });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
test.beforeAll(async ({ request }) => {
  await put(request, '/resources/clusters/runtime-edge', { id: 'runtime-edge', kind: 'EDGE', enabled: true });
});
test('real archive upload and on-demand distribution history, invalid archive never registered', async ({
  page,
  request,
}) => {
  test.setTimeout(150000);
  const id = unique();
  await put(request, '/resources/clusters/distribution-edge', {
    id: 'distribution-edge',
    kind: 'EDGE',
    enabled: true,
  });
  await login(page);
  await nav(page, '应用与镜像');
  await page.getByRole('button', { name: '上传镜像', exact: true }).click();
  await expect(page.getByLabel('镜像引用', { exact: true })).toHaveCount(0);
  await page.getByLabel('应用 ID', { exact: true }).fill(id);
  await page.getByLabel('版本', { exact: true }).fill('v1');
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'bad.tar', mimeType: 'application/x-tar', buffer: Buffer.from('not a tar') });
  await page.getByRole('button', { name: '上传并登记', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('502', { timeout: 30000 });
  expect((await request.get(`${base}/applications/${id}/versions/v1`, { headers })).status()).toBe(404);
  await page.locator('input[type=file]').setInputFiles(process.env.CEA_E2E_ARCHIVE);
  await page.getByRole('button', { name: '上传并登记', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已保存到目录', { timeout: 60000 });
  const app = await get(request, `/applications/${id}/versions/v1`);
  expect(app.image).toMatch(/^ui-registry:5000\/lab\/op-.*@sha256:[a-f0-9]{64}$/);
  await expect(page.getByLabel('镜像引用', { exact: true })).toHaveValue(app.image);
  await page.getByLabel('目标集群', { exact: true }).selectOption('distribution-edge');
  await page.getByRole('button', { name: '准备镜像', exact: true }).click();
  await expect(page.getByRole('table', { name: '按需分发历史' })).toContainText('成功', { timeout: 60000 });
  expect((await get(request, `/applications/${id}/versions/v1/preparations`))[0].state).toBe('SUCCEEDED');
  await page.getByRole('button', { name: '准备镜像', exact: true }).click();
  await expect(page.getByRole('button', { name: '准备镜像', exact: true })).toBeEnabled();
  expect(await get(request, `/applications/${id}/versions/v1/preparations`)).toHaveLength(1);
  await page.screenshot({ path: '.local/evidence/operations-upload-history.png', fullPage: true });
});
test('deployment config edit and scale use current CAS, show real timing and preserve history', async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  const id = unique(),
    path = `/clusters/runtime-edge/deployments/${id}`;
  await put(request, `/applications/${id}/versions/v1`, {
    applicationId: id,
    version: 'v1',
    image: 'ui-registry:5000/alpine:v1',
    parameters: { LABEL: { type: 'STRING', defaultValue: 'before' } },
  });
  await put(request, path, {
    applicationId: id,
    version: 'v1',
    replicas: 1,
    parameters: {},
    command: ['/bin/sh', '-c', 'exec sleep 600'],
  });
  try {
    await expect
      .poll(async () => (await get(request, path)).latestOperation.state, { timeout: 90000 })
      .toBe('SUCCEEDED');
    expect((await get(request, path)).latestOperation.durationMs).toBeGreaterThan(0);
    await login(page);
    await nav(page, '应用部署');
    await page.getByLabel('执行集群', { exact: true }).selectOption('runtime-edge');
    await page
      .getByRole('row')
      .filter({ has: page.getByRole('cell', { name: id, exact: true }) })
      .getByRole('button', { name: '详情 →', exact: true })
      .click();
    await page.getByRole('button', { name: '编辑配置', exact: true }).click();
    await expect(page.getByLabel('部署名称', { exact: true })).toBeDisabled();
    await expect(page.getByLabel('参数值 JSON', { exact: true })).toHaveValue(/before/);
    await page.getByLabel('参数值 JSON', { exact: true }).fill('{"LABEL":"after"}');
    await page.getByRole('button', { name: '保存部署', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('部署配置已被接受', { timeout: 60000 });
    await expect
      .poll(async () => (await get(request, path)).latestOperation.state, { timeout: 60000 })
      .toBe('SUCCEEDED');
    expect((await get(request, `${path}/configuration`)).parameters.LABEL).toBe('after');
    await page.getByRole('button', { name: '↻ 刷新状态', exact: true }).click();
    await expect(page.getByRole('button', { name: '编辑配置', exact: true })).toBeEnabled();
    const before = (await get(request, `/applications/${id}/versions/v1/preparations`)).length;
    await page.getByLabel('调整副本数', { exact: true }).fill('0');
    await page.getByRole('button', { name: '应用副本数', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('副本配置已提交');
    await expect
      .poll(async () => (await get(request, path)).latestOperation.state, { timeout: 60000 })
      .toBe('SUCCEEDED');
    expect((await get(request, path)).latestOperation.durationMs).toBeNull();
    expect((await get(request, `/applications/${id}/versions/v1/preparations`)).length).toBe(before);
    await page.getByRole('button', { name: '↻ 刷新状态', exact: true }).click();
    await expect(page.getByRole('table', { name: '部署操作历史' })).toContainText('扩缩容');
    await expect(page.getByRole('button', { name: '编辑配置', exact: true })).toBeEnabled();
    await page.setViewportSize({ width: 650, height: 900 });
    await page.screenshot({ path: '.local/evidence/operations-deployment-narrow.png', fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  } finally {
    const current = await get(request, path);
    await request.delete(`${base}${path}?resourceVersion=${current.resourceVersion}`, { headers });
  }
});
test('node metrics remain while the container usage tab and requests are removed', async ({
  page,
  request,
}) => {
  test.setTimeout(150000);
  await expect
    .poll(
      async () => {
        const r = await request.get(`${base}/clusters/runtime-edge/kubernetes/usage/nodes`, { headers });
        return r.ok() && (await r.json()).nodes.some((n) => n.usage.status === 'AVAILABLE');
      },
      { timeout: 120000 },
    )
    .toBeTruthy();
  const podUsageRequests = [];
  page.on('request', (request) => {
    if (request.url().includes('/kubernetes/usage/pods')) podUsageRequests.push(request.url());
  });
  await login(page, 'viewer');
  await nav(page, '运行资源');
  await page.getByLabel('资源集群', { exact: true }).selectOption('runtime-edge');
  await expect(page.getByText(/集群 CPU 使用率 \d/)).toBeVisible();
  await expect(page.getByRole('table', { name: '节点', exact: true })).toContainText('可用');
  await expect(page.getByRole('table', { name: '节点', exact: true })).not.toContainText('javaDuration');
  await page.screenshot({ path: '.local/evidence/operations-node-usage.png', fullPage: true });
  await expect(page.getByRole('tablist', { name: 'Kubernetes 资源类型' }).getByRole('tab')).toHaveText([
    '节点',
    'Service',
    'Ingress',
    'Kubernetes Namespace',
  ]);
  await expect(page.getByRole('tab', { name: '容器用量', exact: true })).toHaveCount(0);
  for (const name of ['Service', 'Kubernetes Namespace', '节点']) {
    await page.getByRole('tab', { name, exact: true }).click();
    await expect(page.getByRole('table', { name, exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: '刷新资源', exact: true }).click();
  await expect(page.getByText(/集群 CPU 使用率 \d/)).toBeVisible();
  await page.setViewportSize({ width: 650, height: 900 });
  await expect(page.getByRole('tab', { name: '容器用量', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/evidence/operations-node-only-narrow.png', fullPage: true });
  expect(podUsageRequests).toEqual([]);
});
