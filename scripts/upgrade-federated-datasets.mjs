// FLDATA-01: explicit CEA catalog/Flow revision upgrade; no service restarts or history rewrites.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseDocument, visit } from '../frontend/node_modules/yaml/dist/index.js';

const root = resolve(import.meta.dirname, '..');
const appIds = ['fl-init', 'fedavg-train', 'fedprox-train', 'fl-aggregate', 'fl-evaluate'];
const datasets = ['mnist', 'cifar10', 'cifar100'];
const version = 'cf01-v1';

export function upgradeFlow(source) {
  const doc = parseDocument(source);
  assert.equal(doc.errors.length, 0);
  for (const [input, split] of [['training_dataset', 'train'], ['test_dataset', 'test']]) {
    const definition = doc.getIn(['inputs', input]);
    assert.equal(definition.get('type'), 'SELECT');
    const values = definition.get('values');
    for (const dataset of datasets) if (!values.toJSON().includes(`${dataset}-${split}/v1`)) values.add(`${dataset}-${split}/v1`);
  }
  let count = 0;
  visit(doc, { Map(_key, node) {
    if (node.get('type') !== 'platform.Application') return;
    const container = node.get('container'), id = container.get('applicationId');
    assert(appIds.includes(id), `Unexpected application ${id}; review before upgrading`);
    container.set('version', version);
    if (id === 'fl-init') {
      const parameters = container.get('parameters');
      parameters.delete('DATASET_NAME');
      parameters.set('TRAINING_DATASET', doc.createNode({ source: 'INPUT', name: 'training_dataset' }));
      parameters.set('TEST_DATASET', doc.createNode({ source: 'INPUT', name: 'test_dataset' }));
    }
    count++;
  }});
  assert.equal(count, 4, 'Expected init/train/aggregate/evaluate definitions');
  return doc.toString();
}

export function upgradeContract(previous, image) {
  const next = structuredClone(previous);
  next.version = version;
  next.image = image;
  if (next.applicationId === 'fl-init') {
    delete next.parameters.DATASET_NAME;
    for (const [name, split] of [['TRAINING_DATASET', 'train'], ['TEST_DATASET', 'test']]) {
      next.parameters[name] = { type: 'STRING', required: true, defaultValue: `mnist-${split}/v1`,
        choices: datasets.map(dataset => `${dataset}-${split}/v1`) };
    }
  } else {
    for (const [name, split] of [['DATASET', 'train'], ['TEST_DATASET', 'test']]) {
      const parameter = next.parameters[name];
      if (!parameter) continue;
      assert.equal(parameter.dataset.format, 'pt');
      for (const dataset of datasets) {
        if (!parameter.dataset.allowed.some(ref => ref.datasetId === `${dataset}-${split}` && ref.version === 'v1'))
          parameter.dataset.allowed.push({ datasetId: `${dataset}-${split}`, version: 'v1' });
      }
    }
  }
  return next;
}

