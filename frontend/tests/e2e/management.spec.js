import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const base = '/api/namespaces/lab';
const headers = {
  Authorization:
    'Basic ' + Buffer.from(`${process.env.CEA_E2E_USER}:${process.env.CEA_E2E_PASSWORD}`).toString('base64'),
};
const gatewayHeaders = {
  Authorization: 'Basic ' + Buffer.from(`gateway-test:${process.env.CEA_E2E_PASSWORD}`).toString('base64'),
};
const unique = () => `mg-${randomUUID().slice(0, 8)}`;

test('registration saves SELECT and nested JSON contracts and rejects invalid SELECT without a write', async ({
  page,
  request,
}) => {
  const id = unique();
  await login(page);
  await nav(page, '应用与镜像');
  await page.getByRole('button', { name: '＋ 注册应用版本', exact: true }).click();
  await page.getByLabel('应用 ID', { exact: true }).fill(id);
  await page.getByLabel('版本', { exact: true }).fill('v1');
  await page.getByLabel('镜像引用', { exact: true }).fill('registry.example/test:v1');
  const parameters = {
    MODEL: { type: 'SELECT', defaultValue: 'cnn', choices: ['mlp', 'cnn'], required: true },
    CONFIG: {
      type: 'OBJECT',
      defaultValue: { text: '中文 "quoted"', flags: [true, null, 1] },
      required: false,
    },
    ITEMS: { type: 'ARRAY', defaultValue: [1, { enabled: false }, null], required: false },
  };
  let i = 0;
  for (const [name, parameter] of Object.entries(parameters)) {
    i++;
    await page.getByRole('button', { name: '＋ 添加参数', exact: true }).click();
    await page.getByLabel(`参数 ${i} · 名称`, { exact: true }).fill(name);
    await page.getByLabel(`参数 ${i} · 类型`, { exact: true }).selectOption(parameter.type);
    await page
      .getByLabel(`参数 ${i} · 默认值 JSON`, { exact: true })
      .fill(JSON.stringify(parameter.defaultValue));
    if (parameter.choices) await page.getByLabel(`参数 ${i} · 允许值 JSON`, { exact: true }).fill('[]');
    if (parameter.required)
      await page
        .getByRole('group', { name: `参数 ${i}`, exact: true })
        .getByLabel('必填', { exact: true })
        .check();
  }
  const writes = [];
  page.on('request', (r) => {
    if (r.method() === 'PUT' && r.url().includes('/applications/')) writes.push(r.url());
  });
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('SELECT 允许值必须是');
  expect(writes).toHaveLength(0);
  await page.getByLabel('参数 1 · 允许值 JSON').fill('["mlp","cnn"]');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(page.getByText('已保存到目录', { exact: true })).toBeVisible();
  const result = await request.get(`${base}/applications/${id}/versions/v1`, { headers });
  expect(result.ok()).toBeTruthy();
  const saved = (await result.json()).parameters;
  for (const [name, parameter] of Object.entries(parameters)) expect(saved[name]).toMatchObject(parameter);
  expect(saved.CONFIG.defaultValue.flags).toEqual([true, null, 1]);
  expect(saved.ITEMS.defaultValue).toEqual([1, { enabled: false }, null]);
  expect(writes).toHaveLength(1);
});

test('DQN detail identifies the pinned model and actual execution layer', async ({ page }) => {
  await login(page);
  await page.route('**/offloading/samples?*', (route) =>
    route.fulfill({
      json: [
        {
          key: 'dqn-ui-fixture',
          applicationId: 'signal',
          applicationVersion: 'v1',
          strategy: 'DQN',
          modelVersion: 'off04-trained-fixture',
          target: { kind: 'EDGE', id: 'edge-a' },
          outcome: 'SUCCESS',
          createdAt: '2026-09-14T01:00:00Z',
          reward: -0.1,
          measurement: {
            inputs: [1, 0, 2, 0, 3, 4],
            unavailable: null,
            elapsedSeconds: 12,
            limitSeconds: 120,
            feedbackOutcome: 'SUCCESS',
            trainable: false,
          },
        },
      ],
    }),
  );
  await nav(page, '任务卸载决策记录');
  await page.getByRole('button', { name: '详情 →', exact: true }).click();
  await expect(page.getByText('off04-trained-fixture', { exact: true })).toBeVisible();
  await expect(page.getByRole('table', { name: '卸载六维状态' }).locator('tbody tr')).toHaveCount(6);
  await expect(page.getByText('12.000 秒', { exact: true })).toBeVisible();
});

