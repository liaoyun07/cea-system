import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../../../frontend/node_modules/yaml/dist/index.js';
import { makeFlow, intervals } from './run.mjs';

test('three and six client experiment definitions preserve mathematical and file chain', () => {
  for (const algorithm of ['fedavg', 'fedprox']) for (const dataset of ['cifar10', 'cifar100']) {
    const source = readFileSync(new URL(`../${algorithm}.yaml`, import.meta.url), 'utf8');
    const original = parse(source);
    for (const [clients, concurrency] of [[3, 3], [6, 3], [6, 6]]) {
      const flow = makeFlow(source, algorithm, dataset, clients, concurrency);
      const loop = flow.tasks[1].tasks[0], train = loop.tasks[0].container;
      assert.equal(loop.loop.values.value.length, clients);
      assert.equal(new Set(loop.loop.values.value.map(item => item.id)).size, clients);
      assert.equal(loop.loop.concurrency, concurrency);
      assert.deepEqual(flow.tasks[1].repeat, original.tasks[1].repeat);
      assert.deepEqual(flow.tasks[1].tasks.slice(1), original.tasks[1].tasks.slice(1));
      assert.deepEqual(flow.tasks[0], original.tasks[0]);
      assert.equal(train.parameters.DATASET.source, clients === 3 ? 'INPUT' : 'ITEM');
      for (const letter of 'abc') assert.equal(loop.loop.values.value.filter(item => item.clusters[0] === `edge-${letter}`).length, clients / 3);
    }
  }
});
test('interval evidence uses union and actual peak, including touching boundaries', () => {
  const report = (start, end) => ({ startedAt: `2026-09-15T00:00:0${start}Z`, endedAt: `2026-09-15T00:00:0${end}Z` });
  assert.deepEqual(intervals([report(1, 4), report(2, 6), report(7, 9)]), { activeSeconds: 7, peak: 2, meanParallel: 9 / 7 });
  assert.equal(intervals([report(1, 2), report(2, 3)]).peak, 1);
});
