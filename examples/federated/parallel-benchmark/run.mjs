// FLPAR-01/02/03 experiment driver. Uses existing APIs; does not implement an execution engine.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parse, stringify } from '../../../frontend/node_modules/yaml/dist/index.js';

const root = resolve(import.meta.dirname, '../../..');
const datasets = ['cifar10', 'cifar100'];
const algorithms = ['fedavg', 'fedprox'];
const letters = ['a', 'b', 'c'];

export function makeFlow(source, algorithm, dataset, clients, concurrency) {
  assert(datasets.includes(dataset) && algorithms.includes(algorithm));
  assert([3, 6].includes(clients) && [3, 6].includes(concurrency) && concurrency <= clients);
  const flow = parse(source);
  flow.id = `par01-${algorithm}-${dataset}-c${clients}-p${concurrency}`;
  flow.description = 'FLPAR-01 fixed-total-data client parallelism comparison';
  flow.labels = { ...flow.labels, benchmark: 'FLPAR-01' };
  for (const [name, split] of [['training_dataset', 'train'], ['test_dataset', 'test']]) {
    flow.inputs[name].values = [`${dataset}-${split}/v1`];
    flow.inputs[name].defaultValue = `${dataset}-${split}/v1`;
  }
  const loop = flow.tasks[1].tasks[0];
  assert.equal(loop.type, 'core.Loop');
  loop.loop.concurrency = concurrency;
  loop.loop.values = { source: 'LITERAL', value: clients === 3
    ? letters.map(letter => ({ id: `edge-${letter}`, clusters: [`edge-${letter}`] }))
    : letters.flatMap(letter => [1, 2].map(part => ({ id: `edge-${letter}${part}`, clusters: [`edge-${letter}`],
      dataset: `${dataset}-par01-part${part}/v1` }))) };
  const train = loop.tasks[0].container;
  train.version = 'par01-v1';
  train.parameters.DATASET = clients === 3 ? { source: 'INPUT', name: 'training_dataset' }
    : { source: 'ITEM', path: ['value', 'dataset'] };
  return flow;
}

// FLPAR-02: every added client reads its cluster's ORIGINAL complete shard.
// More real processing of repeated data, not more unique training examples.
export function makeReplicatedFlow(source, clients) {
  assert([3, 6, 9, 12].includes(clients));
  const flow = parse(source);
  assert.equal(flow.id, 'fedavg');
  flow.id = `par02-fedavg-cifar10-c${clients}-p${clients}`;
  flow.description = 'FLPAR-02 repeated-data load test; 50000 unique source samples, not a larger independent dataset';
  flow.labels = { ...flow.labels, benchmark: 'FLPAR-02' };
  for (const [name, split] of [['training_dataset', 'train'], ['test_dataset', 'test']]) {
    flow.inputs[name].values = [`cifar10-${split}/v1`];
    flow.inputs[name].defaultValue = `cifar10-${split}/v1`;
  }
  const loop = flow.tasks[1].tasks[0];
  assert.equal(loop.type, 'core.Loop');
  loop.loop.concurrency = clients;
  loop.loop.values = { source: 'LITERAL', value: Array.from({ length: clients / 3 }, (_, copy) =>
    letters.map(letter => ({ id: `edge-${letter}${copy + 1}`, clusters: [`edge-${letter}`] }))).flat() };
  assert.deepEqual(loop.tasks[0].container.parameters.DATASET, { source: 'INPUT', name: 'training_dataset' });
  return flow;
}

// FLPAR-03 changes training batch only; evaluation stays at batch 32.
export function makeBatchFlow(source, batchSize) {
  assert([32, 256, 1024, 16384].includes(batchSize));
  const flow = makeReplicatedFlow(source, 9);
  flow.id = `par03-fedavg-cifar10-c9-b${batchSize}`;
  flow.description = 'FLPAR-03 one-round MLP training batch comparison; repeated source data, evaluation batch 32';
  flow.labels.benchmark = 'FLPAR-03';
  flow.inputs.rounds.defaultValue = 1;
  flow.inputs.batch_size.defaultValue = batchSize;
  const evaluation = flow.tasks[1].tasks.find(task => task.id === 'evaluate');
  assert(evaluation);
  evaluation.container.parameters.BATCH_SIZE = { source: 'LITERAL', value: 32 };
  return flow;
}