test('measured offloading detail displays missing as unavailable rather than zero', async ({ page }) => {
  await login(page);
  await page.route('**/offloading/samples?*', (route) =>
    route.fulfill({
      json: [
        {
          key: 'measurement-ui-fixture',
          applicationId: 'signal',
          applicationVersion: 'v1',
          strategy: 'FIXED',
          target: { kind: 'EDGE', id: 'edge-a' },
          outcome: 'SUCCESS',
          createdAt: '2026-09-14T01:00:00Z',
          reward: -0.1,
          measurement: {
            inputs: [1, 0, 2, 0, null, null],
            unavailable: 'transfer calibration incomplete',
            elapsedSeconds: 12,
            limitSeconds: 120,
            feedbackOutcome: 'SUCCESS',
            nextKey: null,
            nextState: null,
            trainable: false,
          },
        },
      ],
    }),
  );
  await nav(page, '任务卸载决策记录');
  await expect(page.locator('tbody tr')).toContainText('待传输标定');
  await page.getByRole('button', { name: '详情 →', exact: true }).click();
  await expect(page.getByRole('table', { name: '卸载六维状态' }).locator('tbody tr')).toHaveCount(6);
  await expect(page.getByRole('table', { name: '卸载六维状态' }).getByText('未测得')).toHaveCount(2);
  await expect(page.getByText('12.000 秒', { exact: true })).toBeVisible();
  await expect(page.getByText('尚无下一决策', { exact: true })).toBeVisible();
});

test('all candidate pages are read and management navigation protects drafts on narrow screens', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const prefix = `zz-${randomUUID().slice(0, 5)}`;
  for (let i = 0; i < 105; i += 10) {
    await Promise.all(
      Array.from({ length: Math.min(10, 105 - i) }, (_, n) => {
        const id = `${prefix}-${String(i + n).padStart(3, '0')}`;
        return put(request, `/resources/clusters/${id}`, { id, kind: 'EDGE', enabled: true });
      }),
    );
  }
  await login(page);
  await page.setViewportSize({ width: 650, height: 900 });
  await nav(page, '数据集管理');
  await page.getByRole('button', { name: '＋ 登记数据集版本' }).click();
  await page.getByRole('button', { name: '＋ 添加位置', exact: true }).click();
  await page.getByLabel('位置 1 · 集群', { exact: true }).selectOption(`${prefix}-104`);
  page.once('dialog', (dialog) => dialog.dismiss());
  await nav(page, '数据集管理');
  await expect(page.getByLabel('位置 1 · 集群', { exact: true })).toHaveValue(`${prefix}-104`);
  page.once('dialog', (dialog) => dialog.accept());
  await nav(page, '数据集管理');
  await expect(page.getByLabel('数据集 ID', { exact: true })).toHaveCount(0);
  const width = await page.evaluate(() => [innerWidth, document.documentElement.scrollWidth]);
  expect(width[1]).toBeLessThanOrEqual(width[0] + 1);
  await page.screenshot({ path: '.local/evidence/management-narrow.png', fullPage: true });
});
async function put(request, path, data) {
  const result = await request.put(base + path, { headers, data });
  expect(result.ok(), await result.text()).toBeTruthy();
  return result.json();
}
async function get(request, path) {
  const result = await request.get(base + path, { headers });
  expect(result.ok(), await result.text()).toBeTruthy();
  return result.json();
}
async function login(page, username = process.env.CEA_E2E_USER) {
  await page.goto('/');
  await page.getByLabel('账号', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(process.env.CEA_E2E_PASSWORD);
  await page.getByRole('button', { name: '连接工作空间 →', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
}
async function nav(page, title) {
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: title, exact: true })
    .click();
  await expect(page.locator('h1')).toHaveText(title);
}
async function save(page, message = '已保存到目录') {
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(message);
}
async function rowAction(page, text, action) {
  await page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: text, exact: true }) })
    .getByRole('button', { name: action })
    .click();
}
test.beforeAll(async ({ request }) => {
  for (const id of ['runtime-edge', 'edge-origin'])
    await put(request, `/resources/clusters/${id}`, { id, kind: 'EDGE', enabled: true });
});
test.beforeEach(async ({ page }) => {
  page.uiErrors = [];
  page.on('pageerror', (e) => page.uiErrors.push(e.message));
});
test.afterEach(async ({ page }) => {
  expect(page.uiErrors).toEqual([]);
});

