import fs from 'node:fs';
import {parse} from '../../../frontend/node_modules/yaml/dist/index.js';

const root = new URL('../', import.meta.url);
export const version = 'v1';
const training = ['mnist-train/v1', 'mnist-train/equal-noniid-v1', 'mnist-train/strong-noniid-v1',
  'cifar10-train/v1', 'cifar10-train/equal-noniid-v1', 'cifar10-train/strong-noniid-v1', 'cifar100-train/v1'];
const tests = ['mnist-test/v1', 'cifar10-test/v1', 'cifar100-test/v1'];
export const defaults = {phi: .001, rho_0: .05, rho_1: .05, hsam_alpha: .5, hsam_beta: .5, hsam_gamma: 1};

export function canonicalContract(contract) {
  const value = structuredClone(contract);
  for (const parameter of Object.values(value.parameters)) {
    if (parameter.dataset) parameter.dataset.allowed.sort((a, b) =>
      `${a.datasetId}/${a.version}`.localeCompare(`${b.datasetId}/${b.version}`, 'en'));
  }
  return value;
}

function parameter(type, defaultValue = null, choices = []) {
  return {type, required: true, defaultValue, choices, dataset: null};
}

export function contracts(image) {
  const dataset = values => ({...parameter('STRING', values[0]), dataset: {format: 'pt',
    allowed: values.map(ref => {const [datasetId, version] = ref.split('/'); return {datasetId, version};})}});
  const parameters = {
    init: {MODEL: parameter('STRING', 'mlp', ['mlp', 'cnn', 'lenet']),
      CLIENTS: parameter('ARRAY'), SEED: parameter('INTEGER', 31),
      TRAINING_DATASET: parameter('STRING', 'mnist-train/strong-noniid-v1', training),
      TEST_DATASET: parameter('STRING', 'mnist-test/v1', tests)},
    train: {CLIENT_ID: parameter('STRING'), DATASET: dataset(training),
      LOCAL_EPOCHS: parameter('INTEGER', 1), BATCH_SIZE: parameter('INTEGER', 128),
      LEARNING_RATE: parameter('NUMBER', .1), SEED: parameter('INTEGER', 31),
      ...Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key.toUpperCase(), parameter('NUMBER', value)]))},
    aggregate: {RHO_0: parameter('NUMBER', defaults.rho_0)},
    evaluate: {TEST_DATASET: dataset(tests), BATCH_SIZE: parameter('INTEGER', 128)},
  };
  return Object.entries(parameters).map(([stage, parameters]) => ({
    applicationId: `gfed-hsam-${stage}`, version, image, parameters,
  }));
}

export function definition(namespace = 'lab') {
  // Reuse the existing Repeat/Loop/file-binding structure, not a new executor.
  const flow = parse(fs.readFileSync(new URL('mnist-partitions/strong-fedcads.yaml', root), 'utf8'));
  flow.namespace = namespace;
  flow.id = 'gfed-hsam';
  flow.description = 'GFed-HSAM core: cloud initialization, all configured edge clients train with HSAM, dynamic state correction and global evaluation; platform datasets/epochs';
  flow.inputs.rounds.defaultValue = 2;
  flow.inputs.model = {type: 'SELECT', values: ['mlp', 'cnn', 'lenet'], defaultValue: 'mlp'};
  flow.inputs.training_dataset.values = training;
  flow.inputs.test_dataset.values = tests;
  delete flow.inputs.alpha;
  delete flow.inputs.rho;
  flow.inputs.clients.defaultValue = ['edge-a', 'edge-b', 'edge-c'].map(id => ({id, clusters: [id]}));
  for (const [name, value] of Object.entries(defaults)) flow.inputs[name] = {type: 'NUMBER', defaultValue: value};
  const init = flow.tasks[0], repeat = flow.tasks[1];
  const train = repeat.tasks[0].tasks[0], aggregate = repeat.tasks[1], evaluate = repeat.tasks[2];
  for (const task of [init, train, aggregate, evaluate]) {
    task.container.applicationId = `gfed-hsam-${task.id}`;
    task.container.version = version;
    task.timeout = 'PT30M';
    task.container.command[1] = '/app/gfed_hsam_app.py';
    delete task.container.namespaceFiles;
    delete task.container.parameters.ALGORITHM;
  }
  delete init.container.parameters.ROUNDS;
  delete train.container.parameters.ALPHA;
  delete aggregate.container.parameters.RHO;
  for (const name of Object.keys(defaults)) train.container.parameters[name.toUpperCase()] = {source: 'INPUT', name};
  aggregate.container.parameters.RHO_0 = {source: 'INPUT', name: 'rho_0'};
  return flow;
}
