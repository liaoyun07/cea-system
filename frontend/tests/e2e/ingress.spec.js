import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const base = '/api/namespaces/lab';
const auth = (user) => ({
  Authorization: 'Basic ' + Buffer.from(`${user}:${process.env.CEA_E2E_PASSWORD}`).toString('base64'),
});
const headers = auth(process.env.CEA_E2E_USER);
const k = '/clusters/runtime-edge/kubernetes';
const path = `${k}/namespaces/ui-test`;
const identity = (row) => `uid=${row.uid}&resourceVersion=${row.resourceVersion}`;
async function api(request, route, method = 'get', data) {
  const response = await request[method](base + route, { headers, ...(data ? { data } : {}) });
  expect(response.ok(), await response.text()).toBeTruthy();
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
async function login(page, user = process.env.CEA_E2E_USER) {
  await page.goto('/');
  await page.getByLabel('账号', { exact: true }).fill(user);
  await page.getByLabel('密码', { exact: true }).fill(process.env.CEA_E2E_PASSWORD);
  await page.getByRole('button', { name: '连接工作空间 →', exact: true }).click();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '服务与访问入口', exact: true })
    .click();
  await page.getByLabel('资源集群').selectOption('runtime-edge');
  await page.getByRole('tab', { name: 'Ingress', exact: true }).click();
}
test('Ingress UI CRUD and actual Traefik Host/Exact/Prefix routing, stale edits and backend preservation', async ({
  page,
  request,
}) => {
  test.setTimeout(150000);
  const id = `ing-${randomUUID().slice(0, 8)}`;
  await api(request, '/resources/clusters/runtime-edge', 'put', {
    id: 'runtime-edge',
    kind: 'EDGE',
    enabled: true,
  });
  await api(request, `/applications/${id}/versions/v1`, 'put', {
    applicationId: id,
    version: 'v1',
    image: 'ui-registry:5000/alpine:v1',
    parameters: {},
  });
  const deployment = `/clusters/runtime-edge/deployments/${id}`;
  await api(request, deployment, 'put', {
    applicationId: id,
    version: 'v1',
    replicas: 1,
    parameters: {},
    readiness: { path: '/', port: 8080 },
    command: [
      'sh',
      '-c',
      "while true; do printf 'HTTP/1.1 200 OK\\r\\nContent-Length: 11\\r\\nConnection: close\\r\\n\\r\\ningress-ok\\n' | nc -l -p 8080; done",
    ],
  });
  let service;
  try {
    await expect.poll(async () => (await api(request, deployment)).readyReplicas, { timeout: 90000 }).toBe(1);
    service = await api(request, `${path}/services`, 'post', {
      name: id,
      type: 'ClusterIP',
      selector: { 'cea-system/deployment': id },
      ports: [{ name: 'http', port: 80, targetPort: '8080', protocol: 'TCP', nodePort: null }],
    });
    await login(page);
    await page.getByRole('button', { name: '创建 Ingress', exact: true }).click();
    await page.getByLabel('Ingress 名称', { exact: true }).fill(id);
    await page.getByLabel('域名', { exact: true }).fill('demo.example.test');
    await page.getByLabel('路径', { exact: true }).fill('/api');
    await page.getByRole('combobox', { name: 'Service', exact: true }).selectOption(id);
    await page.getByRole('button', { name: '保存 Ingress', exact: true }).click();
    const row = page
      .getByRole('table', { name: 'Ingress', exact: true })
      .getByRole('row')
      .filter({ hasText: id });
    await expect(row).toBeVisible();
    const original = await api(request, `${path}/ingresses/${id}`);
    const routed = (route, host = 'demo.example.test') =>
      request.get(process.env.CEA_E2E_INGRESS + route, { headers: { Host: host } });
    await expect.poll(async () => (await routed('/api/child')).status()).toBe(200);
    expect(await (await routed('/api/child')).text()).toContain('ingress-ok');
    expect((await routed('/api/child', 'wrong.example.test')).status()).toBe(404);
    expect((await routed('/api-other')).status()).toBe(404);
    expect(
      (await request.delete(base + `${path}/services/${id}?${identity(service)}`, { headers })).status(),
    ).toBe(409);
    await row.getByRole('button', { name: '详情', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Ingress 详情' })).toContainText(
      process.env.CEA_E2E_INGRESS,
    );
    await page.screenshot({ path: '.local/evidence/ingress-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: '.local/evidence/ingress-narrow.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await row.getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByLabel('路径', { exact: true }).fill('/api/child');
    await page.getByRole('combobox', { name: '匹配', exact: true }).selectOption('Exact');
    await page.getByRole('button', { name: '保存 Ingress', exact: true }).click();
    await expect(row).toContainText('Exact');
    await expect.poll(async () => (await routed('/api/')).status()).toBe(404);
    expect((await routed('/api/child')).status()).toBe(200);
    expect((await routed('/api/child/more')).status()).toBe(404);
    expect(
      (
        await request.put(base + `${path}/ingresses/${id}?${identity(original)}`, {
          headers,
          data: { name: id, ingressClassName: 'cea-traefik', routes: original.routes },
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await request.post(base + `${path}/ingresses`, {
          headers: auth('viewer'),
          data: { name: 'denied', ingressClassName: 'cea-traefik', routes: original.routes },
        })
      ).status(),
    ).toBe(403);
    expect((await request.get(base + `${k}/namespaces/kube-system/ingresses`, { headers })).status()).toBe(
      403,
    );
    const invalid = {
      name: `${id}-bad`,
      ingressClassName: 'cea-traefik',
      routes: [{ host: '', path: '/', pathType: 'Prefix', service: id, port: 8080 }],
    };
    expect((await request.post(base + `${path}/ingresses`, { headers, data: invalid })).status()).toBe(422);
    page.once('dialog', (d) => d.accept(id));
    await row.getByRole('button', { name: '删除 Ingress', exact: true }).click();
    await expect(row).toHaveCount(0);
    await expect.poll(async () => (await routed('/api/child')).status()).toBe(404);
    expect((await api(request, `${path}/services/${id}`)).pods).toHaveLength(1);
    expect((await api(request, deployment)).readyReplicas).toBe(1);
  } finally {
    const left = (await api(request, `${path}/ingresses`)).find((r) => r.name === id);
    if (left) await api(request, `${path}/ingresses/${id}?${identity(left)}`, 'delete');
    if (service) await api(request, `${path}/services/${id}?${identity(service)}`, 'delete');
    const current = await api(request, deployment);
    await api(request, `${deployment}?resourceVersion=${current.resourceVersion}`, 'delete');
  }
});
