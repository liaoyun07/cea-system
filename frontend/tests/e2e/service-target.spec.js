import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const base = '/api/namespaces/lab';
const headers = {
  Authorization:
    'Basic ' + Buffer.from(`${process.env.CEA_E2E_USER}:${process.env.CEA_E2E_PASSWORD}`).toString('base64'),
};
const root = '/clusters/runtime-edge/kubernetes/namespaces';
const appId = `ui18-${randomUUID().slice(0, 8)}`;
async function api(request, path, method = 'get', data) {
  const response = await request[method](base + path, { headers, ...(data ? { data } : {}) });
  expect(response.ok(), await response.text()).toBeTruthy();
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
async function open(page, ns) {
  await page.goto('/');
  await page.getByLabel('账号', { exact: true }).fill(process.env.CEA_E2E_USER);
  await page.getByLabel('密码', { exact: true }).fill(process.env.CEA_E2E_PASSWORD);
  await page.getByRole('button', { name: '连接工作空间 →', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: '服务资源管理', exact: true }).click();
  await page.getByLabel('资源集群').selectOption('runtime-edge');
  await page.getByLabel('Service Namespace').selectOption(ns);
  await page.getByRole('button', { name: '创建 Service', exact: true }).click();
}
async function deployment(request, ns, name) {
  await api(request, `${root}/${ns}/deployments/${name}`, 'put', {
    applicationId: appId,
    version: 'v1',
    replicas: 0,
    parameters: {},
    command: [],
  });
}
async function namespaces(request, work) {
  const id = randomUUID().slice(0, 8),
    names = [`cea-lab-ui18-a-${id}`, `cea-lab-ui18-b-${id}`];
  for (const name of names) await api(request, root, 'post', { name });
  try {
    await work(...names);
  } finally {
    for (const ns of names) {
      for (const s of await api(request, `${root}/${ns}/services`))
        await api(
          request,
          `${root}/${ns}/services/${s.name}?uid=${s.uid}&resourceVersion=${s.resourceVersion}`,
          'delete',
        );
      for (const d of await api(request, `${root}/${ns}/deployments`))
        await api(
          request,
          `${root}/${ns}/deployments/${d.name}?resourceVersion=${d.resourceVersion}`,
          'delete',
        );
      await expect
        .poll(
          async () => {
            const current = (await api(request, root)).find((n) => n.name === ns);
            if (!current || current.phase === 'Terminating') return true;
            return (
              await request.delete(
                base + `${root}/${ns}?uid=${current.uid}&resourceVersion=${current.resourceVersion}`,
                { headers },
              )
            ).ok();
          },
          { timeout: 90000 },
        )
        .toBe(true);
    }
  }
}
test.beforeAll(async ({ request }) => {
  await api(request, '/resources/clusters/runtime-edge', 'put', {
    id: 'runtime-edge',
    kind: 'EDGE',
    enabled: true,
  });
  await api(request, `/applications/${appId}/versions/v1`, 'put', {
    applicationId: appId,
    version: 'v1',
    image: 'ui-registry:5000/alpine:v1',
    parameters: {},
  });
});

test('Service target selects only current Namespace deployments and supports multiple Services per target', async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  await namespaces(request, async (a, b) => {
    for (const ns of [a, b]) await deployment(request, ns, 'same-target');
    await deployment(request, a, 'only-a');
    await deployment(request, b, 'only-b');
    await open(page, a);
    const target = page.getByLabel('目标部署', { exact: true });
    await expect(target).toHaveValue('');
    await expect(target.locator('option')).toHaveText([
      '选择当前 Namespace 中的部署',
      `only-a · ${appId}/v1`,
      `same-target · ${appId}/v1`,
    ]);
    await expect(page.getByRole('button', { name: '添加 Selector', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Selector 键', { exact: true })).toHaveCount(0);
    for (const [index, name] of ['first-entry', 'second-entry'].entries()) {
      if (index) await page.getByRole('button', { name: '创建 Service', exact: true }).click();
      await target.selectOption('same-target');
      await page.getByLabel('Service 名称', { exact: true }).fill(name);
      await page.getByLabel('Service 端口', { exact: true }).fill(String(80 + index));
      if (!index)
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: 1000 });
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
            true,
          );
          await page.screenshot({ path: `.local/evidence/ui18-target-${width}.png`, fullPage: true });
        }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.locator('form').getByRole('button', { name: '创建 Service', exact: true }).click();
      await expect(page.getByRole('table', { name: 'Service', exact: true })).toContainText(name);
      expect((await api(request, `${root}/${a}/services/${name}`)).selector).toEqual(
        (await api(request, `${root}/${a}/deployments/same-target/runtime`)).selector,
      );
    }
    await page.getByLabel('Service Namespace').selectOption(b);
    await page.getByRole('button', { name: '创建 Service', exact: true }).click();
    await expect(target).toHaveValue('');
    await expect(target.locator('option')).toHaveText([
      '选择当前 Namespace 中的部署',
      `only-b · ${appId}/v1`,
      `same-target · ${appId}/v1`,
    ]);
    await target.selectOption('only-b');
    await page.getByLabel('Service 名称', { exact: true }).fill('b-entry');
    await page.locator('form').getByRole('button', { name: '创建 Service', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Service', exact: true })).toContainText('b-entry');
    expect((await api(request, `${root}/${b}/services/b-entry`)).selector['cea-system/deployment']).toBe(
      'only-b',
    );
    expect((await api(request, `${root}/${a}/services`)).map((s) => s.name)).toEqual([
      'first-entry',
      'second-entry',
    ]);
  });
});

test('Service without a deployment cannot submit; runtime failure cannot submit stale selectors and can retry', async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  await namespaces(request, async (a, b) => {
    await open(page, a);
    await expect(
      page.getByText('当前 Namespace 暂无可选部署，请先创建部署。', { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('目标部署', { exact: true })).toBeDisabled();
    await expect(
      page.locator('form').getByRole('button', { name: '创建 Service', exact: true }),
    ).toBeDisabled();
    await deployment(request, b, 'target');
    await page.getByLabel('Service Namespace').selectOption(b);
    await page.getByRole('button', { name: '创建 Service', exact: true }).click();
    await page.getByLabel('目标部署', { exact: true }).selectOption('target');
    await page.getByLabel('Service 名称', { exact: true }).fill('retry-entry');
    const runtimePath = `**${base}${root}/${b}/deployments/target/runtime`;
    await page.route(runtimePath, (route) =>
      route.fulfill({ status: 502, json: { code: 'UNAVAILABLE', message: 'target unavailable' } }),
    );
    let posts = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith(`${root}/${b}/services`)) posts++;
    });
    await page.locator('form').getByRole('button', { name: '创建 Service', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('target unavailable');
    expect(posts).toBe(0);
    expect(await api(request, `${root}/${b}/services`)).toEqual([]);
    await page.unroute(runtimePath);
    await page.locator('form').getByRole('button', { name: '创建 Service', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Service', exact: true })).toContainText('retry-entry');
    expect(posts).toBe(1);
    await page.getByRole('button', { name: '创建 Service', exact: true }).click();
    await page.getByLabel('Service 名称', { exact: true }).fill('deleted-target');
    const d = await api(request, `${root}/${b}/deployments/target`);
    await api(request, `${root}/${b}/deployments/target?resourceVersion=${d.resourceVersion}`, 'delete');
    await page.locator('form').getByRole('button', { name: '创建 Service', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('deployment not found');
    expect(posts).toBe(1);
    await page.getByLabel('Service Namespace').selectOption(a);
    await page.getByRole('button', { name: '创建 Service', exact: true }).click();
    await expect(page.getByLabel('目标部署', { exact: true })).toHaveValue('');
    await expect(
      page.locator('form').getByRole('button', { name: '创建 Service', exact: true }),
    ).toBeDisabled();
  });
});
