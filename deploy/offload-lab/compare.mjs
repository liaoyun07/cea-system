import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { folder, read } from './setup.mjs';
const token = read(`${folder}/secrets.json`).token;
const call = async (path, body) => {
  const response = await fetch('http://127.0.0.1:18195' + path, { method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  assert(response.ok, `${path}: ${response.status}`);
  return response.json();
};
const evidence = `${folder}/comparison.json`;
const state = existsSync(evidence) ? read(evidence) : { settings: { seconds: 90, interval: 10, seed: 31 }, runs: {} };
const save = () => writeFileSync(evidence, JSON.stringify(state, null, 2));
for (const strategy of ['LOCAL', 'RANDOM']) {
  if (!state.runs[strategy]) {
    // Persist intent before submission. Unknown responses must be reconciled, not blindly repeated.
    state.runs[strategy] = { intentAt: Date.now(), id: null }; save();
    const run = await call('/runs', { ...state.settings, strategy });
    state.runs[strategy].id = run.id; save();
  }
  const id = state.runs[strategy].id;
  assert(id, 'submission outcome unknown; inspect existing experiment instead of resubmitting');
  while (true) {
    const view = await call('/runs/' + id);
    state.runs[strategy].last = { state: view.run.state, cleanup: view.run.cleanup, summary: view.summary }; save();
    console.log(strategy, view.run.state, `${view.summary.completed}/${view.summary.submitted}`, view.run.cleanup);
    assert(!['ERROR', 'INTERRUPTED'].includes(view.run.state), view.run.error || view.run.state);
    if (view.run.state === 'FINISHED' && view.run.cleanup === 'DONE') {
      writeFileSync(`${folder}/${strategy.toLowerCase()}-result.json`, JSON.stringify(view, null, 2));
      assert.equal(view.summary.failed, 0, 'do not start another comparison after a failed batch');
      assert.equal(view.summary.completed, view.run.expected, 'missing planned arrivals');
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
}
const local = read(`${folder}/local-result.json`), random = read(`${folder}/random-result.json`);
assert.deepEqual(local.run.plans, random.run.plans);
const expected = read(`${folder}/../matrix/files.json`);
for (const view of [local, random]) for (const task of view.tasks) {
  const reference = expected.find(f => f.bytes === task.bytes).expected;
  for (const [key, value] of Object.entries(reference)) assert(Math.abs(task.result[key] - value) <= Math.max(1e-9, Math.abs(value) * 1e-8), `${task.id}: ${key} mismatch`);
}
state.result = { local: local.summary, random: random.summary,
  arrivalLagSeconds: Object.fromEntries([['local', local], ['random', random]].map(([name, view]) => {
    const lags = view.tasks.map(t => t.requestedAt - t.scheduledAt);
    return [name, { mean: lags.reduce((a, b) => a + b, 0) / lags.length, max: Math.max(...lags) }];
  })),
  meanReductionPercent: (1 - random.summary.meanSeconds / local.summary.meanSeconds) * 100,
  makespanReductionPercent: (1 - random.summary.makespanSeconds / local.summary.makespanSeconds) * 100 };
save();
console.log(JSON.stringify(state.result, null, 2));
