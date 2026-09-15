import assert from 'node:assert/strict';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const bulkExperiment = process.argv.includes('--bulk');
const batchExperiment = bulkExperiment || process.argv.includes('--batch');
const replicated = batchExperiment || process.argv.includes('--replicated');
const folder = resolve(import.meta.dirname, `../../../.local/cea/${bulkExperiment ? 'par04' : batchExperiment ? 'par03' : replicated ? 'par02' : 'par01'}`);
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
  if (replicated) for (const result of success) {
    const reports = JSON.parse(await readFile(resolve(folder, `${current.flowId}-r${result.repeat}`, 'reports.json')));
    const training = reports.filter(report => report.taskId === 'train');
    assert.equal(training.length, current.clients * (current.rounds ?? 2));
    assert.equal(new Set(training.map(report => `${report.round}/${report.item}`)).size, current.clients * (current.rounds ?? 2));
    for (const report of training) {
      const cluster = current.items[report.item - 1].clusters[0];
      const originalBytes = (await stat(resolve(folder, '../cifar10', `${cluster}.pt`))).size;
      const datasetInputs = report.inputs.filter(input => input.path === '/cea-work/in/dataset-DATASET');
      assert.equal(datasetInputs.length, 1);
      assert.equal(datasetInputs[0].bytes, originalBytes, 'Each client must read its entire original shard');
    }
  }
  const values = success.map(r => r.measurement.bytesPerSecond / 1e6);
  const bytes = success.map(r => r.measurement.inputBytes + r.measurement.outputBytes);
  assert(success.length > 0, 'No valid throughput sample; do not summarize as zero');
  summaries.push({ flow: current.flowId, algorithm: current.algorithm, dataset: current.dataset,
    clients: current.clients, concurrency: current.concurrency, runs: runs.map(r => r.executionId),
    ...(batchExperiment ? { batchSize: current.batchSize, rounds: current.rounds,
      evaluation: success.map(r => r.evaluation) } : {}),
    ...(bulkExperiment ? { loader: current.loader } : {}),
    ...(replicated ? { workload: current.workload, uniqueTrainSamples: current.uniqueTrainSamples,
      processedTrainSamplesPerRound: current.processedTrainSamplesPerRound } : {}),
    attempted: runs.length, successful: success.length, failures: runs.filter(r => r.measurement.status !== 'AVAILABLE').map(r => ({ id: r.executionId, error: r.error })),
    ratesMBps: values, meanMBps: mean(values), minMBps: Math.min(...values), maxMBps: Math.max(...values),
    meanActiveSeconds: mean(success.map(r => r.measurement.activeSeconds)),
    meanWallSeconds: mean(success.map(r => r.wallSeconds)), meanBytes: mean(bytes),
    trainingPeakByRound: success.map(r => r.training.map(t => t.peak)),
    meanTrainingParallel: mean(success.flatMap(r => r.training.map(t => t.meanParallel))) });
}
for (const row of summaries.filter(r => bulkExperiment ? r.loader === 'bulk' : batchExperiment ? r.batchSize !== 32 : replicated ? r.clients > 3 : r.clients === 6 && r.concurrency === 6)) {
  const base = summaries.find(r => r.algorithm === row.algorithm && r.dataset === row.dataset &&
    (bulkExperiment ? r.loader === 'baseline' : batchExperiment ? r.batchSize === 32 : r.clients === 3));
  row.gainPercent = 100 * (row.meanMBps / base.meanMBps - 1);
  row.activeTimeReductionPercent = 100 * (1 - row.meanActiveSeconds / base.meanActiveSeconds);
  row.byteIncreasePercent = 100 * (row.meanBytes / base.meanBytes - 1);
}
await writeFile(resolve(folder, 'summary.json'), JSON.stringify(summaries, null, 2));
console.log(JSON.stringify(summaries, null, 2));
