import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFields, inputValues, mergeLogs, submission, terminal } from '../../src/model.js';
import { basicAuthorization, createApi, ApiError, errorText } from '../../src/api.js';

test('defaults preserve false, zero, empty strings, objects and omitted values', () => {
  const fields = makeFields({
    zero: { type: 'INTEGER', defaultValue: 0 },
    flag: { type: 'BOOLEAN', defaultValue: false },
    empty: { type: 'STRING', defaultValue: '' },
    object: { type: 'OBJECT', defaultValue: { k: 1 } },
    absent: { type: 'STRING', required: true },
  });
  assert.deepEqual(inputValues(fields), { zero: 0, flag: false, empty: '', object: { k: 1 } });
  fields[0].provided = false;
  assert.ok(!('zero' in inputValues(fields)));
});
test('all seven input types round-trip without string coercion', () => {
  const value = inputValues([
    { name: 's', type: 'STRING', value: 'true', provided: true },
    { name: 'choice', type: 'SELECT', values: ['true', '0'], value: 'true', provided: true },
    { name: 'i', type: 'INTEGER', value: '12', provided: true },
    { name: 'n', type: 'NUMBER', value: '1.25', provided: true },
    { name: 'b', type: 'BOOLEAN', value: 'false', provided: true },
    { name: 'a', type: 'ARRAY', value: '[1,"a"]', provided: true },
    { name: 'o', type: 'OBJECT', value: '{"x":1}', provided: true },
  ]);
  assert.deepEqual(value, { s: 'true', choice: 'true', i: 12, n: 1.25, b: false, a: [1, 'a'], o: { x: 1 } });
});
test('SELECT preserves defaults and omission but rejects nonmembers and nonstrings', () => {
  const fields = makeFields({
    region: { type: 'SELECT', values: ['edge-a', 'cloud'], defaultValue: 'cloud' },
  });
  assert.deepEqual(inputValues(fields), { region: 'cloud' });
  fields[0].provided = false;
  assert.deepEqual(inputValues(fields), {});
  fields[0].provided = true;
  for (const value of ['', 'other', 1, ['cloud']]) {
    fields[0].value = value;
    assert.throws(() => inputValues(fields), /请选择/);
  }
  const absent = makeFields({ region: { type: 'SELECT', values: ['edge-a'], required: true } });
  assert.equal(absent[0].provided, false);
  assert.equal(absent[0].value, '');
});
test('wrong type, nonfinite and unsafe integers are rejected', () => {
  for (const [type, value] of [
    ['INTEGER', '1.2'],
    ['INTEGER', '9007199254740992'],
    ['NUMBER', '1e999'],
    ['BOOLEAN', '1'],
    ['ARRAY', '{}'],
    ['OBJECT', 'null'],
    ['OBJECT', '[]'],
    ['NUMBER', ''],
    ['ARRAY', 'broken'],
  ]) {
    assert.throws(() => inputValues([{ name: 'x', type, value, provided: true }]));
  }
});
test('submission pins revision and snapshots edited values', () => {
  const fields = [{ name: 'x', type: 'STRING', value: 'first', provided: true }];
  const request = submission({ flowId: 'hello', revision: 3 }, fields);
  fields[0].value = 'changed';
  assert.deepEqual(request.body, { flowId: 'hello', revision: 3, inputs: { x: 'first' } });
  assert.match(request.key, /^[a-f0-9-]{36}$/);
});
test('logs are sorted, deduplicated and bounded', () => {
  assert.deepEqual(mergeLogs([{ id: 2 }, { id: 1 }], [{ id: 2 }, { id: 4 }, { id: 3 }], 3), [
    { id: 2 },
    { id: 3 },
    { id: 4 },
  ]);
});
test('only backend terminal states stop polling', () => {
  for (const state of ['SUCCESS', 'FAILED', 'KILLED', 'SKIPPED']) assert.equal(terminal(state), true);
  for (const state of ['RUNNING', 'KILLING', 'RETRYING', 'QUEUED', 'CREATED'])
    assert.equal(terminal(state), false);
});
test('Basic encoding supports UTF-8 and rejects colon in username', () => {
  assert.equal(basicAuthorization('alice', 'test'), 'Basic YWxpY2U6dGVzdA==');
  assert.equal(Buffer.from(basicAuthorization('用户', '密码').slice(6), 'base64').toString(), '用户:密码');
  assert.throws(() => basicAuthorization('a:b', 'x'));
});
test('API sends same-origin namespace, JSON, auth and original idempotency key', async () => {
  let captured;
  const api = createApi('lab', 'Basic test', async (...args) => {
    captured = args;
    return new Response('{"executionId":"real"}', { status: 202 });
  });
  assert.deepEqual(await api('/executions', { method: 'POST', body: { flowId: 'f' }, key: 'same-key' }), {
    executionId: 'real',
  });
  assert.equal(captured[0], '/api/namespaces/lab/executions');
  assert.equal(captured[1].headers['Idempotency-Key'], 'same-key');
  assert.equal(captured[1].headers.Authorization, 'Basic test');
  assert.equal(captured[1].credentials, 'omit');
  assert.equal(captured[1].redirect, 'error');
});
test('HTTP errors preserve status/code/message and non-JSON is not success', async () => {
  for (const status of [401, 403, 409, 422, 500]) {
    const api = createApi(
      'lab',
      'Basic test',
      async () => new Response('{"code":"CONFLICT","message":"specific failure"}', { status }),
    );
    await assert.rejects(
      api('/flows'),
      (e) => e instanceof ApiError && e.status === status && errorText(e).includes('specific failure'),
    );
  }
  await assert.rejects(
    createApi('lab', 'x', async () => new Response('<html>proxy</html>'))('/flows'),
    /JSON/,
  );
});
