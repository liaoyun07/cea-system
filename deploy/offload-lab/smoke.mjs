import { existsSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { folder, read } from './setup.mjs';
const token = read(`${folder}/secrets.json`).token;
const call = async (path, body) => {
  const response = await fetch('http://127.0.0.1:18195' + path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  assert(response.ok, `${path}: HTTP ${response.status} ${response.ok ? '' : await response.text()}`);
  return response.json();
};
const devices = await call('/devices');
assert.equal(devices.length, 30);
assert(devices.every(t => t.resource && Date.now() / 1000 - t.resource.sampledAt < 15 && t.resource.cpuCores === .1), '30 live bounded terminal samples required');
const label = process.argv[2] || 'smoke';
assert(/^smoke(?:-\d+)?$/.test(label));
const file = `${folder}/${label}.json`;
let saved = existsSync(file) ? read(file) : null;
if (!saved) {
  writeFileSync(file, JSON.stringify({ intentAt: Date.now() }));
  const run = await call('/runs', { strategy: 'RANDOM', seconds: 5, interval: 20, seed: 820 });
  saved = { id: run.id };
  writeFileSync(file, JSON.stringify(saved));
}
assert(saved.id, 'unknown submission outcome; inspect original experiment');
for (;;) {
  const view = await call('/runs/' + saved.id);
  writeFileSync(`${folder}/${label}-observation.json`, JSON.stringify(view, null, 2));
  console.log(view.run.state, view.summary, view.run.cleanup);
  assert(!['ERROR', 'INTERRUPTED'].includes(view.run.state), view.run.error);
  if (view.run.state === 'FINISHED' && view.run.cleanup === 'DONE') {
    assert.equal(view.summary.completed, 5);
    assert.equal(view.summary.failed, 0);
    assert.deepEqual(new Set(view.tasks.map(t => t.destination)), new Set(['TERMINAL', 'EDGE', 'CLOUD']));
    assert.equal(new Set(view.tasks.filter(t => t.destination === 'EDGE').map(t => t.owner)).size, 3);
    const reference = read(`${folder}/../matrix/files.json`)[0].expected;
    for (const task of view.tasks) for (const [key, value] of Object.entries(reference)) assert(Math.abs(task.result[key] - value) < Math.max(1e-9, Math.abs(value) * 1e-8));
    assert.equal(view.run.cleanupCounts.nodes.reduce((s, n) => s + n.jobs, 0), 4);
    assert.equal(view.run.cleanupCounts.nodes.reduce((s, n) => s + n.objects, 0), 8);
    console.log('PASS: 30 terminals, five real tasks, all destinations, consistent outputs and batch cleanup');
    break;
  }
  await new Promise(resolve => setTimeout(resolve, 3000));
}
