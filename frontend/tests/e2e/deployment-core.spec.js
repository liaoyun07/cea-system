import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const base = '/api/namespaces/lab';
const headers = {
  Authorization:
    'Basic ' + Buffer.from(`${process.env.CEA_E2E_USER}:${process.env.CEA_E2E_PASSWORD}`).toString('base64'),
};
const scope = '/clusters/runtime-edge/kubernetes/namespaces/ui-test';
const identity = (r) => `uid=${r.uid}&resourceVersion=${r.resourceVersion}`;
const unique = () => `ui16-${randomUUID().slice(0, 8)}`;
async function api(request, path, method = 'get', data) {
  const r = await request[method](base + path, { headers, ...(data ? { data } : {}) });
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.text()) ? r.json() : null;
}
async function nav(page, name) {
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true }).click();
}
async function login(page) {
  await page.goto('/');
  await page.getByLabel('账号', { exact: true }).fill(process.env.CEA_E2E_USER);
  await page.getByLabel('密码', { exact: true }).fill(process.env.CEA_E2E_PASSWORD);
  await page.getByRole('button', { name: '连接工作空间 →', exact: true }).click();
  await nav(page, '边缘服务部署');
  await page.getByLabel('执行集群', { exact: true }).selectOption('runtime-edge');
}
async function detail(page, name) {
  await page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name, exact: true }) })
    .getByRole('button', { name: '详情 →', exact: true })
    .click();
  await expect(page.getByRole('button', { name: '编辑配置', exact: true })).toBeEnabled();
}
async function app(request, id, parameters = {}, version = 'v1') {
  await api(request, `/applications/${id}/versions/${version}`, 'put', {
    applicationId: id,
    version,
    image: 'ui-registry:5000/alpine:v1',
    parameters,
  });
}
async function remove(request, path) {
  const current = await api(request, path);
  await api(request, `${path}?resourceVersion=${current.resourceVersion}`, 'delete');
}
test.beforeAll(async ({ request }) => {
  await api(request, '/resources/clusters/runtime-edge', 'put', {
    id: 'runtime-edge',
    kind: 'EDGE',
    enabled: true,
  });
});

