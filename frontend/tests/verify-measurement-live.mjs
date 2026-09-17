// Read-only CEA verification. Recomputes the union independently with BigInt nanoseconds.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { processingRate } from '../src/execution-metrics.js';

const root = resolve(import.meta.dirname, '../..'),
  evidence = resolve(root, '.local/cea/met01');
const user = process.env.CEA_E2E_USER,
  password = process.env.CEA_E2E_PASSWORD;
if (!user || !password) throw new Error('Provide CEA_E2E_USER/PASSWORD via process environment');
const url = 'http://127.0.0.1:18080',
  headers = { Authorization: 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64') };
const api = async (path) => {
  const response = await fetch(`${url}/api/namespaces/lab${path}`, { headers });
  assert.equal(response.status, 200, path);
  return response.json();
};
const before = JSON.parse(await readFile(resolve(evidence, 'before.json'), 'utf8'));
const originalIds = new Set(before.executions.map((e) => e.id));
const measuredFlows = new Set([
  'fedavg',
  'fedprox',
  'hydraulic-local',
  'bearing-return',
  'surface-cloud',
  'offload-terminal',
  'offload-edge',
  'offload-cloud',
]);
const runs = (await api('/executions?limit=100')).filter(
  (e) => !originalIds.has(e.id) && measuredFlows.has(e.flowId),
);
const successful = runs.filter((run) => run.state === 'SUCCESS');
assert.equal(
  new Set(successful.map((run) => run.flowId)).size,
  8,
  'expect two federation, three edge policies and three terminal offload executions',
);
const failures = [];
for (const run of runs.filter((run) => run.state !== 'SUCCESS')) {
  assert(['FAILED', 'KILLED'].includes(run.state), 'no unfinished validation execution');
  const value = await api(`/executions/${run.id}/measurement`);
  assert.equal(value.status, 'NOT_SUCCESSFUL');
  assert.equal(value.bytesPerSecond, null);
  failures.push({ id: run.id, flowId: run.flowId, state: run.state, error: run.error, measurement: value });
}
await writeFile(resolve(evidence, 'failed-measurements.json'), JSON.stringify(failures, null, 2));
const nanos = (value) => {
  const [whole, fraction] = value.replace(/Z$/, '').split('.');
  return BigInt(Date.parse(whole + 'Z')) * 1_000_000n + BigInt((fraction || '').padEnd(9, '0'));
};
const result = [];
for (const run of successful) {
  assert.equal(run.state, 'SUCCESS', run.id);
  const value = await api(`/executions/${run.id}/measurement`);
  assert.equal(value.status, 'AVAILABLE', run.id);
  const tasks = await api(`/executions/${run.id}/tasks`),
    declared = await api(`/executions/${run.id}/output-files`);
  const appIds = new Set(declared.map((d) => d.id));
  let input = 0n,
    output = 0n;
  const intervals = [],
    reports = [];
  for (const task of tasks.filter((t) => appIds.has(t.taskId) && t.state !== 'SKIPPED')) {
    const report = await api(`/executions/${run.id}/tasks/${task.id}/output-json?port=cea-measurement.json`);
    if (['fedavg', 'fedprox'].includes(run.flowId)) {
      // Independent physical evidence fetched and numerically audited by verify-federated.ps1.
      // Do not derive the expected byte count from this SDK report or the measurement API.
      const directory = resolve(root, '.local/cea/evidence', run.flowId, run.id);
      const round =
        task.taskId === 'train'
          ? tasks.find((parent) => parent.id === task.parentTaskRunId).iteration
          : task.iteration;
      const client = ['a', 'b', 'c'][task.iteration - 1];
      const expected =
        task.taskId === 'init'
          ? [[], ['init.pt']]
          : task.taskId === 'train'
            ? [
                [round === 1 ? 'init.pt' : `aggregate-r${round - 1}.pt`, `edge-${client}.pt`],
                [`client-${client}-r${round}.pt`],
              ]
            : task.taskId === 'aggregate'
              ? [
                  [...['a', 'b', 'c'].map((letter) => `client-${letter}-r${round}.pt`)],
                  [`aggregate-r${round}.pt`],
                ]
              : task.taskId === 'evaluate'
                ? [[`aggregate-r${round}.pt`, 'test.pt'], [`evaluate-r${round}.json`]]
                : null;
      assert(expected, 'only the four known federation stages');
      for (const [index, direction] of ['inputs', 'outputs'].entries()) {
        const physicalSizes = await Promise.all(
          expected[index].map(async (name) => (await stat(resolve(directory, name))).size),
        );
        assert.deepEqual(
          report[direction].map((file) => file.bytes).sort((a, b) => a - b),
          physicalSizes.sort((a, b) => a - b),
          `${run.flowId}/${task.id}/${direction} physical file sizes`,
        );
      }
    }
    input += report.inputs.reduce((sum, f) => sum + BigInt(f.bytes), 0n);
    output += report.outputs.reduce((sum, f) => sum + BigInt(f.bytes), 0n);
    intervals.push([nanos(report.startedAt), nanos(report.endedAt)]);
    reports.push({ taskRunId: task.id, taskId: task.taskId, iteration: task.iteration, report });
  }
  intervals.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  let total = 0n,
    [start, end] = intervals[0];
  for (const [a, b] of intervals.slice(1)) {
    if (a > end) {
      total += end - start;
      start = a;
      end = b;
    } else if (b > end) end = b;
  }
  total += end - start;
  assert.equal(BigInt(value.inputBytes), input);
  assert.equal(BigInt(value.outputBytes), output);
  assert(Math.abs(value.activeSeconds - Number(total) / 1e9) < 1e-9);
  assert(Math.abs(value.bytesPerSecond - Number(input + output) / (Number(total) / 1e9)) < 1e-6);
  result.push({ id: run.id, flowId: run.flowId, measurement: value, reports });
}
const historical = before.executions.find((e) => e.flowId === 'fedavg' && e.state === 'SUCCESS');
assert.equal((await api(`/executions/${historical.id}/measurement`)).status, 'INCOMPLETE');
const unauthorized = await fetch(`${url}/api/namespaces/lab/executions/${result[0].id}/measurement`);
assert.equal(unauthorized.status, 401);
await writeFile(resolve(evidence, 'measurements.json'), JSON.stringify(result, null, 2));

const browser = await chromium.launch(),
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.goto(url);
  await page.getByLabel('账号', { exact: true }).fill(user);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '连接工作空间 →', exact: true }).click();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '数据流执行记录', exact: true })
    .click();
  const chosen = result.find((e) => e.flowId === 'fedavg');
  assert(chosen);
  await page.getByText(chosen.id, { exact: true }).waitFor();
  const row = page.locator('tr').filter({ has: page.getByText(chosen.id, { exact: true }) });
  await row.getByRole('button', { name: '详情 →', exact: true }).click();
  await page
    .getByTestId('processing-rate')
    .filter({ hasText: processingRate(chosen.measurement) })
    .waitFor();
  await page.screenshot({ path: resolve(evidence, 'measurement-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(evidence, 'measurement-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
console.log(
  JSON.stringify(
    result.map(({ id, flowId, measurement }) => ({ id, flowId, ...measurement })),
    null,
    2,
  ),
);
console.log(
  'PASS: complete reports, independent union/byte calculation, historical missing reports, auth and live UI.',
);
