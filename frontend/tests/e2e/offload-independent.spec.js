import { test, expect } from '@playwright/test';

test('independent offloading uses its own API and preserves old flow-load entry', async ({ page }) => {
  const stamp = Date.now() / 1000 - 20;
  const sample = {
    terminal: 'oil-terminal-001',
    gateway: 'edge-a',
    sampledAt: stamp + 19,
    cpuSeconds: 0.1,
    sampleSeconds: 2,
    cpuCores: 0.1,
    memoryBytes: 100e6,
    memoryLimitBytes: 512 * 1048576,
  };
  const task = {
    state: 'SUCCESS',
    requestedAt: stamp + 1,
    finishedAt: stamp + 8,
    destination: 'EDGE',
    terminal: 'oil-terminal-001',
  };
  const run = {
    id: 'oil-123456789abc',
    state: 'FINISHED',
    strategy: 'RANDOM',
    startAt: stamp,
    createdAt: stamp,
    endedAt: stamp + 20,
    changes: [],
    cleanup: 'DONE',
  };
  const summary = {
    submitted: 1,
    completed: 1,
    failed: 0,
    pending: 0,
    meanSeconds: 7,
    p95Seconds: 7,
    makespanSeconds: 7,
    destinations: { TERMINAL: 0, EDGE: 1, CLOUD: 0 },
  };
  let sent;
  await page.route('**/edge/offload-lab/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body;
    if (path.endsWith('/devices'))
      body = [{ id: sample.terminal, gateway: sample.gateway, resource: sample }];
    else if (route.request().method() === 'POST') {
      sent = route.request().postDataJSON();
      body = run;
    } else if (path.endsWith('/runs')) body = [run];
    else body = { run, tasks: [task], samples: [sample], summary };
    await route.fulfill({ json: body });
  });
  await page.goto('/');
  await page.getByLabel('账号', { exact: true }).fill(process.env.CEA_E2E_USER);
  await page.getByLabel('密码', { exact: true }).fill(process.env.CEA_E2E_PASSWORD);
  await page.getByRole('button', { name: '连接工作空间 →', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: '终端设备接入', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'oil-terminal-001', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '负载与调度', exact: true }).click();
  await expect(page.getByRole('heading', { name: '单任务端到端耗时' })).toBeVisible();
  await expect(page.getByText('区间累计')).toContainText('7.00 s');
  await expect(page.getByRole('button', { name: '流任务负载记录' })).toBeVisible();
  await page.getByLabel('调度策略', { exact: true }).selectOption('RANDOM');
  await page.getByRole('button', { name: '开始发送', exact: true }).click();
  await expect.poll(() => sent?.strategy).toBe('RANDOM');
  expect(sent).toEqual({ strategy: 'RANDOM', seconds: 90, interval: 10, seed: 31 });
  await page.screenshot({ path: '.local/evidence/offload-independent.png', fullPage: true });
});