async function main() {
  const mode = process.argv[2];
  assert(['--capture', '--publish', '--verify'].includes(mode), 'Use --capture, --publish or --verify');
  const evidence = resolve(root, '.local/cea/cf01');
  await mkdir(evidence, { recursive: true });
  const settings = Object.fromEntries((await readFile(resolve(root, 'deploy/cea/.env'), 'utf8')).split(/\r?\n/)
    .filter(line => /^[A-Z_0-9]+=/.test(line)).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  const base = `http://127.0.0.1:${settings.CEA_API_PORT}/api/namespaces/lab`;
  const headers = { Authorization: 'Basic ' + Buffer.from(`${settings.BACKEND_USER}:${settings.BACKEND_PASSWORD}`).toString('base64'), 'Content-Type': 'application/json' };
  async function api(path, method = 'GET', body) {
    const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}`);
    return response.json();
  }
  const services = () => execFileSync('docker', ['ps', '--filter', 'label=com.docker.compose.project=cea', '--format', '{{.ID}} {{.Names}} {{.Image}}'], { encoding: 'utf8' }).trim().split(/\r?\n/).sort();
  if (mode === '--capture') {
    const flows = await Promise.all(['fedavg', 'fedprox'].map(id => api(`/flows/${id}`)));
    const refs = new Map();
    for (const flow of flows) visit(parseDocument(flow.source), { Map(_key, node) {
      if (node.get('type') !== 'platform.Application') return;
      const container = node.get('container'), id = container.get('applicationId'), old = container.get('version');
      assert(appIds.includes(id));
      assert(!refs.has(id) || refs.get(id) === old, 'Different role versions require manual review');
      refs.set(id, old);
    }});
    const applications = await Promise.all([...refs].map(([id, old]) => api(`/applications/${id}/versions/${old}`)));
    assert.equal(applications.length, 5);
    const snapshot = { flows, applications, datasets: await api('/resources/datasets'), policies: await api('/edge/policies'), services: services() };
    await writeFile(resolve(evidence, 'before.json'), JSON.stringify(snapshot, null, 2), { flag: 'wx' });
    console.log('Captured current CEA definitions, datasets, policies and service identities.');
    return;
  }
  const before = JSON.parse(await readFile(resolve(evidence, 'before.json'), 'utf8'));
  if (mode === '--publish') {
    for (const old of before.flows) assert.deepEqual(await api(`/flows/${old.flowId}`), old, 'Flow changed since capture');
    // The caller must prepare and verify the real uploaded objects before registering their locations.
    const ready = JSON.parse(await readFile(resolve(evidence, 'data-ready.json'), 'utf8'));
    assert.deepEqual(ready.datasets, ['cifar10', 'cifar100']);assert.equal(ready.objects, 8);
    const digest = execFileSync('docker', ['exec', 'cea-backend-1', 'skopeo', 'inspect', '--tls-verify=false', '--authfile=/run/secrets/registry-auth.json', '--format', '{{.Digest}}', `docker://registry-center:5000/lab/federated:${version}`], { encoding: 'utf8' }).trim();
    assert.match(digest, /^sha256:[a-f0-9]{64}$/);
    const image = `registry-center:5000/lab/federated@${digest}`;
    const definitions = JSON.parse(await readFile(resolve(root, 'examples/federated/datasets.json'), 'utf8'));
    for (const dataset of definitions.filter(d => d.datasetId.startsWith('cifar')))
      await api(`/resources/datasets/${dataset.datasetId}/versions/${dataset.version}`, 'PUT', dataset);
    for (const app of before.applications)
      await api(`/applications/${app.applicationId}/versions/${version}`, 'PUT', upgradeContract(app, image));
    const changes = [];
    for (const old of before.flows) {
      const source = upgradeFlow(old.source);
      await api(`/flows/${old.flowId}/validate`, 'POST', { source });
      const saved = await api(`/flows/${old.flowId}/revisions`, 'POST', { expectedRevision: old.revision, source });
      changes.push({ id: old.flowId, revision: saved.revision, source });
    }
    await writeFile(resolve(evidence, 'published.json'), JSON.stringify({ image, version, changes }, null, 2));
    console.log(JSON.stringify({ image, version, flows: changes.map(({ id, revision }) => ({ id, revision })) }));
  } else {
    const published = JSON.parse(await readFile(resolve(evidence, 'published.json'), 'utf8'));
    for (const old of before.flows) assert.equal((await api(`/flows/${old.flowId}?revision=${old.revision}`)).source, old.source);
    for (const current of published.changes) {
      const value = await api(`/flows/${current.id}`);
      assert.equal(value.source, current.source);assert.equal(value.revision, current.revision);
    }
    for (const app of before.applications) assert.deepEqual(await api(`/applications/${app.applicationId}/versions/${app.version}`), app);
    for (const dataset of before.datasets) assert.deepEqual(await api(`/resources/datasets/${dataset.datasetId}/versions/${dataset.version}`), dataset);
    assert.deepEqual(await api('/edge/policies'), before.policies);
    assert.deepEqual(services(), before.services);
    console.log('PASS: new revisions active; old Flow/application/dataset versions, edge policies and all CEA services preserved.');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
