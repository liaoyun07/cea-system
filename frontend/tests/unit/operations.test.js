import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deploymentBody, deploymentDraft, deploymentFields } from '../../src/management/catalogs.js';
import {
  durationText,
  deploymentTarget,
  percentText,
  memoryText,
  coresText,
} from '../../src/management/operations.js';
import { createApi } from '../../src/api.js';

test('deployment edit roundtrip retains resource version, false/zero and readiness removal', () => {
  const value = {
    applicationId: 'http',
    version: 'v1',
    replicas: 2,
    parameters: { N: 0, FLAG: false },
    command: ['server'],
    resourceVersion: '27',
    readiness: { path: '/ready', port: 8080 },
    resources: { cpuRequest: '100m', memoryRequest: '128Mi', cpuLimit: '1', memoryLimit: '256Mi' },
  };
  const draft = deploymentDraft('web', value, { N: { type: 'INTEGER' }, FLAG: { type: 'BOOLEAN' } });
  assert.deepEqual(deploymentBody(draft), value);
  draft.readinessEnabled = false;
  assert.equal(deploymentBody(draft).readiness, null);
  assert.equal(deploymentBody(draft).resourceVersion, '27');
});

test('deployment fields preserve seven types, choices, required, false, zero and explicit empty string', () => {
  const contract = {
    S: { type: 'STRING', defaultValue: '' },
    I: { type: 'INTEGER', defaultValue: 0 },
    N: { type: 'NUMBER', defaultValue: 0.5 },
    B: { type: 'BOOLEAN', defaultValue: false },
    O: { type: 'OBJECT', defaultValue: { a: 1 } },
    A: { type: 'ARRAY', defaultValue: [1] },
    E: { type: 'SELECT', choices: ['a', 'b'], required: true, defaultValue: 'b' },
    OPTIONAL: { type: 'STRING' },
  };
  const draft = {
    application: 'http/v1',
    replicas: 1,
    parameters: deploymentFields(contract),
    command: 'not parsed when default',
    customCommand: false,
  };
  assert.deepEqual(deploymentBody(draft).parameters, {
    S: '',
    I: 0,
    N: 0.5,
    B: false,
    O: { a: 1 },
    A: [1],
    E: 'b',
  });
  assert.deepEqual(deploymentBody(draft).command, []);
  const required = deploymentFields({ choice: { type: 'SELECT', required: true, choices: ['x'] } });
  assert.throws(() => deploymentBody({ ...draft, parameters: required }), /选择/);
  assert.equal(deploymentFields({ new: { type: 'STRING' } }).length, 1);
  assert.deepEqual(
    deploymentBody({ ...draft, parameters: deploymentFields({ new: { type: 'STRING' } }) }).parameters,
    {},
  );
});
test('deployment target excludes scaling, missing measurement and failed operations', () => {
  assert.equal(durationText(null), '—');
  assert.equal(durationText(1234), '1.23 s');
  const record = { operation: 'CREATE', state: 'SUCCEEDED', durationMs: 30000 };
  assert.equal(deploymentTarget(record), '≤ 30 s');
  assert.equal(deploymentTarget({ ...record, durationMs: 30001 }), '> 30 s');
  assert.equal(deploymentTarget({ ...record, operation: 'SCALE' }), '—');
  assert.equal(deploymentTarget({ ...record, durationMs: null }), '—');
  assert.equal(deploymentTarget({ ...record, state: 'FAILED' }), '—');
});
test('resource usage formats actual zero and leaves missing unavailable, no coercion', () => {
  assert.equal(percentText(0), '0.0%');
  assert.equal(percentText(null), '—');
  assert.equal(percentText('0'), '—');
  assert.equal(memoryText(1048576), '1.0 MiB');
  assert.equal(coresText(0.001), '0.001 核');
});
test('upload preserves FormData boundary generation and authorization without JSON wrapping', async () => {
  const form = new FormData();
  form.append('file', new Blob(['image']), 'archive.tar');
  const api = createApi('lab', 'Basic test', async (url, options) => {
    assert.equal(url, '/api/namespaces/lab/applications/a/versions/v1/upload');
    assert.equal(options.body, form);
    assert.equal(options.headers.Authorization, 'Basic test');
    assert.equal(Object.hasOwn(options.headers, 'Content-Type'), false);
    return new Response('{}', { status: 200 });
  });
  await api('/applications/a/versions/v1/upload', { method: 'POST', body: form });
});