test('cluster registration, admission switch and namespace-isolated catalog', async ({ page, request }) => {
  const id = unique();
  await login(page);
  await nav(page, '集群管理');
  await page.getByRole('button', { name: '＋ 登记集群', exact: true }).click();
  await page.getByLabel('集群 ID', { exact: true }).fill(id);
  await page.getByLabel('计算层', { exact: true }).selectOption('CLOUD');
  await save(page);
  await expect(page.getByLabel('集群 ID', { exact: true })).toBeDisabled();
  await page.getByLabel('允许参与执行', { exact: true }).uncheck();
  await save(page);
  expect(await get(request, `/resources/clusters/${id}`)).toEqual({ id, kind: 'CLOUD', enabled: false });
  const other = await request.get('/api/namespaces/other/resources/clusters', { headers });
  expect(other.status()).toBe(403);
  await page.getByRole('button', { name: '← 返回列表', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: id })).toContainText('停用');
  await page.screenshot({ path: '.local/evidence/management-clusters.png', fullPage: true });
});

test('dataset locations, immutable version conflict, clone to new version', async ({ page, request }) => {
  const id = unique();
  await login(page);
  await nav(page, '数据集管理');
  await page.getByRole('button', { name: '＋ 登记数据集版本' }).click();
  await page.getByLabel('数据集 ID', { exact: true }).fill(id);
  await page.getByLabel('版本', { exact: true }).fill('v1');
  await page.getByLabel('数据格式', { exact: true }).fill('pt');
  await page.getByRole('button', { name: '＋ 添加位置', exact: true }).click();
  await page.getByLabel('位置 1 · 集群', { exact: true }).selectOption('runtime-edge');
  await page.getByLabel('位置 1 · S3 URI', { exact: true }).fill(`s3://datasets/${id}/v1/data.pt`);
  await save(page);
  await expect(page.getByLabel('位置 1 · S3 URI', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '基于此版本新建', exact: true }).click();
  await page.getByLabel('版本', { exact: true }).fill('v1');
  await page.getByLabel('位置 1 · S3 URI', { exact: true }).fill(`s3://datasets/${id}/v2/data.pt`);
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('409');
  expect((await get(request, `/resources/datasets/${id}/versions/v1`)).locations[0].uri).toContain('/v1/');
  await page.getByLabel('版本', { exact: true }).fill('v2');
  await save(page);
  await page.screenshot({ path: '.local/evidence/management-dataset.png', fullPage: true });
});

