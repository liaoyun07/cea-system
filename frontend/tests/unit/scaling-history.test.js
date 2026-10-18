import test from 'node:test';
import assert from 'node:assert/strict';
import { replicaChart, scalingSummary } from '../../src/management/scaling-history.js';
import { deploymentBody, deploymentDraft } from '../../src/management/catalogs.js';
test('scaling average includes completed expansions only; zero is a real sampled interval', () => {
  const events = [
    { fromReplicas: 1, toReplicas: 3, state: 'SUCCEEDED', durationMs: 1200 },
    { fromReplicas: 1, toReplicas: 2, state: 'SUCCEEDED', durationMs: 0 },
    { fromReplicas: 3, toReplicas: 1, state: 'SUCCEEDED', durationMs: 7000 },
    { fromReplicas: 1, toReplicas: 2, state: 'INTERRUPTED', durationMs: null },
  ];
  assert.deepEqual(scalingSummary(events), { total: 3, completed: 2, mean: 600 });
  assert.equal(scalingSummary([]).mean, null);
});
test('replica timeline uses steps, and renders empty and one-sample cases', () => {
  assert.deepEqual(replicaChart([]).paths, []);
  const chart = replicaChart([
    { at: '2026-10-18T00:00:00Z', desired: 1, ready: 1, standby: 2 },
    { at: '2026-10-18T00:00:10Z', desired: 3, ready: 1, standby: 0 },
  ]);
  assert.match(chart.paths[0], /^M[\d.,]+ H[\d.]+V[\d.]+$/);
  assert.equal(chart.ticks.at(-1).value, 3);
  assert(
    !replicaChart([{ at: '2026-10-18T00:00:00Z', desired: 1, ready: 1, standby: 0 }])
      .paths.join('')
      .includes('NaN'),
  );
});
test('create-time HPA shares native fields, editing preserves workload mode without resetting HPA', () => {
  const draft = deploymentDraft('test', {
    applicationId: 'app',
    version: 'v1',
    replicas: 1,
    parameters: {},
    command: [],
    warmPool: true,
    resourceVersion: '2',
  });
  assert.equal(deploymentBody(draft).warmPool, true);
  assert(!Object.hasOwn(deploymentBody(draft), 'autoscaling'));
  draft.autoscalingEnabled = true;
  draft.autoscaling = { minReplicas: 1, maxReplicas: 4, cpuUtilization: 60, memoryUtilization: '' };
  assert.deepEqual(deploymentBody(draft).autoscaling, {
    minReplicas: 1,
    maxReplicas: 4,
    cpuUtilization: 60,
    memoryUtilization: null,
  });
});
