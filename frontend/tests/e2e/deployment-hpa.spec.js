import { test, expect } from '@playwright/test';

async function fixture(page, failRead = false) {
  let hpa = { enabled: false, editable: true, metrics: [], conditions: [] },
    sent,
    failSave = false;
  const deployment = {
    name: 'hpa-demo',
    applicationId: 'hpa-demo',
    version: 'v1',
    replicas: 2,
    readyReplicas: 2,
    observed: true,
    resourceVersion: 'd1',
    conditions: [],
    image: 'example@sha256:123',
  };
  await page.route('**/api/namespaces/lab/resources/clusters*', (r) =>
    r.fulfill({ json: [{ id: 'edge-a', kind: 'EDGE', enabled: true }] }),
  );
  await page.route('**/api/namespaces/lab/applications*', (r) =>
    r.fulfill({ json: [{ applicationId: 'hpa-demo', version: 'v1', parameters: {} }] }),
  );
  await page.route('**/api/namespaces/lab/clusters/edge-a/kubernetes/**', async (r) => {
    const path = new URL(r.request().url()).pathname,
      method = r.request().method();
    let data;
    if (path.endsWith('/autoscaling')) {
      if (failRead && method === 'GET') return r.fulfill({ status: 503, json: { message: 'HPA 查询失败' } });
      if (method === 'PUT') {
        sent = r.request().postDataJSON();
        if (failSave) return r.fulfill({ status: 422, json: { message: 'CPU requests 尚未设置' } });
        hpa = {
          enabled: true,
          editable: true,
          name: 'hpa-demo',
          resourceVersion: 'h1',
          minReplicas: sent.minReplicas,
          maxReplicas: sent.maxReplicas,
          currentReplicas: 2,
          desiredReplicas: 3,
          metrics: ['cpu', 'memory']
            .filter((m) => sent[m + 'Utilization'] != null)
            .map((m) => ({
              resource: m,
              targetUtilization: sent[m + 'Utilization'],
              currentUtilization: m === 'cpu' ? 72 : null,
            })),
          conditions: ['ScalingActive: True'],
        };
      } else if (method === 'DELETE') {
        hpa = { enabled: false, editable: true, metrics: [], conditions: [] };
        return r.fulfill({ status: 204 });
      }
      data = hpa;
    } else if (path.endsWith('/namespaces'))
      data = [{ name: 'cea-lab', phase: 'Active', executionDefault: true }];
    else if (path.endsWith('/deployments')) data = [deployment];
    else if (path.endsWith('/hpa-demo')) data = deployment;
    else if (path.endsWith('/configuration'))
      data = {
        ...deployment,
        command: [],
        parameters: {},
        resources: { cpuRequest: '100m', memoryRequest: '32Mi' },
      };
    else if (path.endsWith('/runtime'))
      data = { namespace: 'cea-lab', labels: { app: 'hpa-demo' }, pods: [] };
    else data = [];
    await r.fulfill({ json: data });
  });
  await page.goto('/');
  await page.getByLabel('账号', { exact: true }).fill(process.env.CEA_E2E_USER);
  await page.getByLabel('密码', { exact: true }).fill(process.env.CEA_E2E_PASSWORD);
  await page.getByRole('button', { name: '连接工作空间 →', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: '边缘服务部署', exact: true }).click();
  await page.getByLabel('执行集群', { exact: true }).selectOption('edge-a');
  await page.getByRole('button', { name: '详情 →', exact: true }).click();
  return {
    sent: () => sent,
    failSave: (value) => {
      failSave = value;
    },
  };
}
test('HPA create/edit/disable preserves manual mode and displays native metrics', async ({ page }) => {
  const state = await fixture(page);
  const section = page.getByRole('region', { name: '自动扩缩容', exact: true });
  await expect(section).toContainText('未启用');
  await expect(page.getByLabel('调整副本数', { exact: true })).toBeVisible();
  await section.getByRole('button', { name: '启用自动扩缩容', exact: true }).click();
  await page.getByLabel('最大副本数', { exact: true }).fill('5');
  await page.getByLabel('内存目标利用率（%）', { exact: true }).fill('70');
  state.failSave(true);
  await page.getByRole('button', { name: '保存自动扩缩容', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('CPU requests');
  await expect(page.getByLabel('最大副本数', { exact: true })).toHaveValue('5');
  state.failSave(false);
  await page.getByRole('button', { name: '保存自动扩缩容', exact: true }).click();
  await expect(section).toContainText('已启用');
  expect(state.sent()).toMatchObject({
    minReplicas: 1,
    maxReplicas: 5,
    cpuUtilization: 60,
    memoryUtilization: 70,
  });
  await expect(section).toContainText('72% / 60%');
  await expect(section).toContainText('— / 70%');
  await expect(page.getByLabel('调整副本数', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '编辑配置', exact: true }).click();
  await expect(page.getByLabel('副本数', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '← 返回列表', exact: true }).click();
  await page.getByRole('button', { name: '详情 →', exact: true }).click();
  await section.getByRole('button', { name: '编辑自动扩缩容', exact: true }).click();
  await page.getByLabel('CPU 目标利用率（%）', { exact: true }).fill('');
  await page.getByRole('button', { name: '保存自动扩缩容', exact: true }).click();
  await expect(section).toContainText('已启用');
  expect(state.sent().cpuUtilization).toBeNull();
  await page.setViewportSize({ width: 420, height: 900 });
  await expect(section).toBeVisible();
  await section.getByRole('button', { name: '关闭自动扩缩容', exact: true }).click();
  await expect(section).toContainText('未启用');
  await expect(page.getByLabel('调整副本数', { exact: true })).toHaveValue('2');
});
test('HPA lookup failure is not presented as disabled and blocks manual scaling', async ({ page }) => {
  await fixture(page, true);
  await expect(page.getByRole('alert')).toContainText('HPA 查询失败');
  await expect(page.getByLabel('调整副本数', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '启用自动扩缩容', exact: true })).toHaveCount(0);
});