test('application contract form persists defaults and allowed datasets, then prepares an actual image', async ({
  page,
  request,
}) => {
  const id = unique(),
    dataset = unique();
  await put(request, `/resources/datasets/${dataset}/versions/v1`, {
    datasetId: dataset,
    version: 'v1',
    format: 'pt',
    locations: [{ clusterId: 'runtime-edge', uri: 's3://datasets/test/data.pt' }],
  });
  await login(page);
  await nav(page, '应用与镜像');
  await page.getByRole('button', { name: '＋ 注册应用版本', exact: true }).click();
  await page.getByLabel('应用 ID', { exact: true }).fill(id);
  await page.getByLabel('版本', { exact: true }).fill('v1');
  await page.getByLabel('镜像引用', { exact: true }).fill('ui-registry:5000/alpine:v1');
  await page.getByRole('button', { name: '＋ 添加参数' }).click();
  await page.getByLabel('参数 1 · 名称', { exact: true }).fill('FLAG');
  await page.getByLabel('参数 1 · 类型', { exact: true }).selectOption('BOOLEAN');
  await page.getByLabel('参数 1 · 默认值 JSON', { exact: true }).fill('false');
  await page.getByRole('button', { name: '＋ 添加参数' }).click();
  await page.getByLabel('参数 2 · 名称', { exact: true }).fill('DATASET');
  await page.locator('.parameter-card').nth(1).getByLabel('数据集参数（STRING）', { exact: true }).check();
  await page.getByLabel('参数 2 · 数据格式', { exact: true }).fill('pt');
  await page.getByLabel('参数 2 · 允许的数据集版本', { exact: true }).selectOption(`${dataset}/v1`);
  await save(page);
  const app = await get(request, `/applications/${id}/versions/v1`);
  expect(app.parameters.FLAG.defaultValue).toBe(false);
  expect(app.parameters.DATASET.dataset.allowed).toEqual([{ datasetId: dataset, version: 'v1' }]);
  await page.getByLabel('目标集群', { exact: true }).selectOption('runtime-edge');
  await page.getByRole('button', { name: '准备镜像', exact: true }).click();
  await expect(page.locator('.prepared-result code')).toContainText('sha256:', { timeout: 60000 });
  await expect(page.locator('.prepared-result code')).toContainText('ui-registry:5000/');
  await page.screenshot({ path: '.local/evidence/management-application.png', fullPage: true });
});

test('gateway/terminal registration fixes ownership and shows actual heartbeat time', async ({
  page,
  request,
}) => {
  await login(page);
  await nav(page, '边缘网关管理');
  await page.getByRole('button', { name: '＋ 登记网关' }).click();
  await page.getByLabel('网关 ID', { exact: true }).fill('gateway-browser');
  await page.getByLabel('边缘集群', { exact: true }).selectOption('edge-origin');
  await page.getByLabel('CONNECT 账号', { exact: true }).fill('owner');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('403');
  await page.getByLabel('CONNECT 账号', { exact: true }).fill('gateway-test');
  await save(page);
  await expect(page.getByLabel('边缘集群', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('CONNECT 账号', { exact: true })).toBeDisabled();
  await nav(page, '终端设备接入');
  await page.getByRole('button', { name: '＋ 登记终端', exact: true }).click();
  await page.getByLabel('终端 ID', { exact: true }).fill('terminal-browser');
  await page.getByLabel('所属网关', { exact: true }).selectOption('gateway-browser');
  await save(page);
  await expect(page.getByLabel('所属网关', { exact: true })).toBeDisabled();
  await page.getByLabel('允许接入', { exact: true }).uncheck();
  await save(page);
  expect((await get(request, '/edge/terminals')).find((t) => t.id === 'terminal-browser').enabled).toBe(
    false,
  );
  await page.getByLabel('允许接入', { exact: true }).check();
  await save(page);
  const heartbeat = await request.post(base + '/edge-access/terminals/terminal-browser/heartbeat', {
    headers: gatewayHeaders,
  });
  expect(heartbeat.ok()).toBeTruthy();
  await page.getByRole('button', { name: '← 返回列表', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'terminal-browser' })).not.toContainText('尚无记录');
  await page.screenshot({ path: '.local/evidence/management-terminal.png', fullPage: true });
});

