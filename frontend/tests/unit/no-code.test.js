import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  readDocument,
  changeSource,
  addTask,
  moveTask,
  removeTask,
  taskEntries,
  bindingScope,
  outputPorts,
  readCatalog,
  parseJsonValue,
} from '../../src/no-code/document.js';

const source =
  '# keep header\nschemaVersion: 1\nnamespace: lab\nid: edit\nlabels: {owner: lab} # retain\ninputs:\n  n: {type: INTEGER, defaultValue: 0}\ntasks:\n  - id: first\n    type: core.Log\n    message: first # keep message comment\n  - id: second\n    type: core.Log\n    message: second\noutputs:\n  result: {source: TASK_OUTPUT, taskId: second, port: message}\n';
test('field edits retain non-edited fields and comments, including false/0/empty', () => {
  let next = changeSource(source, ['tasks', 0, 'message'], 'changed');
  next = changeSource(next, ['inputs', 'n', 'required'], false);
  next = changeSource(next, ['description'], '');
  assert.match(next, /# keep header/);
  assert.match(next, /# keep message comment/);
  assert.match(next, /# retain/);
  const value = readDocument(next).value;
  assert.equal(value.inputs.n.defaultValue, 0);
  assert.equal(value.inputs.n.required, false);
  assert.equal(value.description, '');
  assert.deepEqual(value.outputs, readDocument(source).value.outputs);
});
test('unknown fields are not discarded by unrelated edits', () => {
  const next = changeSource(source + 'futureField: {nested: [1, false, text]}\n', ['description'], 'changed');
  assert.deepEqual(readDocument(next).value.futureField, { nested: [1, false, 'text'] });
});
test('invalid or ambiguous YAML blocks mutations without replacing original source', () => {
  for (const text of [
    'tasks: [',
    'id: a\nid: b',
    'id: a\n---\nid: b',
    'id: a\nn: 9223372036854775807',
    'id: a\nx: &ref [1]\ny: *ref',
    'id: a\ninputs: bad',
    'id: a\ntasks: [{id: t, type: core.Log, dependsOn: bad}]',
    'id: a\ntasks: [{id: t, type: platform.Application, container: {outputFiles: 1}}]',
  ])
    assert.throws(() => changeSource(text, ['description'], 'no'));
});
test('task add, ordered moves and unique ids', () => {
  const added = addTask(source, ['tasks'], 'core.Sleep', 'wait');
  assert.throws(() => addTask(added, ['tasks'], 'core.Log', 'first'), /已存在/);
  assert.deepEqual(
    readDocument(moveTask(added, ['tasks', 2], ['tasks'], 0)).value.tasks.map((t) => t.id),
    ['wait', 'first', 'second'],
  );
  assert.deepEqual(
    readDocument(moveTask(added, ['tasks', 0], ['tasks'], 1)).value.tasks.map((t) => t.id),
    ['second', 'first', 'wait'],
  );
});
test('remove protects references and only deletes selected draft subtree', () => {
  assert.throws(() => removeTask(source, ['tasks', 1]), /仍被引用/);
  assert.equal(readDocument(removeTask(source, ['tasks', 0])).value.tasks.length, 1);
});
test('move prevents own-descendant nesting and retains AST comments', () => {
  const next = addTask(source, ['tasks'], 'core.Sequential', 'group');
  assert.throws(() => moveTask(next, ['tasks', 2], ['tasks', 2, 'tasks']), /自身/);
  const moved = moveTask(next, ['tasks', 0], ['tasks', 2, 'tasks']);
  assert.equal(readDocument(moved).value.tasks[1].tasks[0].id, 'first');
  assert.match(moved, /keep message comment/);
});
test('move can create an absent optional lifecycle group', () => {
  assert.equal(
    readDocument(addTask(source, ['finally'], 'core.Log', 'cleanup')).value.finally[0].id,
    'cleanup',
  );
  const value = readDocument(moveTask(source, ['tasks', 0], ['errors'])).value;
  assert.equal(value.errors[0].id, 'first');
  assert.equal(value.tasks[0].id, 'second');
});
test('JSON values cannot silently round unsafe integers, including nested values', () => {
  assert.throws(() => parseJsonValue('{"items":[9007199254740993]}'), /安全精度/);
  assert.throws(() => parseJsonValue('1e400'), /安全精度/);
  assert.deepEqual(parseJsonValue('{"zero":0,"flag":false,"text":""}'), { zero: 0, flag: false, text: '' });
});
test('DAG options follow dependencies, not definition order; no If branch leakage', () => {
  const flow = {
    tasks: [
      {
        id: 'dag',
        type: 'core.Dag',
        tasks: [
          { id: 'consume', type: 'core.Log', dependsOn: ['produce'] },
          { id: 'produce', type: 'core.Log' },
        ],
      },
      { id: 'branch', type: 'core.If', then: [{ id: 'yes', type: 'core.Log' }], else: [] },
      { id: 'end', type: 'core.Log' },
    ],
  };
  assert.deepEqual(
    bindingScope(flow, ['tasks', 0, 'tasks', 0, 'message']).entries.map((e) => e.task.id),
    ['produce'],
  );
  assert(!bindingScope(flow, ['tasks', 2, 'message']).entries.some((e) => e.task.id === 'yes'));
});
test('parallel siblings are not upstream options', () => {
  const flow = {
    tasks: [
      {
        id: 'both',
        type: 'core.Parallel',
        tasks: [
          { id: 'a', type: 'core.Log' },
          { id: 'b', type: 'core.Log' },
        ],
      },
    ],
  };
  assert.equal(bindingScope(flow, ['tasks', 0, 'tasks', 1, 'message']).entries.length, 0);
});
test('lifecycle options inherit prior phases, and final outputs follow main-tree visibility', () => {
  const flow = {
    tasks: [
      { id: 'main', type: 'core.Log' },
      { id: 'if', type: 'core.If', then: [{ id: 'yes', type: 'core.Log' }] },
    ],
    errors: [{ id: 'error', type: 'core.Log' }],
    finally: [{ id: 'cleanup', type: 'core.Log' }],
    afterExecution: [{ id: 'post', type: 'core.Log' }],
  };
  const ids = (path) => bindingScope(flow, path).entries.map((e) => e.task.id);
  assert.deepEqual(ids(['errors', 0, 'http', 'body']), ['main', 'if']);
  assert.deepEqual(ids(['finally', 0, 'http', 'body']), ['main', 'if', 'error']);
  assert.deepEqual(ids(['afterExecution', 0, 'http', 'body']), ['main', 'if', 'error', 'cleanup']);
  assert.deepEqual(ids(['outputs', 'result']), ['main', 'if', 'yes']);
});
for (const algorithm of ['fedavg', 'fedprox']) {
  const yaml = readFileSync(
    new URL(`../../../examples/federated/${algorithm}.yaml`, import.meta.url),
    'utf8',
  );
  test(`${algorithm}: no-code edits preserve all real bindings and Loop/Repeat structure`, () => {
    const original = readDocument(yaml).value;
    const next = readDocument(changeSource(yaml, ['description'], 'edited')).value;
    assert.deepEqual(next.tasks, original.tasks);
    assert.deepEqual(next.inputs, original.inputs);
    assert.deepEqual(next.outputs, original.outputs);
    const list = taskEntries(next),
      train = list.find(
        (e) => e.task.type === 'platform.Application' && e.task.container.applicationId.includes('train'),
      );
    assert(train);
    assert.equal(bindingScope(next, [...train.path, 'container', 'parameters', 'DATASET']).item, true);
    const loop = list.find((e) => e.task.loop);
    assert(!bindingScope(next, ['outputs', 'result']).entries.some((e) => e.task.id === train.task.id));
    assert(outputPorts(loop.task).length > 0);
    assert(
      bindingScope(next, [...loop.path, 'loop', 'outputs', 'models']).entries.some(
        (e) => e.task.id === train.task.id,
      ),
    );
  });
}
test('catalog reads all pages, not only first 20/100', async () => {
  const paths = [];
  const rows = await readCatalog(async (path) => {
    paths.push(path);
    return paths.length === 1 ? Array.from({ length: 100 }, (_, i) => i) : [100];
  }, '/applications');
  assert.equal(rows.length, 101);
  assert.match(paths[1], /offset=100/);
});
