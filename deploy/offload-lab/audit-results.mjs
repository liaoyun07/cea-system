// Read-only audit of paired records and removal of this batch's temporary artifacts.
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { folder, read, docker } from './setup.mjs';
const views = { LOCAL: read(`${folder}/local-result.json`), RANDOM: read(`${folder}/random-result.json`) };
const average = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const audit = {};
for (const [strategy, view] of Object.entries(views)) {
  assert.equal(view.run.cleanup, 'DONE');
  assert(view.tasks.every(t => t.state === 'SUCCESS'));
  const groups = {};
  for (const size of ['small', 'medium', 'large']) for (const destination of ['TERMINAL', 'EDGE', 'CLOUD']) {
    const tasks = view.tasks.filter(t => t.size === size && t.destination === destination);
    if (!tasks.length) continue;
    const field = (a, b) => average(tasks.filter(t => t[a] != null && t[b] != null).map(t => t[b] - t[a]));
    groups[`${size}/${destination}`] = { count: tasks.length, meanSeconds: field('requestedAt', 'finishedAt'),
      queueSeconds: field('readyAt', 'dispatchedAt'), uploadWaitSeconds: field('decidedAt', 'uploadStartedAt'),
      uploadSeconds: field('uploadStartedAt', 'uploadFinishedAt'),
      computeSeconds: average(tasks.map(t => t.result.measurement.computeFinishedAt - t.result.measurement.computeStartedAt)) };
  }
  const artifacts = {};
  for (const cluster of ['cloud', 'edge-a', 'edge-b', 'edge-c']) {
    const jobs = JSON.parse(docker(['exec', `cea-${cluster}-1`, 'kubectl', '-n', 'cea-offload-lab', 'get', 'jobs', '-l', `cea.offload-run=${view.run.id}`, '-o', 'json'])).items;
    assert.equal(jobs.length, 0, 'Job remains after cleanup');
    const code = `import json; from minio import Minio; c=json.load(open('/run/secrets/config.json'))['storage']; m=Minio(c['endpoint'],access_key=c['accessKey'],secret_key=c['secretKey'],secure=False,region='us-east-1'); print(sum(1 for _ in m.list_objects(c['bucket'],prefix='lab/offload-lab/${view.run.id}/',recursive=True)))`;
    const objects = Number(docker(['exec', `cea-offlab-${cluster}`, 'python', '-B', '-c', code]));
    assert.equal(objects, 0, 'task object remains after cleanup');
    artifacts[cluster] = { jobs: jobs.length, objects };
  }
  const containers = docker(['exec', 'cea-terminal-load-engine', 'docker', 'ps', '-aq', '--filter', `label=cea.offload-run=${view.run.id}`]).trim();
  assert.equal(containers, '', 'task container remains after cleanup');
  const folders = docker(['exec', 'cea-terminal-load-engine', 'find', '/sim/offload-lab/work', '-mindepth', '2', '-maxdepth', '2', '-type', 'd', '-name', view.run.id]).trim();
  assert.equal(folders, '', 'local output folder remains after cleanup');
  audit[strategy] = { id: view.run.id, summary: view.summary, groups, artifacts,
    terminals: new Set(view.tasks.map(t => t.terminal)).size, sizes: Object.fromEntries(['small', 'medium', 'large'].map(s => [s, view.tasks.filter(t => t.size === s).length])),
    sampledTerminals: new Set(view.samples.map(s => s.terminal)).size };
}
writeFileSync(`${folder}/result-audit.json`, JSON.stringify(audit, null, 2));
console.log(JSON.stringify(audit, null, 2));
