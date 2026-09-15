import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const folder = resolve(import.meta.dirname, '../../../.local/cea/par01');
const cases = JSON.parse(await readFile(resolve(folder, 'cases.json')));
const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
const summaries = [];
for (const current of cases) {
  const runs = [];
  for (const repeat of [1, 2, 3]) {
    // Missing or failed trials must not silently disappear from the comparison.
    const result = JSON.parse(await readFile(resolve(folder, `${current.flowId}-r${repeat}`, 'result.json')));
    runs.push(result);
  }
  const success = runs.filter(r => r.measurement.status === 'AVAILABLE');
  const values = success.map(r => r.measurement.bytesPerSecond / 1e6);
  const bytes = success.map(r => r.measurement.inputBytes + r.measurement.outputBytes);
  assert(success.length > 0, 'No valid throughput sample; do not summarize as zero');
  summaries.push({ flow: current.flowId, algorithm: current.algorithm, dataset: current.dataset,
    clients: current.clients, concurrency: current.concurrency, runs: runs.map(r => r.executionId),
    attempted: runs.length, successful: success.length, failures: runs.filter(r => r.measurement.status !== 'AVAILABLE').map(r => ({ id: r.executionId, error: r.error })),
    ratesMBps: values, meanMBps: mean(values), minMBps: Math.min(...values), maxMBps: Math.max(...values),
    meanActiveSeconds: mean(success.map(r => r.measurement.activeSeconds)),
    meanWallSeconds: mean(success.map(r => r.wallSeconds)), meanBytes: mean(bytes),
    trainingPeakByRound: success.map(r => r.training.map(t => t.peak)),
    meanTrainingParallel: mean(success.flatMap(r => r.training.map(t => t.meanParallel))) });
}
for (const row of summaries.filter(r => r.clients === 6 && r.concurrency === 6)) {
  const base = summaries.find(r => r.algorithm === row.algorithm && r.dataset === row.dataset && r.clients === 3);
  row.gainPercent = 100 * (row.meanMBps / base.meanMBps - 1);
  row.activeTimeReductionPercent = 100 * (1 - row.meanActiveSeconds / base.meanActiveSeconds);
  row.byteIncreasePercent = 100 * (row.meanBytes / base.meanBytes - 1);
}
await writeFile(resolve(folder, 'summary.json'), JSON.stringify(summaries, null, 2));
console.log(JSON.stringify(summaries, null, 2));
