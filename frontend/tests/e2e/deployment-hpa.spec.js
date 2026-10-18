import { test, expect } from '@playwright/test';

async function fixture(page, failRead = false, warm = false) {
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
    warmPool: warm,
    resources: { cpuRequest: '100m', cpuLimit: '1', memoryRequest: '128Mi', memoryLimit: '512Mi' },
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
    if (path.endsWith('/-/warm-pool'))
      data = { available: warm, count: 4, memoryMiB: 2048, resourceVersion: 'b1' };
    else if (path.endsWith('/scaling'))
      data = {
        samples: [{ at: new Date().toISOString(), desired: 2, ready: 2, standby: 1 }],
        events: [
          {
            id: 'e1',
            startedAt: new Date().toISOString(),
            fromReplicas: 1,
            toReplicas: 2,
            state: 'SUCCEEDED',
            durationMs: 800,
            warmHits: 1,
          },
        ],
      };
    else if (path.endsWith('/new-warm')) {
      sent = r.request().postDataJSON();
      data = { ...deployment, name: 'new-warm', warmPool: true };
    } else if (path.endsWith('/autoscaling')) {
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
      data = {
        namespace: 'cea-lab',
        labels: { app: 'hpa-demo' },
        pods: warm
          ? [
              {
                name: 'active',
                phase: 'Running',
                ready: true,
                node: 'cloud',
                restarts: 0,
                reasons: [],
                standby: false,
              },
              {
                name: 'reserve',
                phase: 'Running',
                ready: true,
                node: 'cloud',
                restarts: 0,
                reasons: [],
                standby: true,
              },
            ]
          : [],
      };
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

test('warm deployment shows resources and real-style history, create reuses HPA fields', async ({ page }) => {
  const result = await fixture(page, false, true);
  await expect(page.getByRole('heading', { name: '副本变化', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: /运行期间/ })).toBeVisible();
  await expect(page.getByText('1 / 1', { exact: true })).toBeVisible();
  await expect(page.getByText('CPU 申请 / 上限（每副本）', { exact: true })).toBeVisible();
  await expect(page.getByText('资源版本', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: '备用', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '业务', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '← 返回列表', exact: true }).click();
  await page.getByRole('button', { name: '＋ 创建部署', exact: true }).click();
  await page.getByLabel('部署名称', { exact: true }).fill('new-warm');
  await page.getByLabel('应用版本', { exact: true }).selectOption('hpa-demo/v1');
  await expect(page.getByLabel('启用预热池加速', { exact: true })).toHaveCount(0);
  await page.getByLabel('启用自动扩缩容（HPA）', { exact: true }).check();
  await page.getByLabel('启用预热池加速', { exact: true }).check();
  await expect(page.getByLabel('最大副本数', { exact: true })).toHaveAttribute('max', '20');
  await page.getByLabel('启用自动扩缩容（HPA）', { exact: true }).uncheck();
  await expect(page.getByLabel('启用预热池加速', { exact: true })).toHaveCount(0);
  await page.getByLabel('启用自动扩缩容（HPA）', { exact: true }).check();
  await expect(page.getByLabel('启用预热池加速', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('最大副本数', { exact: true })).toHaveAttribute('max', '100');
  await page.getByLabel('启用预热池加速', { exact: true }).check();
  await page.getByLabel('CPU 申请量', { exact: true }).fill('100m');
  await page.getByLabel('内存上限', { exact: true }).fill('512Mi');
  await page.getByRole('button', { name: '创建部署', exact: true }).click();
  await expect
    .poll(() => result.sent())
    .toMatchObject({
      warmPool: true,
      autoscaling: { minReplicas: 1, maxReplicas: 4, cpuUtilization: 60, memoryUtilization: null },
    });
});

test('disabling HPA in the creation form submits an ordinary deployment', async ({ page }) => {
  const result = await fixture(page, false, true);
  await page.getByRole('button', { name: '← 返回列表', exact: true }).click();
  await page.getByRole('button', { name: '＋ 创建部署', exact: true }).click();
  await page.getByLabel('部署名称', { exact: true }).fill('new-warm');
  await page.getByLabel('应用版本', { exact: true }).selectOption('hpa-demo/v1');
  await page.getByLabel('启用自动扩缩容（HPA）', { exact: true }).check();
  await page.getByLabel('启用预热池加速', { exact: true }).check();
  await page.getByLabel('启用自动扩缩容（HPA）', { exact: true }).uncheck();
  await page.getByRole('button', { name: '创建部署', exact: true }).click();
  await expect.poll(() => result.sent()).toMatchObject({ warmPool: false });
  expect(result.sent()).not.toHaveProperty('autoscaling');
});
