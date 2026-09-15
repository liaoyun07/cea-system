import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, stringify } from '../frontend/node_modules/yaml/dist/index.js';
import { upgradeFlow, upgradeContract } from './upgrade-federated-datasets.mjs';
for (const algorithm of ['fedavg', 'fedprox']) test(`${algorithm} update preserves task chain and settings`, () => {
  const old = parse(readFileSync(new URL(`../examples/federated/${algorithm}.yaml`, import.meta.url), 'utf8'));
  old.labels = { owner: 'preserve-me' };
  old.inputs.rounds.defaultValue = 5;
  old.inputs.training_dataset.values = ['mnist-train/v1'];
  old.inputs.test_dataset.values = ['mnist-test/v1'];
  delete old.tasks[0].container.parameters.TRAINING_DATASET;
  delete old.tasks[0].container.parameters.TEST_DATASET;
  old.tasks[0].container.parameters.DATASET_NAME = { source: 'LITERAL', value: 'mnist' };
  const updated = parse(upgradeFlow(stringify(old)));
  assert.deepEqual(updated.labels, old.labels);
  assert.equal(updated.inputs.rounds.defaultValue, 5);
  assert.equal(updated.inputs.training_dataset.values.length, 3);
  assert.equal(updated.inputs.test_dataset.values.length, 3);
  assert.deepEqual(updated.outputs, old.outputs);
  assert.deepEqual(updated.tasks[1].repeat, old.tasks[1].repeat);
  assert.deepEqual(updated.tasks[1].tasks[0].loop, old.tasks[1].tasks[0].loop);
  assert.equal(updated.tasks[0].container.parameters.TRAINING_DATASET.name, 'training_dataset');
  assert.equal(updated.tasks[0].container.parameters.TEST_DATASET.name, 'test_dataset');
  assert.equal(updated.tasks[0].container.parameters.DATASET_NAME, undefined);
  assert.deepEqual(parse(upgradeFlow(stringify(updated))), updated);
});
test('contract updates preserve unrelated parameters and do not download data for init', () => {
  for (const id of ['fl-init', 'fedavg-train', 'fedprox-train', 'fl-aggregate', 'fl-evaluate']) {
    const previous = JSON.parse(readFileSync(new URL(`../examples/federated/contracts/${id}.json`, import.meta.url)));
    if (id === 'fl-init') {
      delete previous.parameters.TRAINING_DATASET;
      delete previous.parameters.TEST_DATASET;
      previous.parameters.DATASET_NAME = { type: 'STRING', required: true, defaultValue: 'mnist' };
    } else for (const name of ['DATASET', 'TEST_DATASET']) {
      if (previous.parameters[name]) previous.parameters[name].dataset.allowed = previous.parameters[name].dataset.allowed.slice(0, 1);
    }
    const next = upgradeContract(previous, 'registry:5000/federated:new');
    assert.equal(previous.version, 'v1');
    if (id === 'fl-init') {
      assert.deepEqual(next.parameters.MODEL, previous.parameters.MODEL);
      assert.equal(next.parameters.TRAINING_DATASET.dataset, undefined);
      assert.equal(next.parameters.TEST_DATASET.dataset, undefined);
      assert.equal(next.parameters.TEST_DATASET.choices.length, 3);
      assert.equal(next.parameters.DATASET_NAME, undefined);
      assert.equal(previous.parameters.DATASET_NAME.defaultValue, 'mnist');
    } else for (const name of ['DATASET', 'TEST_DATASET']) {
      if (next.parameters[name]) assert.equal(next.parameters[name].dataset.allowed.length, 3);
    }
  }
});
