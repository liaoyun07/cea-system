import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applicationDraft,
  parameterContract,
  requestBody,
  deploymentBody,
  newDraft,
  itemPath,
  offloadingTarget,
  inferenceLatency,
  measurementStatus,
  applicationParameterTypes,
} from '../../src/management/catalogs.js';

test('offloading target distinguishes a layer decision from an allocated location', () => {
  assert.equal(offloadingTarget({ kind: 'CLOUD', id: null }), 'CLOUD / 未分配');
  assert.equal(offloadingTarget({ kind: 'EDGE', id: 'edge-a' }), 'EDGE / edge-a');
  assert.equal(offloadingTarget(null), '—');
});
test('DQN inference latency has an explicit missing and non-model state', () => {
  assert.equal(inferenceLatency({ strategy: 'DQN', inferenceMs: 0.05325 }), '0.053 ms');
  assert.equal(inferenceLatency({ strategy: 'DQN', inferenceMs: null }), '未采集');
  assert.equal(inferenceLatency({ strategy: 'RULE', inferenceMs: null }), '不适用');
});
test('offloading measurement distinguishes calibration, missing feedback, next decision and complete sample', () => {
  assert.equal(measurementStatus(null), '未采集六维状态');
  assert.equal(measurementStatus({ unavailable: 'transfer calibration incomplete' }), '待传输标定');
  assert.equal(measurementStatus({}), '待终端反馈');
  assert.equal(measurementStatus({ feedbackOutcome: 'SUCCESS' }), '待下一决策');
  assert.equal(measurementStatus({ feedbackOutcome: 'UNMEASURED' }), '缺少原始计时');
  assert.equal(
    measurementStatus({ feedbackOutcome: 'SUCCESS', nextState: [1, 0, 0, 0, 1, 1], trainable: true }),
    '样本完整',
  );
});

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

test('all seven application types roundtrip and structured values stay JSON, not strings', () => {
  assert.deepEqual(applicationParameterTypes, [
    'STRING',
    'INTEGER',
    'NUMBER',
    'BOOLEAN',
    'OBJECT',
    'ARRAY',
    'SELECT',
  ]);
  const parameters = {
    CONFIG: {
      type: 'OBJECT',
      required: true,
      defaultValue: { label: '中文 "quoted"', flags: [true, null, 1] },
    },
    ITEMS: { type: 'ARRAY', required: false, defaultValue: [1, { nested: false }, null] },
    MODEL: { type: 'SELECT', required: true, defaultValue: 'mlp', choices: ['mlp', 'cnn'] },
  };
  assert.deepEqual(parameterContract(applicationDraft({ parameters }).parameterRows), parameters);
});

test('SELECT requires string choices and an allowed default; JSON shape matches its type', () => {
  const p = {
    name: 'MODEL',
    type: 'SELECT',
    defaultJson: '',
    choicesJson: '',
    required: false,
    dataset: false,
  };
  for (const choicesJson of ['', '[]', '[" "]', '["a", "a"]', '[1]'])
    assert.throws(() => parameterContract([{ ...p, choicesJson }]), /SELECT/);
  assert.throws(() => parameterContract([{ ...p, choicesJson: '["a"]', defaultJson: '"b"' }]), /默认值/);
  assert.throws(() => parameterContract([{ ...p, type: 'OBJECT', defaultJson: '"{}"' }]), /OBJECT/);
  assert.throws(() => parameterContract([{ ...p, type: 'ARRAY', defaultJson: '{}' }]), /ARRAY/);
  assert.throws(() => parameterContract([{ ...p, dataset: true }]), /STRING/);
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
    parameters: [
      { name: 'N', type: 'INTEGER', provided: true, value: '0' },
      { name: 'FLAG', type: 'BOOLEAN', provided: true, value: 'false' },
    ],
    command: '["/bin/sh", "-c", "sleep 60"]',
    customCommand: true,
  };
  assert.deepEqual(deploymentBody(draft), {
    applicationId: 'server',
    version: 'v1',
    replicas: 0,
    parameters: { N: 0, FLAG: false },
    command: ['/bin/sh', '-c', 'sleep 60'],
    readiness: null,
  });
  assert.equal(Object.hasOwn(deploymentBody(draft), 'resourceVersion'), false);
  assert.throws(() => deploymentBody({ ...draft, command: '[1]' }), /字符串/);
  assert.throws(
    () =>
      deploymentBody({
        ...draft,
        parameters: [{ name: 'object', type: 'OBJECT', provided: true, value: '[]' }],
      }),
    /类型/,
  );
});
