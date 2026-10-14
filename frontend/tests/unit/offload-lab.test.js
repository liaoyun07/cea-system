import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskWindow, resourceWindow } from '../../src/management/offload-lab.js';
test('task total sums individual elapsed time, not line-chart area or batch walltime', () => {
  const result = taskWindow(
    [
      { state: 'SUCCESS', requestedAt: 1, finishedAt: 11, terminal: 'a', destination: 'EDGE' },
      { state: 'SUCCESS', requestedAt: 2, finishedAt: 12, terminal: 'b', destination: 'CLOUD' },
      { state: 'FAILED', requestedAt: 3, finishedAt: 13 },
    ],
    10,
    12,
  );
  assert.equal(result.count, 2);
  assert.equal(result.total, 20);
  assert.deepEqual(
    result.points.map((p) => p.x),
    [11000, 12000],
  );
  assert.equal(taskWindow([], 0, 1).total, 0);
});
test('resource percentages weight actual capacity and do not duplicate a terminal in a bucket', () => {
  const sample = {
    terminal: 'a',
    sampledAt: 8,
    cpuSeconds: 0.2,
    sampleSeconds: 2,
    cpuCores: 0.2,
    memoryBytes: 10,
    memoryLimitBytes: 100,
  };
  const result = resourceWindow(
    [sample, { ...sample, sampledAt: 9 }, { ...sample, terminal: 'b', cpuCores: 0.4, memoryLimitBytes: 300 }],
    0,
    12,
  );
  assert.equal(result.cpu.length, 1);
  assert.ok(Math.abs(result.cpu[0].y - 100 / 3) < 1e-8);
  assert.equal(result.memory[0].y, 5);
});