function nanos(text) {
  const match = /^(.*?)(?:\.(\d+))?Z$/.exec(text);
  assert(match, 'UTC timestamp required');
  return BigInt(Date.parse(match[1] + 'Z')) * 1000000n + BigInt((match[2] || '').padEnd(9, '0'));
}

export function intervals(reports) {
  assert(reports.length);
  const events = reports.flatMap(report => {
    const start = nanos(report.startedAt), end = nanos(report.endedAt);
    assert(end > start);
    return [[start, 1], [end, -1]];
  }).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]);
  let count = 0, peak = 0, last = events[0][0], union = 0n, sum = 0n;
  for (const [time, delta] of events) {
    if (count > 0) union += time - last;
    sum += (time - last) * BigInt(count);
    count += delta; peak = Math.max(peak, count); last = time;
  }
  assert.equal(count, 0);
  return { activeSeconds: Number(union) / 1e9, peak, meanParallel: Number(sum) / Number(union) };
}

async function main() {
  const mode = process.argv[2];
  assert(['--register', '--run', '--preserved'].includes(mode));
  const batchExperiment = process.argv.includes('--batch');
  const replicated = batchExperiment || process.argv.includes('--replicated');
  const folder = resolve(root, `.local/cea/${batchExperiment ? 'par03' : replicated ? 'par02' : 'par01'}`);
  const activeDatasets = replicated ? ['cifar10'] : datasets;
  const activeAlgorithms = replicated ? ['fedavg'] : algorithms;
  await mkdir(folder, { recursive: true });
  const settings = Object.fromEntries((await readFile(resolve(root, 'deploy/cea/.env'), 'utf8')).split(/\r?\n/)
    .filter(line => /^[A-Z_0-9]+=/.test(line)).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  const base = `http://127.0.0.1:${settings.CEA_API_PORT}/api/namespaces/lab`;
  const headers = { Authorization: 'Basic ' + Buffer.from(`${settings.BACKEND_USER}:${settings.BACKEND_PASSWORD}`).toString('base64'), 'Content-Type': 'application/json' };
  async function api(path, method = 'GET', body, extra = {}) {
    const response = await fetch(base + path, { method, headers: { ...headers, ...extra },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status} ${await response.text()}`);
    return response.json();
  }
  const save = (path, value, options = {}) => writeFile(resolve(folder, path), JSON.stringify(value, null, 2), options);
  const services = () => JSON.parse(execFileSync('docker', ['inspect', ...['frontend', 'backend', 'cloud', 'edge-a', 'edge-b', 'edge-c',
    'mysql', 'minio', 'minio-edge-a', 'minio-edge-b', 'minio-edge-c', 'registry-center', 'registry-edge-a', 'registry-edge-b', 'registry-edge-c',
    'edge-gateway', 'terminal-agent', 'terminal-engine', 'builder'].map(name => `cea-${name}-1`)], { encoding: 'utf8' }))
    .map(c => ({ id: c.Id, name: c.Name, image: c.Image, startedAt: c.State.StartedAt, cpus: c.HostConfig.NanoCpus, memory: c.HostConfig.Memory }));
  if (mode === '--register') {
    const originals = await Promise.all(algorithms.map(name => api(`/flows/${name}`)));
    await save('before.json', { originals, datasets: await api('/resources/datasets'), policies: await api('/edge/policies'), services: services() }, { flag: 'wx' });
    if (!replicated) {
      const ready = JSON.parse(await readFile(resolve(folder, 'uploaded.json')));
      assert.equal(ready.length, 12);
      for (const dataset of datasets) {
        const manifest = JSON.parse(await readFile(resolve(folder, dataset, 'manifest.json')));
        assert.equal(manifest.reduce((sum, row) => sum + row.samples, 0), 50000);
        for (const row of manifest) assert.equal(ready.find(r => r.dataset === dataset && r.client === row.client)?.bytes, row.bytes);
        for (const part of [1, 2]) {
          const id = `${dataset}-par01-part${part}`;
          const definition = { datasetId: id, version: 'v1', format: 'pt', locations: letters.map(letter => ({ clusterId: `edge-${letter}`,
            uri: `s3://datasets/par01/${dataset}/edge-${letter}${part}.pt` })) };
          await api(`/resources/datasets/${id}/versions/v1`, 'PUT', definition);
        }
      }
      for (const algorithm of algorithms) {
        const application = await api(`/applications/${algorithm}-train/versions/cf01-v1`);
        application.version = 'par01-v1';
        for (const dataset of datasets) for (const part of [1, 2])
          application.parameters.DATASET.dataset.allowed.push({ datasetId: `${dataset}-par01-part${part}`, version: 'v1' });
        await api(`/applications/${algorithm}-train/versions/par01-v1`, 'PUT', application);
      }
    }
    const cases = [];
    for (const dataset of activeDatasets) for (const algorithm of activeAlgorithms) {
      const variants = batchExperiment ? [32, 256, 1024, 16384].map(batch => [9, 9, batch])
        : replicated ? [[3, 3], [6, 6], [9, 9], [12, 12]] : [[3, 3], [6, 6]];
      if (!replicated && algorithm === 'fedavg' && dataset === 'cifar10') variants.push([6, 3]);
      for (const [clients, concurrency, batchSize] of variants) {
        const original = originals.find(f => f.flowId === algorithm).source;
        const flow = batchExperiment ? makeBatchFlow(original, batchSize)
          : replicated ? makeReplicatedFlow(original, clients) : makeFlow(original, algorithm, dataset, clients, concurrency);
        const source = stringify(flow);
        await api(`/flows/${flow.id}/validate`, 'POST', { source });
        await api(`/flows/${flow.id}/revisions`, 'POST', { expectedRevision: 0, source });
        await writeFile(resolve(folder, `${flow.id}.yaml`), source);
        cases.push({ flowId: flow.id, algorithm, dataset, clients, concurrency, items: flow.tasks[1].tasks[0].loop.values.value,
          ...(replicated ? { workload: 'REPEATED_SOURCE', uniqueTrainSamples: 50000, processedTrainSamplesPerRound: 50000 * clients / 3 } : {}),
          ...(batchExperiment ? { rounds: 1, batchSize, evaluationBatchSize: 32 } : {}) });
      }
    }
    await save('cases.json', cases);
    console.log(`Registered ${cases.length} isolated comparison flows; original workflows untouched.`);
    return;
  }
  if (mode === '--preserved') {
    const before = JSON.parse(await readFile(resolve(folder, 'before.json')));
    for (const original of before.originals) assert.deepEqual(await api(`/flows/${original.flowId}`), original);
    for (const dataset of before.datasets) assert.deepEqual(await api(`/resources/datasets/${dataset.datasetId}/versions/${dataset.version}`), dataset);
    assert.deepEqual(await api('/edge/policies'), before.policies);
    const after = services();
    for (const old of before.services) {
      const current = after.find(row => row.name === old.name);
      assert.deepEqual({ ...current, startedAt: old.startedAt }, old);
      if (!old.name.includes('backend')) assert.equal(current.startedAt, old.startedAt);
    }
    await save('services-after.json', after);
    console.log('PASS: original workflows/datasets/policies and services preserved; only backend restarted.');
    return;
  }
  const cases = JSON.parse(await readFile(resolve(folder, 'cases.json')));
  for (const dataset of activeDatasets) for (const algorithm of activeAlgorithms) {
    const variants = cases.filter(c => c.dataset === dataset && c.algorithm === algorithm);
    for (let repeat = 1; repeat <= 3; repeat++) {
      const order = variants.map((_, index) => variants[(index + repeat - 1) % variants.length]);
      for (const current of order) {
        const key = `${current.flowId}-r${repeat}`, directory = resolve(folder, key);
        await mkdir(directory, { recursive: true });
        try { await stat(resolve(directory, 'result.json')); console.log(`Already recorded ${key}`); continue; } catch (error) { if (error.code !== 'ENOENT') throw error; }
        let accepted;
        try { accepted = JSON.parse(await readFile(resolve(directory, 'accepted.json'))); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          const inputs = { rounds: current.rounds ?? 2, model: 'mlp', training_dataset: `${dataset}-train/v1`, test_dataset: `${dataset}-test/v1`,
            local_epochs: 1, batch_size: current.batchSize ?? 32, learning_rate: 0.01 };
          if (algorithm === 'fedprox') inputs.prox_mu = 0.1;
          accepted = await api('/executions', 'POST', { flowId: current.flowId, inputs }, { 'Idempotency-Key': randomUUID() });
          await writeFile(resolve(directory, 'accepted.json'), JSON.stringify(accepted));
        }
        const id = accepted.executionId;
        console.log(`START ${key} ${id}`);
        const deadline = Date.now() + 10 * 60000;
        let execution;
        do {
          execution = await api(`/executions/${id}`);
          if (['SUCCESS', 'FAILED', 'KILLED'].includes(execution.state)) break;
          if (Date.now() > deadline) throw new Error(`Timeout ${id}; not automatically cancelled`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        } while (true);
        await writeFile(resolve(directory, 'execution.json'), JSON.stringify(execution, null, 2));
        const tasks = await api(`/executions/${id}/tasks`);
        await writeFile(resolve(directory, 'tasks.json'), JSON.stringify(tasks, null, 2));
        if (execution.state !== 'SUCCESS') {
          const failure = { ...current, repeat, executionId: id, state: execution.state, error: execution.error,
            measurement: { status: 'NOT_SUCCESSFUL' }, training: [],
            wallSeconds: (Date.parse(execution.endedAt) - Date.parse(execution.startedAt)) / 1000 };
          await writeFile(resolve(directory, 'result.json'), JSON.stringify(failure, null, 2));
          console.log(`FAILED (retained, no replacement trial) ${key} ${id}: ${execution.error}`);
          if (replicated) throw new Error('Repeated-load trial failed; inspect capacity before explicitly resuming. No replacement trial.');
          continue;
        }
        const rounds = current.rounds ?? 2;
        assert.equal(execution.outputs.completed_rounds, rounds);
        const leaves = tasks.filter(t => ['init', 'train', 'aggregate', 'evaluate'].includes(t.taskId));
        assert.equal(leaves.length, 1 + rounds * (2 + current.clients));
        const reports = [];
        const evaluation = [];
        for (const task of leaves) {
          assert.equal(task.state, 'SUCCESS');
          const report = await api(`/executions/${id}/tasks/${task.id}/output-json?port=cea-measurement.json`);
          const round = task.taskId === 'train' ? tasks.find(t => t.id === task.parentTaskRunId).iteration : task.iteration;
          reports.push({ taskId: task.taskId, taskRunId: task.id, round, item: task.iteration, ...report });
          if (task.taskId === 'evaluate') {
            const metrics = await api(`/executions/${id}/tasks/${task.id}/output-json?port=metrics.json`);
            assert.equal(metrics.samples, 10000);
            evaluation.push({ round, ...metrics });
            await writeFile(resolve(directory, `evaluate-r${round}.json`), JSON.stringify(metrics));
          }
        }
        await writeFile(resolve(directory, 'reports.json'), JSON.stringify(reports, null, 2));
        const measurement = await api(`/executions/${id}/measurement`);
        assert.equal(measurement.status, 'AVAILABLE');
        const input = reports.reduce((sum, report) => sum + report.inputs.reduce((s, f) => s + f.bytes, 0), 0);
        const output = reports.reduce((sum, report) => sum + report.outputs.reduce((s, f) => s + f.bytes, 0), 0);
        const activity = intervals(reports);
        assert.equal(input, measurement.inputBytes); assert.equal(output, measurement.outputBytes);
        assert(Math.abs(activity.activeSeconds - measurement.activeSeconds) < 1e-8);
        const training = Array.from({ length: rounds }, (_, index) => index + 1)
          .map(round => ({ round, ...intervals(reports.filter(r => r.taskId === 'train' && r.round === round)) }));
        const result = { ...current, repeat, executionId: id, measurement, training,
          ...(batchExperiment ? { evaluation } : {}),
          wallSeconds: (Date.parse(execution.endedAt) - Date.parse(execution.startedAt)) / 1000 };
        await writeFile(resolve(directory, 'result.json'), JSON.stringify(result, null, 2));
        console.log(JSON.stringify({ flow: current.flowId, repeat, id, MBps: measurement.bytesPerSecond / 1e6,
          activeSeconds: measurement.activeSeconds, training }));
      }
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