test('policy shares no-code source, preserves CAS conflicts and executes through real edge event', async ({
  page,
  request,
}) => {
  const id = unique(),
    eventType = unique();
  await put(request, '/edge/gateways/gateway-browser', {
    clusterId: 'edge-origin',
    principal: 'gateway-test',
    enabled: true,
  });
  await put(request, '/edge/terminals/terminal-browser', { gatewayId: 'gateway-browser', enabled: true });
  await login(page);
  await nav(page, '边缘数据处理策略');
  await page.getByRole('button', { name: '＋ 新建策略', exact: true }).click();
  await page.getByLabel('策略 ID', { exact: true }).fill(id);
  await page.getByLabel('边缘集群', { exact: true }).selectOption('edge-origin');
  await page.getByLabel('事件类型', { exact: true }).fill(eventType);
  await page.getByRole('button', { name: '创建空流程', exact: true }).click();
  await page.getByRole('button', { name: '添加到 任务', exact: true }).click();
  await page.getByLabel('任务 ID', { exact: true }).fill('hello');
  await page.getByRole('button', { name: '添加到流程', exact: true }).click();
  const message = page.locator(
    '[data-field="tasks.0.message"] > input, [data-field="tasks.0.message"] > textarea',
  );
  await message.fill('edge policy actual');
  await message.blur();
  await page.getByRole('button', { name: '校验策略', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Flow 校验通过');
  await save(page, '策略已保存 · r1');
  const stored = await get(request, `/edge/policies/${id}`);
  expect(stored.flow.source).toContain('edge policy actual');
  const userFlow = await request.get(`${base}/flows/${id}`, { headers });
  expect(userFlow.status()).toBe(409);
  expect((await userFlow.json()).message).toContain('management scope');
  await put(request, `/edge/policies/${id}`, {
    clusterId: 'edge-origin',
    eventType,
    enabled: false,
    expectedRevision: 1,
    source: stored.flow.source.replace('edge policy actual', 'newer remote'),
  });
  await message.fill('local still here');
  await message.blur();
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('409');
  await expect(message).toHaveValue('local still here');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '← 返回列表', exact: true }).click();
  await rowAction(page, id, '编辑 →');
  await expect(page.getByRole('heading', { name: '策略 Flow r2', exact: true })).toBeVisible();
  await page.getByLabel('启用事件触发', { exact: true }).check();
  await save(page, '策略已保存 · r3');
  const accepted = await request.post(`${base}/edge-access/terminals/terminal-browser/events`, {
    headers: { ...gatewayHeaders, 'Idempotency-Key': unique() },
    data: { eventType, inputs: {} },
  });
  expect(accepted.status()).toBe(202);
  const { executionId } = await accepted.json();
  await expect.poll(async () => (await get(request, `/executions/${executionId}`)).state).toBe('SUCCESS');
  expect((await get(request, '/flows?limit=100')).some((f) => f.flowId === id)).toBe(false);
  await page.screenshot({ path: '.local/evidence/management-policy.png', fullPage: true });
});