test('Namespace selection isolates same-name deployments, mutations, history and access setup', async ({
  page,
  request,
}) => {
  test.setTimeout(240000);
  const id = unique(),
    root = '/clusters/runtime-edge/kubernetes/namespaces';
  const a = `cea-lab-a-${id}`,
    b = `cea-lab-b-${id}`;
  const target = (ns) => `${root}/${ns}/deployments/${id}`;
  await app(request, id);
  for (const name of [a, b]) await api(request, root, 'post', { name });
  try {
    await login(page);
    await expect(page.getByLabel('部署 Namespace')).toHaveValue('ui-test');
    for (const ns of [a, b]) {
      await page.getByLabel('部署 Namespace').selectOption(ns);
      await expect(page.locator('.management-page')).toContainText('暂无常驻部署');
      await page.getByRole('button', { name: '＋ 创建部署', exact: true }).click();
      await page.getByLabel('部署名称', { exact: true }).fill(id);
      await page.getByLabel('应用版本', { exact: true }).selectOption(`${id}/v1`);
      await page.getByText('高级配置', { exact: true }).click();
      await page.getByLabel('自定义启动命令', { exact: true }).check();
      await page
        .getByLabel('启动命令 JSON', { exact: true })
        .fill(JSON.stringify(['sh', '-c', 'exec sleep 600']));
      await page.getByRole('button', { name: '创建部署', exact: true }).click();
      await expect(page.getByRole('button', { name: '编辑配置', exact: true })).toBeEnabled();
      await expect(page.getByLabel('部署 Namespace')).toHaveValue(ns);
      await expect(page.getByLabel('部署 Namespace')).toBeDisabled();
      await expect
        .poll(async () => (await api(request, target(ns))).latestOperation.state, { timeout: 60000 })
        .toBe('SUCCEEDED');
      expect((await api(request, target(ns))).kubeNamespace).toBe(ns);
      expect((await api(request, `${target(ns)}/runtime`)).namespace).toBe(ns);
      await page.getByRole('button', { name: '← 返回列表', exact: true }).click();
    }
    const originalB = await api(request, `${target(b)}/configuration`);
    await page.getByLabel('部署 Namespace').selectOption(a);
    await detail(page, id);
    await page.getByRole('button', { name: '编辑配置', exact: true }).click();
    await page.getByLabel('CPU 申请量', { exact: true }).fill('50m');
    await page.getByRole('button', { name: '保存部署', exact: true }).click();
    await expect(page.getByRole('button', { name: '编辑配置', exact: true })).toBeEnabled();
    await expect
      .poll(async () => (await api(request, target(a))).latestOperation.state, { timeout: 60000 })
      .toBe('SUCCEEDED');
    expect((await api(request, `${target(a)}/configuration`)).resources.cpuRequest).toBe('50m');
    expect(await api(request, `${target(b)}/configuration`)).toEqual(originalB);
    await page.getByRole('button', { name: '↻ 刷新状态', exact: true }).click();
    await expect(page.getByRole('button', { name: '编辑配置', exact: true })).toBeEnabled();
    await page.getByLabel('调整副本数', { exact: true }).fill('0');
    await page.getByRole('button', { name: '应用副本数', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('副本配置已提交');
    expect((await api(request, `${target(a)}/history`)).length).toBe(3);
    expect((await api(request, `${target(b)}/history`)).length).toBe(1);
    expect((await api(request, target(b))).replicas).toBe(1);
    await page.getByRole('button', { name: '配置访问入口', exact: true }).click();
    await expect(page.getByLabel('Service Namespace', { exact: true })).toHaveValue(a);
    await expect(page.getByLabel('Service 名称', { exact: true })).toHaveValue(id);
    page.on('dialog', (d) => d.accept());
    await nav(page, '边缘服务部署');
    await page.getByLabel('执行集群', { exact: true }).selectOption('runtime-edge');
    await page.getByLabel('部署 Namespace').selectOption(a);
    await detail(page, id);
    await page.getByRole('button', { name: '删除部署', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('删除请求已接受');
    await page.getByLabel('部署 Namespace').selectOption(b);
    await detail(page, id);
    expect(await api(request, `${target(b)}/configuration`)).toEqual(originalB);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: `.local/evidence/ui17-namespace-${width}.png`, fullPage: true });
    }
    expect((await request.get(base + `${root}/kube-system/deployments`, { headers })).status()).toBe(403);
  } finally {
    for (const ns of [a, b]) {
      const r = await request.get(base + target(ns), { headers });
      if (r.ok()) await remove(request, target(ns));
      await expect
        .poll(
          async () => {
            const scopes = await api(request, root),
              current = scopes.find((n) => n.name === ns);
            if (!current || current.phase === 'Terminating') return 200;
            return (await request.delete(base + `${root}/${ns}?${identity(current)}`, { headers })).status();
          },
          { timeout: 90000 },
        )
        .toBe(200);
    }
  }
});

test('typed deployment, resources and readiness reach Kubernetes; access setup reuses Service and Ingress', async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  const id = unique(),
    path = `/clusters/runtime-edge/kubernetes/namespaces/ui-test/deployments/${id}`;
  await app(request, id, {
    TEXT: { type: 'STRING', defaultValue: 'before' },
    COUNT: { type: 'INTEGER', defaultValue: 0 },
    RATE: { type: 'NUMBER', defaultValue: 0.5 },
    FLAG: { type: 'BOOLEAN', defaultValue: false },
    CONFIG: { type: 'OBJECT', defaultValue: { enabled: true } },
    ITEMS: { type: 'ARRAY', defaultValue: [1, 2] },
    MODEL: { type: 'SELECT', required: true, choices: ['mlp', 'cnn'], defaultValue: 'mlp' },
  });
  let created = false,
    service,
    ingress;
  try {
    await login(page);
    await page.getByRole('button', { name: '＋ 创建部署', exact: true }).click();
    await page.getByLabel('部署名称', { exact: true }).fill(id);
    await page.getByLabel('应用版本', { exact: true }).selectOption(`${id}/v1`);
    await expect(page.getByLabel('COUNT', { exact: true })).toHaveValue('0');
    await expect(page.getByLabel('FLAG', { exact: true })).not.toBeChecked();
    await page.getByLabel('TEXT', { exact: true }).fill('after');
    await page.getByLabel('COUNT', { exact: true }).fill('3');
    await page.getByLabel('RATE', { exact: true }).fill('0.75');
    await page.getByLabel('MODEL', { exact: true }).selectOption('cnn');
    await page.getByLabel('CPU 申请量', { exact: true }).fill('100m');
    await page.getByLabel('CPU 上限', { exact: true }).fill('500m');
    await page.getByLabel('内存申请量', { exact: true }).fill('32Mi');
    await page.getByLabel('内存上限', { exact: true }).fill('128Mi');
    await page.getByLabel('HTTP 就绪探针', { exact: true }).check();
    await expect(page.getByLabel('启动命令 JSON', { exact: true })).toHaveCount(0);
    await page.getByText('高级配置', { exact: true }).click();
    await page.getByLabel('自定义启动命令', { exact: true }).check();
    expect(
      await page
        .locator('.provided, .boolean-value, .probe-toggle')
        .evaluateAll((els) => els.every((el) => getComputedStyle(el).flexDirection === 'row')),
    ).toBe(true);
    await page
      .getByLabel('启动命令 JSON', { exact: true })
      .fill(
        JSON.stringify([
          'sh',
          '-c',
          "while true; do printf 'HTTP/1.1 200 OK\\r\\nContent-Length: 5\\r\\nConnection: close\\r\\n\\r\\nui16\\n' | nc -l -p 8080; done",
        ]),
      );
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: `.local/evidence/ui16-form-${width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: '创建部署', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('部署配置已被接受', { timeout: 60000 });
    created = true;
    await expect.poll(async () => (await api(request, path)).readyReplicas, { timeout: 90000 }).toBe(1);
    const configuration = await api(request, `${path}/configuration`);
    expect(configuration.parameters).toEqual({
      TEXT: 'after',
      COUNT: 3,
      RATE: 0.75,
      FLAG: false,
      CONFIG: { enabled: true },
      ITEMS: [1, 2],
      MODEL: 'cnn',
    });
    expect(configuration.resources).toEqual({
      cpuRequest: '100m',
      cpuLimit: '500m',
      memoryRequest: '32Mi',
      memoryLimit: '128Mi',
    });
    expect(configuration.readiness).toEqual({ path: '/', port: 8080 });
    await page.getByRole('button', { name: '↻ 刷新状态', exact: true }).click();
    await expect(page.getByRole('table', { name: '部署实例', exact: true })).toContainText('Running');
    const runtime = await api(request, `${path}/runtime`);
    await page.getByRole('button', { name: '配置访问入口', exact: true }).click();
    await expect(page.getByLabel('资源集群', { exact: true })).toHaveValue('runtime-edge');
    await expect(page.getByLabel('Service Namespace', { exact: true })).toHaveValue('ui-test');
    await expect(page.getByLabel('Service 名称', { exact: true })).toHaveValue(id);
    expect(
      await page.getByLabel('Selector 键', { exact: true }).evaluateAll((els) => els.map((el) => el.value)),
    ).toEqual(Object.keys(runtime.selector));
    expect(
      await page.getByLabel('Selector 值', { exact: true }).evaluateAll((els) => els.map((el) => el.value)),
    ).toEqual(Object.values(runtime.selector));
    await page.getByRole('button', { name: '创建 Service', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Service', exact: true })).toContainText(id);
    service = await api(request, `${scope}/services/${id}`);
    ingress = await api(request, `${scope}/ingresses`, 'post', {
      name: id,
      ingressClassName: 'cea-traefik',
      routes: [{ host: '', path: `/${id}`, pathType: 'Prefix', service: id, port: 80 }],
    });
    await nav(page, '边缘服务部署');
    await page.getByLabel('执行集群', { exact: true }).selectOption('runtime-edge');
    await detail(page, id);
    await expect(page.locator('.access-item')).toHaveCount(2);
    await expect(page.getByRole('link', { name: '访问 ↗', exact: true })).toHaveAttribute(
      'href',
      `${process.env.CEA_E2E_INGRESS}/${id}`,
    );
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: `.local/evidence/ui16-detail-${width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: '编辑配置', exact: true }).click();
    await expect(page.getByLabel('CPU 申请量', { exact: true })).toHaveValue('100m');
    await expect(page.getByLabel('TEXT', { exact: true })).toHaveValue('after');
    await expect(page.getByLabel('自定义启动命令', { exact: true })).toBeChecked();
  } finally {
    if (ingress)
      await api(
        request,
        `${scope}/ingresses/${id}?${identity(await api(request, `${scope}/ingresses/${id}`))}`,
        'delete',
      );
    if (service)
      await api(
        request,
        `${scope}/services/${id}?${identity(await api(request, `${scope}/services/${id}`))}`,
        'delete',
      );
    if (created) await remove(request, path);
  }
});

