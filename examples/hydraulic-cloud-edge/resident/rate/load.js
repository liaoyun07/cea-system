import http from 'k6/http';
import {check} from 'k6';
import exec from 'k6/execution';
import {Counter, Trend} from 'k6/metrics';
import {open as fsOpen, SeekMode} from 'k6/experimental/fs';
import {buildRatePlan, summarizeRate} from './metrics.mjs';

const manifest = JSON.parse(open('/fixtures/manifest.json'));
const experiment = __ENV.EXPERIMENT || 'HC-14';
if (!['HC-14', 'HC-15', 'HC-16', 'HC-17', 'HC-18', 'HC-19'].includes(experiment)) throw Error('Unknown experiment');
const logPrefix = experiment.replace('-', '');
const urls = JSON.parse(__ENV.ENDPOINTS);
const groups = ['edge-a', 'edge-b', 'edge-c'];
const plan = buildRatePlan(manifest, Number(__ENV.RATE || 273), __ENV.DURATION);
const preAllocatedVUs = Number(__ENV.PRE_ALLOCATED_VUS || 32);
const maxVUs = Number(__ENV.MAX_VUS || 32);
if (!Number.isInteger(preAllocatedVUs) || preAllocatedVUs <= 0 || !Number.isInteger(maxVUs) || maxVUs < preAllocatedVUs)
  throw Error('Positive VU limits with MAX_VUS >= PRE_ALLOCATED_VUS are required');
const files = [], buffers = groups.map(() => new Map());
for (const item of manifest) {
  const handles = [];
  for (let g = 0; g < groups.length; g++) {
    const file = item.files[g];
    handles.push(await fsOpen('/fixtures/' + file.name));
    if (!buffers[g].has(file.length)) buffers[g].set(file.length, new Uint8Array(file.length));
  }
  files.push(handles);
}
const started = new Counter('started_batches'), uploadStarted = new Counter('upload_started_batches');
const initiatedBytes = new Counter('initiated_signal_bytes'), completed = new Counter('completed_batches');
const initiatedInWindowBytes = new Counter('initiated_within_window_bytes');
const completedBytes = new Counter('completed_signal_bytes'), failed = new Counter('failed_batches');
const lateStarts = new Counter('late_upload_starts'), inWindowBytes = new Counter('completed_within_window_bytes');
const firstMs = new Trend('batch_started_epoch_ms'), lastMs = new Trend('batch_finished_epoch_ms');
const scenarioMs = new Trend('scenario_started_epoch_ms'), attemptEndMs = new Trend('attempt_finished_epoch_ms');
const latency = new Trend('batch_latency_ms', true);
export const options = {
  scenarios: {batches: {executor: 'constant-arrival-rate', rate: plan.rate, timeUnit: '1s',
    duration: plan.duration, preAllocatedVUs, maxVUs, gracefulStop: '30s'}},
  // k6 also uses batch as the per-VU idle connection pool capacity. Keep room
  // for all three edge hosts plus the cloud result host; uploads remain three.
  batch: 4, batchPerHost: 3, discardResponseBodies: true,
  systemTags: ['name', 'status', 'method', 'scenario'],
  summaryTrendStats: ['avg', 'min', 'max', 'p(95)', 'p(99)'],
  thresholds: {checks: ['rate==1'], http_req_failed: ['rate==0'], failed_batches: ['count==0']},
};

function logRequestError(iteration, group, response) {
  console.error(logPrefix + '_REQUEST_ERROR ' + JSON.stringify({run: __ENV.RUN, iteration, group,
    status: response.status, error: response.error, errorCode: response.error_code,
    body: String(response.body || '').slice(0, 4096)}));
}

export function setup() {
  for (const [group, url] of Object.entries(urls)) {
    const response = http.post(url + '/reset', JSON.stringify({run: __ENV.RUN}),
      {responseType: 'text', timeout: '30s', tags: {name: 'reset'}});
    if (response.status !== 200) {
      logRequestError(null, group, response);
      throw Error('reset failed');
    }
  }
}

export default async function () {
  const iteration = exec.scenario.iterationInTest, index = iteration % manifest.length, item = manifest[index];
  const scenarioEnd = exec.scenario.startTime + plan.durationSeconds * 1000;
  started.add(1); scenarioMs.add(exec.scenario.startTime);
  let sentAt = null, ok = false;
  try {
    const payloads = [];
    for (let g = 0; g < groups.length; g++) {
      const file = files[index][g], bytes = buffers[g].get(item.files[g].length);
      await file.seek(0, SeekMode.Start);
      const size = await file.read(bytes);
      if (size !== bytes.byteLength) throw Error('short fixture read: ' + item.files[g].name);
      payloads.push(bytes.buffer);
    }
    sentAt = Date.now(); firstMs.add(sentAt);
    uploadStarted.add(1); initiatedBytes.add(item.expected.inputBytes);
    initiatedInWindowBytes.add(sentAt >= exec.scenario.startTime && sentAt <= scenarioEnd ? item.expected.inputBytes : 0);
    lateStarts.add(sentAt > scenarioEnd ? 1 : 0);
    const responses = http.batch(groups.map((group, g) => ['POST',
      urls[group] + '/process/' + __ENV.RUN + '/' + iteration, payloads[g],
      {headers: {'Content-Type': item.files[g].contentType || 'application/octet-stream'}, responseType: 'text',
        timeout: '30s', tags: {name: group}}]));
    if (!responses.every(response => response.status === 200)) {
      responses.forEach((response, g) => {if (response.status !== 200) logRequestError(iteration, groups[g], response);});
      throw Error('edge request failed');
    }
    const response = http.get(urls.cloud + '/result/' + __ENV.RUN + '/' + iteration,
      {responseType: 'text', timeout: '30s', tags: {name: 'cloud-result'}});
    if (response.status !== 200) {
      logRequestError(iteration, 'cloud-result', response);
      throw Error('cloud result request failed');
    }
    const result = response.json(), expected = item.expected;
    ok = result.inputBytes === expected.inputBytes && result.cycles === expected.cycles &&
      result.flagCount === expected.flagCount &&
      Math.abs(result.scoreSum - expected.scoreSum) <= Math.max(1e-6, Math.abs(expected.scoreSum) * 1e-10);
    if (!ok) throw Error('cloud result verification failed');
    completed.add(1); completedBytes.add(expected.inputBytes);
    inWindowBytes.add(Date.now() <= scenarioEnd ? expected.inputBytes : 0);
  } catch (error) {
    console.error(logPrefix + '_BATCH_ERROR ' + JSON.stringify({run: __ENV.RUN, iteration, error: String(error)}));
  } finally {
    const ended = Date.now(); attemptEndMs.add(ended);
    if (sentAt !== null) {lastMs.add(ended); latency.add(ended - sentAt);}
    failed.add(ok ? 0 : 1); check(ok, {'full batch correct': value => value});
  }
}

export function teardown() {
  for (const [group, url] of Object.entries(urls)) {
    const response = http.get(url + '/stats', {responseType: 'text', timeout: '30s', tags: {name: 'stats'}});
    console.log(logPrefix + '_STATS ' + group + ' ' + response.body);
    if (response.status !== 200) logRequestError(null, group, response);
  }
}

export function handleSummary(data) {
  const report = summarizeRate(data, plan, {run: __ENV.RUN, preAllocatedVUs, maxVUs});
  console.log(logPrefix + '_REPORT ' + JSON.stringify(report));
  return {'/output/summary.json': JSON.stringify({report, k6: data}, null, 2)};
}
