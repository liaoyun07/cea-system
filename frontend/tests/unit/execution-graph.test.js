import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { topology, taskInstance, iterations, duration, childGroups } from '../../src/execution-graph.js';

test('DAG uses dependencies, not definition order; parallel has no invented edges', () => {
  const tasks = [{ id: 'join', dependsOn: ['a', 'b'] }, { id: 'b' }, { id: 'a' }];
  const graph = topology(tasks, 'core.Dag');
  assert.deepEqual(
    graph.edges.map(({ from, to }) => [from, to]),
    [
      ['a', 'join'],
      ['b', 'join'],
    ],
  );
  assert.ok(graph.nodes[0].x > graph.nodes[1].x);
  assert.equal(topology(tasks, 'core.Parallel').edges.length, 0);
  assert.deepEqual(
    topology(tasks).edges.map(({ from, to }) => [from, to]),
    [
      ['join', 'b'],
      ['b', 'a'],
    ],
  );
});
test('invalid topology is not silently drawn as a valid graph', () => {
  assert.throws(() => topology([{ id: 'a', dependsOn: ['b'] }], 'core.Dag'), /依赖/);
  assert.throws(() => topology([{ id: 'a', dependsOn: ['a'] }], 'core.Dag'), /有环/);
  assert.throws(() => topology([{ id: 'a' }, { id: 'a' }]), /重复/);
  assert.equal(topology([]).nodes.length, 0);
});
test('nested rounds and items select exact TaskRun, including retry/failure/cancel state', () => {
  const runs = [
    { id: 'loop-r1', taskId: 'clients', parentTaskRunId: 'rounds', iteration: 1 },
    { id: 'loop-r2', taskId: 'clients', parentTaskRunId: 'rounds', iteration: 2 },
    ...['loop-r1', 'loop-r2'].flatMap((parentTaskRunId, round) =>
      [1, 2].map((iteration) => ({
        id: `${parentTaskRunId}-${iteration}`,
        taskId: 'train',
        parentTaskRunId,
        iteration,
        state: round ? 'KILLED' : iteration === 1 ? 'RETRYING' : 'FAILED',
        outputs: { value: 0, flag: false },
      })),
    ),
  ];
  assert.equal(taskInstance(runs, 'clients', 'rounds', 2).id, 'loop-r2');
  assert.equal(taskInstance(runs, 'train', 'loop-r1', 2).state, 'FAILED');
  assert.equal(taskInstance(runs, 'train', 'loop-r2', 2).state, 'KILLED');
  assert.equal(taskInstance(runs, 'train', 'loop-r1', 1).state, 'RETRYING');
  assert.deepEqual(taskInstance(runs, 'train', 'loop-r1', 1).outputs, { value: 0, flag: false });
  assert.equal(taskInstance(runs, 'train', 'loop-r1', 3), undefined);
  assert.equal(taskInstance(runs, 'train'), undefined);
  assert.deepEqual(iterations(runs, 'loop-r2'), [1, 2]);
});
test('If branches are separate groups; timestamps do not invent running duration', () => {
  assert.deepEqual(childGroups({ type: 'core.If', then: [{}], else: [{}] }), ['then', 'else']);
  assert.equal(duration('2026-09-12T00:00:00Z', '2026-09-12T00:00:01.500Z'), '1.50 s');
  assert.equal(duration('2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z'), '0.00 s');
  assert.equal(duration('invalid', 'invalid'), '—');
  assert.equal(duration('2026-09-12T00:00:00Z', null), '—');
  assert.equal(duration('2026-09-12T00:00:01Z', '2026-09-12T00:00:00Z'), '—');
});
test('FedAvg/FedProx explicitly declare dataset SELECT options without clients input', () => {
  for (const name of ['fedavg', 'fedprox']) {
    const flow = parse(
      readFileSync(new URL(`../../../examples/federated/${name}.yaml`, import.meta.url), 'utf8'),
    );
    for (const [key, dataset] of [
      ['training_dataset', 'mnist-train/v1'],
      ['test_dataset', 'mnist-test/v1'],
    ]) {
      assert.deepEqual(flow.inputs[key], { type: 'SELECT', values: [dataset], defaultValue: dataset });
    }
    assert.equal(flow.inputs.clients, undefined);
  }
});
