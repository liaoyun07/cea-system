import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applicationDraft,
  parameterContract,
  requestBody,
  deploymentBody,
  newDraft,
  itemPath,
} from '../../src/management/catalogs.js';

test('application form roundtrip retains defaults, constraints and explicit dataset rules', () => {
  const app = {
    applicationId: 'train',
    version: 'v1',
    image: 'registry/train:v1',
    parameters: {
      ZERO: { type: 'INTEGER', required: true, defaultValue: 0, choices: [0, 1] },
      FLAG: { type: 'BOOLEAN', required: false, defaultValue: false },
      EMPTY: { type: 'STRING', required: false, defaultValue: '' },
      DATASET: {
        type: 'STRING',
        required: true,
        dataset: { format: 'pt', allowed: [{ datasetId: 'mnist', version: 'v1' }] },
      },
    },
  };
  assert.deepEqual(requestBody('applications', applicationDraft(app)), app);
  assert.equal(Object.hasOwn(requestBody('applications', applicationDraft(app)), 'inputs'), false);
});
test('parameter draft rejects duplicate names, malformed JSON and unsafe integer precision', () => {
  const p = { name: 'X', type: 'INTEGER', defaultJson: '', choicesJson: '', required: false, dataset: false };
  assert.throws(() => parameterContract([p, p]), /重复/);
  assert.throws(() => parameterContract([{ ...p, defaultJson: 'NaN' }]));
  assert.throws(() => parameterContract([{ ...p, defaultJson: '9007199254740993' }]));
  assert.throws(() => parameterContract([{ ...p, choicesJson: '{}' }]), /数组/);
});
test('gateway and terminal writes do not echo readonly server fields or change identity ownership', () => {
  assert.deepEqual(
    requestBody('gateways', { id: 'g', clusterId: 'e', principal: 'p', enabled: false, lastSeenAt: 'now' }),
    { clusterId: 'e', principal: 'p', enabled: false },
  );
  assert.deepEqual(requestBody('terminals', { id: 't', gatewayId: 'g', enabled: true, lastSeenAt: 'now' }), {
    gatewayId: 'g',
    enabled: true,
  });
});
test('policy request preserves source and read revision; never invents a second flow model', () => {
  const draft = {
    id: 'p',
    source: '# keep\nschemaVersion: 1\n',
    expectedRevision: 7,
    enabled: false,
    eventType: 'sensor',
    clusterId: 'edge',
  };
  assert.deepEqual(requestBody('policies', draft), {
    source: draft.source,
    expectedRevision: 7,
    enabled: false,
    eventType: 'sensor',
    clusterId: 'edge',
  });
  assert.equal(itemPath('policies', draft), '/edge/policies/p');
  assert.equal(newDraft('policies', 'lab').expectedRevision, 0);
});
test('immutable catalog addresses include the exact version', () => {
  assert.equal(
    itemPath('applications', { applicationId: 'train', version: 'v2' }),
    '/applications/train/versions/v2',
  );
  assert.equal(
    itemPath('datasets', { datasetId: 'test', version: 'v1' }),
    '/resources/datasets/test/versions/v1',
  );
});
test('deployment create is an explicit full request, not a guessed scale update', () => {
  const draft = {
    application: 'server/v1',
    replicas: 0,
    parameters: '{"N":0,"FLAG":false}',
    command: '["/bin/sh", "-c", "sleep 60"]',
  };
  assert.deepEqual(deploymentBody(draft), {
    applicationId: 'server',
    version: 'v1',
    replicas: 0,
    parameters: { N: 0, FLAG: false },
    command: ['/bin/sh', '-c', 'sleep 60'],
  });
  assert.equal(Object.hasOwn(deploymentBody(draft), 'resourceVersion'), false);
  assert.throws(() => deploymentBody({ ...draft, command: '[1]' }), /字符串/);
  assert.throws(() => deploymentBody({ ...draft, parameters: '[]' }), /对象/);
});
