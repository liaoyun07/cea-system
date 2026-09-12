import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chartScale,
  instanceLabel,
  metricSources,
  metricTags,
  numericMetrics,
} from '../../src/execution-metrics.js';

test('metrics filter JSON ports from authoritative execution declarations without looking up a current Flow', () => {
  const task = (id) => ({ id, ports: ['metrics.json', 'model.pt'] });
  assert.deepEqual(
    metricSources([task('train'), task('evaluate'), task('cleanup'), { id: 'model', ports: ['model.pt'] }]),
    [
      { id: 'train', ports: ['metrics.json'] },
      { id: 'evaluate', ports: ['metrics.json'] },
      { id: 'cleanup', ports: ['metrics.json'] },
    ],
  );
});
test('instance labels keep round and item scopes instead of merging equal task IDs', () => {
  const rounds = { id: 'r', taskId: 'rounds', iteration: 0 };
  const clients = { id: 'c', taskId: 'clients', iteration: 2, parentTaskRunId: 'r' };
  const train = { id: 't', taskId: 'train', iteration: 3, parentTaskRunId: 'c' };
  assert.equal(instanceLabel(train, [rounds, clients, train]), 'rounds[2] / clients[3] / train');
  assert.equal(instanceLabel(rounds, [rounds]), 'rounds');
});
test('only finite numbers become metrics; zero stays zero, no string/null coercion or missing-to-zero', () => {
  const input = {
    loss: 0,
    accuracy: 0.75,
    samples: 256,
    round: 2,
    algorithm: 'fedavg',
    stringNumber: '9',
    absent: null,
    nested: { loss: 1 },
  };
  assert.deepEqual(
    [...numericMetrics(input)],
    [
      ['loss', 0],
      ['accuracy', 0.75],
      ['samples', 256],
      ['round', 2],
    ],
  );
  assert.equal(numericMetrics(input).get('missing'), undefined);
  assert.deepEqual(metricTags(input), [
    ['algorithm', 'fedavg'],
    ['stringNumber', '9'],
  ]);
  for (const input of [null, [], 'text', { loss: Infinity }, { loss: NaN }])
    assert.throws(() => numericMetrics(input));
});
test('chart has a truthful zero baseline and handles negative/all-zero/very large numbers', () => {
  for (const values of [[0, 0], [0.2, 0.8], [-4, -1], [-1e308, 1e308], []]) {
    const scale = chartScale(values);
    for (const value of [0, ...values]) {
      assert.ok(Number.isFinite(scale.y(value)));
      assert.ok(scale.y(value) >= 40 && scale.y(value) <= 220);
    }
  }
  const scale = chartScale([2, 4]);
  assert.equal(scale.y(0), 220);
  assert.equal(scale.y(4), 40);
});