test('invalid structured parameter remains editable; switching application drops former fields', async ({
  page,
  request,
}) => {
  const id = unique();
  await app(request, id, { CONFIG: { type: 'OBJECT', required: true } });
  await app(request, id, { LABEL: { type: 'STRING', defaultValue: 'new' } }, 'v2');
  await login(page);
  await page.getByRole('button', { name: '＋ 创建部署', exact: true }).click();
  await page.getByLabel('部署名称', { exact: true }).fill(id);
  await page.getByLabel('应用版本', { exact: true }).selectOption(`${id}/v1`);
  await page.getByLabel('CONFIG', { exact: true }).fill('{oops');
  const writes = [];
  page.on('request', (r) => {
    if (r.method() === 'PUT' && r.url().includes('/deployments/')) writes.push(r.url());
  });
  await page.getByRole('button', { name: '创建部署', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('CONFIG');
  await expect(page.getByLabel('CONFIG', { exact: true })).toHaveValue('{oops');
  expect(writes).toEqual([]);
  await page.getByLabel('应用版本', { exact: true }).selectOption(`${id}/v2`);
  await expect(page.getByLabel('CONFIG', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('LABEL', { exact: true })).toHaveValue('new');
});

test('real crashing instance shows exit reason; runtime lookup failure is not displayed as an empty deployment', async ({
  page,
  request,
}) => {
  test.setTimeout(150000);
  const id = unique(),
    path = `/clusters/runtime-edge/kubernetes/namespaces/ui-test/deployments/${id}`;
  await app(request, id);
  await api(request, path, 'put', {
    applicationId: id,
    version: 'v1',
    replicas: 1,
    parameters: {},
    command: ['sh', '-c', 'exit 17'],
  });
  try {
    await expect
      .poll(async () => JSON.stringify((await api(request, `${path}/runtime`)).pods), { timeout: 90000 })
      .toContain('17');
    await login(page);
    await detail(page, id);
    await expect(page.getByRole('table', { name: '部署实例', exact: true })).toContainText('17');
    await page.route(`**${path}/runtime`, (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'runtime unavailable' }),
      }),
    );
    await page.getByRole('button', { name: '↻ 刷新状态', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('runtime unavailable');
    await expect(page.getByRole('table', { name: '部署实例', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '配置访问入口', exact: true })).toBeDisabled();
  } finally {
    await remove(request, path);
  }
});
