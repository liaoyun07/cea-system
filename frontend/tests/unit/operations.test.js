import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deploymentBody, deploymentDraft } from '../../src/management/catalogs.js';
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
  };
  const draft = deploymentDraft('web', value);
  assert.deepEqual(deploymentBody(draft), value);
  draft.readinessEnabled = false;
  assert.equal(deploymentBody(draft).readiness, null);
  assert.equal(deploymentBody(draft).resourceVersion, '27');
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
