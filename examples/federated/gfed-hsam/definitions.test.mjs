import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parse, stringify} from '../../../frontend/node_modules/yaml/dist/index.js';
import {canonicalContract, contracts, definition} from './definitions.mjs';

test('all four stages bind the exact contracts and use real state feedback', () => {
  const image = 'registry-center:5000/lab/cea-federated:gfed-hsam-v1';
  const flow = parse(stringify(definition()));
  const entries = contracts(image);
  const repeat = flow.tasks[1];
  const stages = [flow.tasks[0], repeat.tasks[0].tasks[0], ...repeat.tasks.slice(1)];
  assert.deepEqual(stages.map(t => t.id), ['init', 'train', 'aggregate', 'evaluate']);
  for (const task of stages) {
    const contract = entries.find(c => c.applicationId === task.container.applicationId);
    assert.deepEqual(Object.keys(task.container.parameters).sort(), Object.keys(contract.parameters).sort());
    assert.equal(task.container.version, contract.version);
    assert.equal(task.container.command[1], '/app/gfed_hsam_app.py');
    assert.equal(task.container.namespaceFiles, undefined);
    for (const binding of Object.values(task.container.parameters)) {
      if (binding.source === 'INPUT') assert(binding.name in flow.inputs);
    }
  }
  assert.equal(repeat.repeat.feedback.global_model.taskId, 'aggregate');
  assert.equal(repeat.tasks[0].loop.values.name, 'clients');
  assert.equal(stages[1].container.inputFiles.global_model.taskId, 'rounds');
  assert.equal(stages[2].container.inputFiles.global_model.taskId, 'rounds');
  assert.equal(stages[2].container.inputFiles.client_models.taskId, 'clients');
  assert.equal(stages[3].container.inputFiles.global_model.taskId, 'aggregate');
  assert.equal(stages[1].container.parameters.RHO_0.name, stages[2].container.parameters.RHO_0.name);
  assert.equal('participation_rate' in flow.inputs, false);
  assert.deepEqual(flow.inputs.clients.defaultValue.map(c => c.id), ['edge-a', 'edge-b', 'edge-c']);
});

test('existing dataset versions selectable; training and global test have separate preparation', () => {
  const flow = definition('demo'), entries = contracts('image');
  assert.equal(flow.namespace, 'demo');
  const training = entries[1].parameters.DATASET.dataset.allowed.map(d => `${d.datasetId}/${d.version}`);
  const tests = entries[3].parameters.TEST_DATASET.dataset.allowed.map(d => `${d.datasetId}/${d.version}`);
  assert.deepEqual(training, flow.inputs.training_dataset.values);
  assert.deepEqual(tests, flow.inputs.test_dataset.values);
  assert(training.includes('mnist-train/strong-noniid-v1'));
  assert(training.includes('cifar10-train/equal-noniid-v1'));
  assert(tests.every(ref => !ref.includes('-train')));
  assert.equal(flow.inputs.local_epochs.defaultValue, 1);
});

test('dataset allow-list is a set on API readback; changing values is not ignored', () => {
  const original = contracts('image')[1], sorted = structuredClone(original);
  sorted.parameters.DATASET.dataset.allowed.reverse();
  assert.deepEqual(canonicalContract(sorted), canonicalContract(original));
  sorted.parameters.DATASET.dataset.allowed.pop();
  assert.notDeepEqual(canonicalContract(sorted), canonicalContract(original));
});
