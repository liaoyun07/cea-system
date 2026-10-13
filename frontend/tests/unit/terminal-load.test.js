import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, resourceSeries, usage } from '../../src/management/terminal-load.js';
const at = (s) => new Date(s * 1000).toISOString();
test('latency is one sample per success; totals follow range and terminal filters', () => {
  const row = (id, terminal, seconds, finished, outcome = 'SUCCESS') => ({
    executionId: id,
    terminalId: terminal,
    phase: 1,
    acceptedAt: at(1),
    finishedAt: at(finished),
    elapsedSeconds: seconds,
    outcome,
  });
  const view = {
    data: {
      phases: [{ number: 1, strategy: 'LOCAL' }],
      requests: [
        row('a', 't1', 2, 5),
        row('b', 't1', 3, 8),
        row('c', 't2', 4, 6),
        row('d', 't1', 20, 7, 'FAILED'),
      ],
    },
    targets: [],
  };
  const result = summarize(view, ['t1'], 4000, 7500);
  assert.equal(result.total, 2);
  assert.equal(result.completed, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.points.length, 1);
});
test('placement uses frozen strategy and actual started position, deduplicated', () => {
  const view = {
    data: {
      phases: [
        { number: 1, strategy: 'LOCAL' },
        { number: 2, strategy: 'DQN' },
      ],
      requests: [
        { executionId: 'a', terminalId: 't', phase: 1, acceptedAt: at(1) },
        { executionId: 'b', terminalId: 't', phase: 2, acceptedAt: at(3) },
      ],
    },
    targets: [
      { executionId: 'a', startedAt: at(2), target: { kind: 'TERMINAL', id: 't' } },
      { executionId: 'b', startedAt: at(4), target: { kind: 'EDGE', id: 'edge-a' } },
      { executionId: 'b', startedAt: at(4), target: { kind: 'EDGE', id: 'edge-a' } },
    ],
  };
  const result = summarize(view, ['t'], 0, 10000);
  assert.equal(result.destinations[0].counts.TERMINAL, 1);
  assert.equal(result.destinations[1].total, 1);
  assert.equal(result.destinations[1].counts.EDGE, 1);
});
test('resource aggregation is capacity-weighted and excludes stale/missing terminals', () => {
  const sample = (terminalId, cpuCores, cpuSeconds, memoryLimitBytes, memoryBytes) => ({
    terminalId,
    sampledAt: at(1),
    resource: { cpuCores, cpuSeconds, memoryLimitBytes, memoryBytes, sampleSeconds: 1 },
  });
  const result = resourceSeries(
    [sample('a', 1, 1, 100, 100), sample('b', 3, 0, 300, 0)],
    ['a', 'b'],
    0,
    10000,
  );
  assert.equal(result.cpu.at(-1).y, 25);
  assert.equal(result.memory.at(-1).y, 25);
  assert.equal(resourceSeries([sample('a', 1, 1, 100, 100)], ['a', 'b'], 0, 10000).cpu.at(-1).y, null);
  assert.equal(usage(null).cpu, null);
});