test('real registry and Kubernetes deployment create, ready, stale delete rejected, refreshed delete', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const id = unique();
  await put(request, `/applications/${id}/versions/v1`, {
    applicationId: id,
    version: 'v1',
    image: 'ui-registry:5000/alpine:v1',
    parameters: {},
  });
  await login(page);
  await nav(page, '边缘服务部署');
  await page.getByLabel('执行集群', { exact: true }).selectOption('runtime-edge');
  await expect(page.getByRole('button', { name: '＋ 创建部署', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '＋ 创建部署', exact: true }).click();
  await page.getByLabel('部署名称', { exact: true }).fill(id);
  await page.getByLabel('应用版本', { exact: true }).selectOption(`${id}/v1`);
  await page.getByText('高级配置', { exact: true }).click();
  await page.getByLabel('自定义启动命令', { exact: true }).check();
  await page.getByLabel('启动命令 JSON', { exact: true }).fill('["/bin/sh","-c","exec sleep 3600"]');
  await page.getByRole('button', { name: '创建部署', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('部署配置已被接受', { timeout: 60000 });
  const path = `/clusters/runtime-edge/deployments/${id}`;
  await expect.poll(async () => (await get(request, path)).readyReplicas, { timeout: 60000 }).toBe(1);
  await page.getByRole('button', { name: '↻ 刷新状态', exact: true }).click();
  await expect(page.locator('.detail-grid')).toContainText('1 / 1');
  const live = await get(request, path);
  await put(request, path, {
    applicationId: id,
    version: 'v1',
    replicas: 1,
    parameters: {},
    command: ['/bin/sh', '-c', 'exec sleep 3601'],
    resourceVersion: live.resourceVersion,
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '删除部署', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('409');
  await page.getByRole('button', { name: '↻ 刷新状态', exact: true }).click();
  await expect(page.getByRole('button', { name: '↻ 刷新状态', exact: true })).toBeEnabled();
  await page.screenshot({ path: '.local/evidence/management-deployment.png', fullPage: true });
  // Status changes also change Kubernetes resourceVersion: refresh immediately before each explicit retry.
  for (let i = 0; i < 5; i++) {
    await page.getByRole('button', { name: '↻ 刷新状态', exact: true }).click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: '删除部署', exact: true }).click();
    await expect(page.locator('[role="status"], [role="alert"]')).toBeVisible();
    if (await page.getByRole('status').count()) break;
    await expect(page.getByRole('alert')).toContainText('409');
  }
  await expect(page.getByRole('status')).toContainText('删除请求已接受');
  await expect.poll(async () => (await request.get(base + path, { headers })).status()).toBe(404);
});

test('read-only viewer sees catalogs but cannot mutate; empty offload data is not fabricated', async ({
  page,
}) => {
  await login(page, 'viewer');
  await nav(page, '集群管理');
  await page.getByRole('button', { name: '＋ 登记集群', exact: true }).click();
  await page.getByLabel('集群 ID', { exact: true }).fill(unique());
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('403');
  page.once('dialog', (dialog) => dialog.accept());
  await nav(page, '任务卸载决策记录');
  await expect(page.locator('.empty h2')).toHaveText('暂无记录');
  await expect(page.locator('.table-wrap tbody tr')).toHaveCount(0);
  await expect(page.locator('.page-heading button')).toHaveCount(0);
});

test('pages keep headings and actions without instructional prose or help disclosures', async ({ page }) => {
  await login(page);
  for (const title of [
    '数据流编排',
    '数据流执行记录',
    '应用与镜像',
    '边缘服务部署',
    '集群管理',
    '数据集管理',
    '边缘网关管理',
    '终端设备接入',
    '边缘数据处理策略',
    '任务卸载决策记录',
  ]) {
    await nav(page, title);
    await expect(page.locator('.page-heading p, .empty p')).toHaveCount(0);
    await expect(page.locator('.page-heading details, [role="tooltip"]')).toHaveCount(0);
    await expect(page.locator('.list-toolbar button').last()).toBeVisible();
    if (title === '数据流执行记录' || title === '集群管理')
      await page.screenshot({ path: `.local/evidence/clean-${title}.png`, fullPage: true });
  }
  await nav(page, '应用与镜像');
  await page.getByRole('button', { name: '＋ 注册应用版本', exact: true }).click();
  await expect(page.locator('.catalog-section > p.muted.small')).toHaveCount(0);
  await expect(page.getByLabel('镜像引用', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存配置', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '＋ 添加参数', exact: true }).click();
  await expect(page.getByLabel('参数 1 · 默认值 JSON', { exact: true })).toBeVisible();
  await page.screenshot({ path: '.local/evidence/clean-application-form.png', fullPage: true });
});

test('catalog failures are visible, not empty success, and switching pages discards late responses', async ({
  page,
}) => {
  await login(page);
  await page.route('**/api/namespaces/lab/resources/datasets?*', (route) => route.abort('failed'));
  await nav(page, '数据集管理');
  await expect(page.getByRole('alert')).toContainText('后端不可达');
  await expect(page.locator('.empty h2')).toHaveText('未能读取目录');
  await nav(page, '应用与镜像');
  await page.getByRole('button', { name: '＋ 注册应用版本', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('候选目录读取失败');
  await expect(page.getByRole('button', { name: '保存配置', exact: true })).toBeDisabled();
  await page.unrouteAll();
  await page.getByRole('button', { name: '重试目录', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
