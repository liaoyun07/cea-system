import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../../../frontend/node_modules/yaml/dist/index.js';
import { makeFlow, makeReplicatedFlow, makeBatchFlow, makeBulkFlow, intervals } from './run.mjs';

test('three and six client experiment definitions preserve mathematical and file chain', () => {
  for (const algorithm of ['fedavg', 'fedprox']) for (const dataset of ['cifar10', 'cifar100']) {
    const source = readFileSync(new URL(`../${algorithm}.yaml`, import.meta.url), 'utf8');
    const original = parse(source);
    for (const [clients, concurrency] of [[3, 3], [6, 3], [6, 6]]) {
      const flow = makeFlow(source, algorithm, dataset, clients, concurrency);
      const loop = flow.tasks[1].tasks[0], train = loop.tasks[0].container;
      assert.equal(loop.loop.values.value.length, clients);
      assert.equal(new Set(loop.loop.values.value.map(item => item.id)).size, clients);
      assert.equal(loop.loop.concurrency, concurrency);
      assert.deepEqual(flow.tasks[1].repeat, original.tasks[1].repeat);
      assert.deepEqual(flow.tasks[1].tasks.slice(1), original.tasks[1].tasks.slice(1));
      assert.deepEqual(flow.tasks[0], original.tasks[0]);
      assert.equal(train.parameters.DATASET.source, clients === 3 ? 'INPUT' : 'ITEM');
      for (const letter of 'abc') assert.equal(loop.loop.values.value.filter(item => item.clusters[0] === `edge-${letter}`).length, clients / 3);
    }
  }
});
test('interval evidence uses union and actual peak, including touching boundaries', () => {
  const report = (start, end) => ({ startedAt: `2026-09-15T00:00:0${start}Z`, endedAt: `2026-09-15T00:00:0${end}Z` });
  assert.deepEqual(intervals([report(1, 4), report(2, 6), report(7, 9)]), { activeSeconds: 7, peak: 2, meanParallel: 9 / 7 });
  assert.equal(intervals([report(1, 2), report(2, 3)]).peak, 1);
});

test('repeated-load clients keep complete original dataset binding and unchanged algorithm/file chain', () => {
  const source = readFileSync(new URL('../fedavg.yaml', import.meta.url), 'utf8');
  const original = parse(source);
  for (const clients of [3, 6, 9, 12]) {
    const flow = makeReplicatedFlow(source, clients);
    const loop = flow.tasks[1].tasks[0], items = loop.loop.values.value;
    assert.equal(items.length, clients);
    assert.equal(new Set(items.map(item => item.id)).size, clients);
    assert.equal(loop.loop.concurrency, clients);
    assert.deepEqual(loop.tasks, original.tasks[1].tasks[0].tasks);
    assert.deepEqual(flow.tasks[0], original.tasks[0]);
    assert.deepEqual(flow.tasks[1].repeat, original.tasks[1].repeat);
    assert.deepEqual(flow.tasks[1].tasks.slice(1), original.tasks[1].tasks.slice(1));
    assert.deepEqual(items.slice(0, 3).map(item => item.clusters[0]), ['edge-a', 'edge-b', 'edge-c']);
    for (const letter of 'abc') assert.equal(items.filter(item => item.clusters[0] === `edge-${letter}`).length, clients / 3);
    assert.equal(flow.inputs.training_dataset.defaultValue, 'cifar10-train/v1');
    assert.equal(flow.inputs.local_epochs.defaultValue, 1);
  }
  assert.throws(() => makeReplicatedFlow(source, 15));
});

test('one-round batch comparison preserves nine clients, training chain and fixed evaluation batch', () => {
  const source = readFileSync(new URL('../fedavg.yaml', import.meta.url), 'utf8');
  const baseline = makeReplicatedFlow(source, 9);
  for (const batchSize of [32, 256, 1024, 16384]) {
    const flow = makeBatchFlow(source, batchSize);
    assert.equal(flow.id, `par03-fedavg-cifar10-c9-b${batchSize}`);
    assert.equal(flow.inputs.rounds.defaultValue, 1);
    assert.equal(flow.inputs.batch_size.defaultValue, batchSize);
    assert.equal(flow.inputs.local_epochs.defaultValue, 1);
    assert.deepEqual(flow.tasks[0], baseline.tasks[0]);
    assert.deepEqual(flow.tasks[1].repeat, baseline.tasks[1].repeat);
    assert.deepEqual(flow.tasks[1].tasks.slice(0, 2), baseline.tasks[1].tasks.slice(0, 2));
    assert.deepEqual(flow.tasks[1].tasks[2].container.parameters.BATCH_SIZE, { source: 'LITERAL', value: 32 });
    assert.deepEqual(flow.tasks[1].tasks[2].container.inputFiles, baseline.tasks[1].tasks[2].container.inputFiles);
    assert.deepEqual(flow.outputs, baseline.outputs);
  }
  assert.throws(() => makeBatchFlow(source, 0));
});

test('bulk-fetch A/B changes only training version and entrypoint, not data, sampler parameters or SDK outputs', () => {
  const source = readFileSync(new URL('../fedavg.yaml', import.meta.url), 'utf8');
  const baseline = makeBulkFlow(source, 'baseline');
  const candidate = makeBulkFlow(source, 'bulk');
  assert.deepEqual(baseline.inputs, candidate.inputs);
  const train = candidate.tasks[1].tasks[0].tasks[0].container;
  assert.equal(train.version, 'par04-bulk-v1');
  assert.deepEqual(train.command, ['python', '/app/bulk_app.py', 'train']);
  train.version = baseline.tasks[1].tasks[0].tasks[0].container.version;
  train.command = baseline.tasks[1].tasks[0].tasks[0].container.command;
  assert.deepEqual(candidate.tasks, baseline.tasks);
  assert.deepEqual(candidate.outputs, baseline.outputs);
  assert.throws(() => makeBulkFlow(source, 'unknown'));
});
