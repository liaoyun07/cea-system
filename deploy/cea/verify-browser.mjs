// Read-only smoke test against the actual deployed frontend/API; creates no Flow or Execution.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const settings = Object.fromEntries((await readFile(new URL('.env', import.meta.url), 'utf8'))
  .split(/\r?\n/).filter(line => /^[A-Z_0-9]+=/.test(line)).map(line => {
    const split = line.indexOf('=');
    return [line.slice(0, split), line.slice(split + 1)];
  }));
const evidence = new URL('../../.local/cea/browser/', import.meta.url);
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const logCounts = {};
const page = await browser.newPage({ baseURL: 'http://127.0.0.1:' + settings.CEA_HTTP_PORT, viewport: { width: 1440, height: 1000 } });
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto('http://127.0.0.1:' + settings.CEA_HTTP_PORT);
  await page.getByLabel('账号', { exact: true }).fill(settings.BACKEND_USER);
  await page.getByLabel('密码', { exact: true }).fill(settings.BACKEND_PASSWORD);
  await page.getByRole('button', { name: '连接工作空间 →', exact: true }).click();
  await expect(page.getByRole('heading', { name: '流程', exact: true })).toBeVisible();
  for (const flow of ['fedavg', 'fedprox']) {
    await expect(page.getByRole('button', { name: flow, exact: true })).toBeVisible();
  }
  await page.screenshot({ path: fileURLToPath(new URL('flows.png', evidence)), fullPage: true });
  for (const flow of ['fedavg', 'fedprox']) {
    await page.getByRole('button', { name: flow, exact: true }).click();
    await expect(page.getByLabel('Flow YAML')).toHaveValue(/core\.Loop/);
    await page.getByRole('button', { name: '流程', exact: true }).first().click();
  }
  await page.getByRole('button', { name: '执行', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '执行', exact: true })).toBeVisible();
  for (const flow of ['fedavg', 'fedprox']) {
    const row = page.getByRole('row').filter({ hasText: flow }).filter({ hasText: 'SUCCESS' }).first();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: '详情 →', exact: true }).click();
    await page.getByRole('tab', { name: /^任务实例/ }).click();
    await expect(page.locator('td > strong').filter({ hasText: /^train$/ })).toHaveCount(6);
    await page.getByRole('tab', { name: '输出', exact: true }).click();
    await expect(page.getByTestId('execution-outputs')).toContainText('completed_rounds');
    await page.screenshot({ path: fileURLToPath(new URL(flow + '-outputs.png', evidence)), fullPage: true });
    await page.getByRole('tab', { name: '日志', exact: true }).click();
    // These Application-only Flows do not emit core.Log entries. Compare with
    // the actual API; do not manufacture logs or claim Pod stdout is integrated.
    const executions = await page.request.get('/api/namespaces/lab/executions', {
      headers: { Authorization: 'Basic ' + Buffer.from(settings.BACKEND_USER + ':' + settings.BACKEND_PASSWORD).toString('base64') }
    });
    expect(executions.status()).toBe(200);
    const execution = (await executions.json()).find(run => run.flowId === flow && run.state === 'SUCCESS');
    const logs = await page.request.get('/api/namespaces/lab/executions/' + execution.id + '/logs', {
      headers: { Authorization: 'Basic ' + Buffer.from(settings.BACKEND_USER + ':' + settings.BACKEND_PASSWORD).toString('base64') }
    });
    expect(logs.status()).toBe(200);
    logCounts[flow] = (await logs.json()).length;
    if (logCounts[flow] === 0) await expect(page.getByLabel('执行日志')).toContainText('暂无日志');
    else await expect(page.getByLabel('执行日志')).not.toContainText('暂无日志');
    await page.getByRole('button', { name: '执行', exact: true }).first().click();
  }
  expect(errors).toEqual([]);
  const result = { result: 'PASS', scope: 'real deployed frontend: login, both saved Flows, Loop YAML, both successful executions, six training instances each, outputs and log empty-state consistent with API; read-only', logCounts, limitation: 'Application Pod stdout is not collected into Execution logs by the current runtime', checkedAt: new Date().toISOString() };
  await writeFile(new URL('result.json', evidence), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  await page.screenshot({ path: fileURLToPath(new URL('failure.png', evidence)), fullPage: true });
  throw error;
} finally {
  await browser.close();
}
