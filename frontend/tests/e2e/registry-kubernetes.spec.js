import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const base = '/api/namespaces/lab';
const headers = {
  Authorization:
    'Basic ' + Buffer.from(`${process.env.CEA_E2E_USER}:${process.env.CEA_E2E_PASSWORD}`).toString('base64'),
};
const unique = () => `ui9-${randomUUID().slice(0, 8)}`;
async function login(page) {
  await page.goto('/');
  await page.getByLabel('账号', { exact: true }).fill(process.env.CEA_E2E_USER);
  await page.getByLabel('密码', { exact: true }).fill(process.env.CEA_E2E_PASSWORD);
  await page.getByRole('button', { name: '连接工作空间 →', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
}
const nav = (page, name) =>
  page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true }).click();
async function api(request, path, method = 'get', data) {
  const response = await request[method](base + path, { headers, ...(data ? { data } : {}) });
  expect(response.ok(), await response.text()).toBeTruthy();
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
test.beforeAll(async ({ request }) => {
  await api(request, '/resources/clusters/runtime-edge', 'put', {
    id: 'runtime-edge',
    kind: 'EDGE',
    enabled: true,
  });
});

test('managed namespace and NodePort Service creation, actual detail and precise deletion', async ({
  page,
  request,
}) => {
  const name = `cea-lab-${unique()}`,
    service = unique();
  const k = '/clusters/runtime-edge/kubernetes/namespaces';
  await login(page);
  await nav(page, '运行资源');
  await page.getByLabel('资源集群').selectOption('runtime-edge');
  await page.getByRole('tab', { name: 'Kubernetes Namespace', exact: true }).click();
  await expect(
    page.getByRole('row').filter({ hasText: 'ui-test' }).getByRole('button', { name: '删除 Namespace' }),
  ).toBeDisabled();
  await page.getByRole('button', { name: '创建 Namespace', exact: true }).click();
  await page.getByLabel('Namespace 名称', { exact: true }).fill(name);
  await page.locator('form').getByRole('button', { name: '创建 Namespace', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Kubernetes Namespace', exact: true })).toContainText(name);
  try {
    await page.getByRole('tab', { name: 'Service', exact: true }).click();
    await page.getByLabel('Service Namespace').selectOption(name);
    await page.getByRole('button', { name: '创建 Service', exact: true }).click();
    await page.getByLabel('Service 名称', { exact: true }).fill(service);
    await page.getByRole('combobox', { name: '类型', exact: true }).selectOption('NodePort');
    await page.getByLabel('Selector 值', { exact: true }).fill('example');
    await page.locator('form').getByRole('button', { name: '创建 Service', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Service', exact: true })).toContainText(service);
    await page
      .getByRole('row')
      .filter({ hasText: service })
      .getByRole('button', { name: '访问详情', exact: true })
      .click();
    await expect(page.getByRole('region', { name: 'Service 访问详情' })).toContainText('NodePort');
    const actual = await api(request, `${k}/${name}/services/${service}`);
    expect(actual.ports[0].nodePort).toBeGreaterThan(0);
    await page.screenshot({ path: '.local/evidence/ui09-service.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: '.local/evidence/ui09-service-narrow.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    page.once('dialog', (d) => d.accept(service));
    await page
      .getByRole('row')
      .filter({ hasText: service })
      .getByRole('button', { name: '删除 Service', exact: true })
      .click();
    await expect(page.getByRole('table', { name: 'Service', exact: true })).not.toContainText(service);
    await page.getByRole('tab', { name: 'Kubernetes Namespace', exact: true }).click();
    page.once('dialog', (d) => d.accept(name));
    await page
      .getByRole('row')
      .filter({ hasText: name })
      .getByRole('button', { name: '删除 Namespace', exact: true })
      .click();
    await expect
      .poll(async () => (await api(request, k)).some((n) => n.name === name), { timeout: 30000 })
      .toBe(false);
    expect((await request.get(base + `${k}/kube-system/services`, { headers })).status()).toBe(403);
  } finally {
    const remaining = (await api(request, k)).find((n) => n.name === name);
    if (remaining && remaining.phase !== 'Terminating')
      await api(
        request,
        `${k}/${name}?uid=${remaining.uid}&resourceVersion=${remaining.resourceVersion}`,
        'delete',
      );
  }
});

test('actual image inventory protects catalog reference, then separates catalog and Registry deletion', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const id = unique();
  await login(page);
  await nav(page, '应用与镜像');
  await page.getByRole('button', { name: '上传镜像', exact: true }).click();
  await page.getByLabel('应用 ID', { exact: true }).fill(id);
  await page.getByLabel('版本', { exact: true }).fill('v1');
  await page.locator('input[type=file]').setInputFiles(process.env.CEA_E2E_ARCHIVE);
  await page.getByRole('button', { name: '上传并登记', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已保存到目录', { timeout: 60000 });
  const app = await api(request, `/applications/${id}/versions/v1`),
    digest = app.image.split('@')[1];
  await nav(page, '镜像仓库');
  await page.getByLabel('镜像仓库路径', { exact: true }).selectOption(`lab/${id}`);
  await expect(page.getByRole('table', { name: '实际镜像库存' })).toContainText(digest);
  await page.getByRole('button', { name: '镜像详情', exact: true }).click();
  await expect(page.getByRole('region', { name: '镜像详情' })).toContainText(`应用契约引用：${id}/v1`);
  await expect(page.getByRole('button', { name: '从当前仓库删除镜像', exact: true })).toBeDisabled();
  await api(request, `/applications/${id}/versions/v1`, 'delete');
  expect((await request.get(base + `/applications/${id}/versions/v1`, { headers })).status()).toBe(404);
  // Removing the directory record has not removed the manifest.
  await page.getByRole('button', { name: '刷新库存', exact: true }).click();
  await expect(page.getByRole('table', { name: '实际镜像库存' })).toContainText(digest);
  await page.getByRole('button', { name: '镜像详情', exact: true }).click();
  await expect(page.getByRole('button', { name: '从当前仓库删除镜像', exact: true })).toBeEnabled();
  await page.screenshot({ path: '.local/evidence/ui09-registry.png', fullPage: true });
  page.once('dialog', (d) => d.accept(`lab/${id}@${digest}`));
  await page.getByRole('button', { name: '从当前仓库删除镜像', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('仓库已确认删除 manifest');
  expect(
    (
      await request.get(base + `/registries/ui/image?repository=lab/${id}&digest=${digest}`, { headers })
    ).status(),
  ).toBe(404);
  expect((await request.put(base + `/applications/${id}/versions/v1`, { headers, data: app })).status()).toBe(
    409,
  );
});

test('Service detail associates actual Deployment Pods, not arbitrary namespace Pods', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const id = unique(),
    deployment = `/clusters/runtime-edge/deployments/${id}`;
  await api(request, `/applications/${id}/versions/v1`, 'put', {
    applicationId: id,
    version: 'v1',
    image: 'ui-registry:5000/alpine:v1',
    parameters: {},
  });
  await api(request, deployment, 'put', {
    applicationId: id,
    version: 'v1',
    replicas: 1,
    command: [
      'sh',
      '-c',
      "while true; do printf 'HTTP/1.1 200 OK\\r\\nContent-Length: 4\\r\\nConnection: close\\r\\n\\r\\nui9\\n' | nc -l -p 8080; done",
    ],
    parameters: {},
    readiness: { path: '/', port: 8080 },
  });
  const k = '/clusters/runtime-edge/kubernetes/namespaces/ui-test/services';
  let service;
  try {
    await expect.poll(async () => (await api(request, deployment)).readyReplicas, { timeout: 90000 }).toBe(1);
    service = await api(request, k, 'post', {
      name: id,
      type: 'ClusterIP',
      selector: { 'cea-system/deployment': id },
      ports: [{ name: 'http', port: 80, targetPort: '8080', protocol: 'TCP', nodePort: null }],
    });
    await login(page);
    await nav(page, '运行资源');
    await page.getByLabel('资源集群').selectOption('runtime-edge');
    await page.getByRole('tab', { name: 'Service', exact: true }).click();
    await page
      .getByRole('row')
      .filter({ hasText: id })
      .getByRole('button', { name: '访问详情', exact: true })
      .click();
    const detail = await api(request, `${k}/${id}`);
    expect(detail.pods).toHaveLength(1);
    expect(detail.pods[0].ready).toBe(true);
    await expect(page.getByRole('table', { name: 'Service 关联 Pod' })).toContainText(detail.pods[0].name);
    expect((await request.delete(base + `/applications/${id}/versions/v1`, { headers })).status()).toBe(409);
  } finally {
    if (service)
      await api(
        request,
        `${k}/${id}?uid=${service.uid}&resourceVersion=${service.resourceVersion}`,
        'delete',
      );
    const current = await api(request, deployment);
    await api(request, `${deployment}?resourceVersion=${current.resourceVersion}`, 'delete');
  }
});
