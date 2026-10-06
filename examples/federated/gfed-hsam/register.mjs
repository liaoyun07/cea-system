// New applications + Flow only; no old revisions, datasets or services overwritten.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stringify} from '../../../frontend/node_modules/yaml/dist/index.js';
import {canonicalContract, contracts, definition} from './definitions.mjs';

const settings = Object.fromEntries(fs.readFileSync(new URL('../../../deploy/cea/.env', import.meta.url), 'utf8')
  .split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => {
    const p = line.indexOf('='); return [line.slice(0, p), line.slice(p + 1)];
  }));
const image = process.argv[2];
assert.match(image ?? '', /^registry-center:5000\/lab\/cea-federated@sha256:[a-f0-9]{64}$/);
const apiRoot = `http://127.0.0.1:${settings.CEA_API_PORT}/api/namespaces/lab`;
const headers = {Authorization: `Basic ${Buffer.from(`${settings.BACKEND_USER}:${settings.BACKEND_PASSWORD}`).toString('base64')}`,
  'Content-Type': 'application/json'};
async function api(route, method = 'GET', body) {
  const response = await fetch(apiRoot + route, {method, headers, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000)});
  assert(response.ok, `${method} ${route}: ${response.status} ${response.ok ? '' : await response.text()}`);
  return response.json();
}
async function absent(route) {
  const response = await fetch(apiRoot + route, {headers});
  assert.equal(response.status, 404, `Refuse to overwrite existing ${route}`);
}
await absent('/flows/gfed-hsam');
// A partially completed registration can resume only with identical definitions.
const pending = [];
for (const contract of contracts(image)) {
  const route = `/applications/${contract.applicationId}/versions/v1`;
  const response = await fetch(apiRoot + route, {headers});
  if (response.status === 404) pending.push(contract);
  else {
    assert(response.ok, `${route}: ${response.status}`);
    assert.deepEqual(canonicalContract(await response.json()), canonicalContract(contract));
  }
}
for (const cluster of ['cloud', 'edge-a', 'edge-b', 'edge-c']) await api(`/resources/clusters/${cluster}`);
const flow = definition(), source = stringify(flow);
for (const ref of [flow.inputs.training_dataset.defaultValue, flow.inputs.test_dataset.defaultValue]) {
  const [dataset, version] = ref.split('/'); await api(`/resources/datasets/${dataset}/versions/${version}`);
}
await api('/flows/gfed-hsam/validate', 'POST', {source});
for (const contract of pending) {
  const route = `/applications/${contract.applicationId}/versions/v1`;
  await api(route, 'PUT', contract);
  assert.deepEqual(canonicalContract(await api(route)), canonicalContract(contract));
}
const revision = await api('/flows/gfed-hsam/revisions', 'POST', {source, expectedRevision: 0});
assert.equal((await api('/flows/gfed-hsam')).source, source);
console.log(JSON.stringify({flowId: 'gfed-hsam', revision: revision.revision, image,
  applications: contracts(image).map(c => c.applicationId), executionSubmitted: false}, null, 2));
