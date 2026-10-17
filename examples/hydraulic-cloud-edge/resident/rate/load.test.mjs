import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildRatePlan, summarizeRate, arrivalBoundaryAllowance} from './metrics.mjs';

const source = readFileSync(new URL('load.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?$/gm, '').replace('export const options', 'const options')
  .replace('export default async function ()', 'async function run()').replaceAll('export function ', 'function ');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const expected = {inputBytes: 24, cycles: 1, flagCount: 0, scoreSum: 1};
const manifest = [0, 1].map(index => ({files: [0, 1, 2].map(group => ({name: `${index}-${group}.npz`, length: 8})), expected}));

async function exercise({responses = [{status: 200}, {status: 200}, {status: 200}], shortRead = false,
  cloud = {status: 200, json: () => expected}, iterations = [0], now = 1000000, experiment = 'HC-14'} = {}) {
  const metrics = {}, logs = [], requests = [], gets = [], reads = [];
  const execution = {scenario: {iterationInTest: 0, startTime: 1000000}};
  class Metric {constructor(name) {this.name = name; metrics[name] = [];} add(value) {metrics[this.name].push(value);}}
  const http = {batch(values) {requests.push(...values); return responses;}, get(url) {gets.push(url); return cloud;}};
  const initialize = new AsyncFunction('http', 'check', 'exec', 'Counter', 'Trend', 'fsOpen', 'SeekMode', 'open', '__ENV',
    'console', 'Date', 'buildRatePlan', 'summarizeRate', source + ';return {run,options,handleSummary};');
  const module = await initialize(http, () => {}, execution, Metric, Metric,
    async name => ({seek: async () => {}, read: async bytes => {reads.push(name); return bytes.length - Number(shortRead);}}),
    {Start: 0}, () => JSON.stringify(manifest),
    {RUN: 'test', EXPERIMENT: experiment, RATE: '273', DURATION: '10s', PRE_ALLOCATED_VUS: '32', MAX_VUS: '48',
      ENDPOINTS: JSON.stringify({'edge-a': 'a', 'edge-b': 'b', 'edge-c': 'c', cloud: 'cloud'})},
    {error: value => logs.push(value), log: value => logs.push(value)}, {now: () => now}, buildRatePlan, summarizeRate);
  for (const iteration of iterations) {execution.scenario.iterationInTest = iteration; await module.run();}
  return {...module, metrics, logs, requests, gets, reads};
}

test('uses an open arrival schedule and reuses separate VU-local group buffers', async () => {
  const result = await exercise({iterations: [0, 2]});
  assert.deepEqual(result.options.scenarios.batches, {executor: 'constant-arrival-rate', rate: 273, timeUnit: '1s',
    duration: '10s', preAllocatedVUs: 32, maxVUs: 48, gracefulStop: '30s'});
  assert.equal(result.options.batch, 4);
  assert.equal(result.options.batchPerHost, 3);
  assert.equal(result.requests.length, 6); // Two iterations, three uploads each.
  assert.equal(result.requests[0][2], result.requests[3][2]);
  assert.notEqual(result.requests[0][2], result.requests[1][2]);
  assert.deepEqual(result.metrics.completed_signal_bytes, [24, 24]);
  assert.deepEqual(result.metrics.initiated_signal_bytes, [24, 24]);
  assert.deepEqual(result.metrics.initiated_within_window_bytes, [24, 24]);
  assert.deepEqual(result.metrics.failed_batches, [0, 0]);
  assert.equal(result.reads.length, 6);
  assert.deepEqual(result.gets, ['cloud/result/test/0', 'cloud/result/test/2']);
});

test('global iteration selects the cyclic source and preserves original service routes', async () => {
  const result = await exercise({iterations: [3]});
  assert.deepEqual(result.reads, ['/fixtures/1-0.npz', '/fixtures/1-1.npz', '/fixtures/1-2.npz']);
  assert.deepEqual(result.requests.map(value => value[1]), ['a/process/test/3', 'b/process/test/3', 'c/process/test/3']);
});

test('short input reads are failed attempts, not uncounted exits or uploaded bytes', async () => {
  const result = await exercise({shortRead: true});
  assert.deepEqual(result.metrics.started_batches, [1]);
  assert.deepEqual(result.metrics.failed_batches, [1]);
  assert.deepEqual(result.metrics.upload_started_batches, []);
  assert.deepEqual(result.metrics.initiated_signal_bytes, []);
  assert.deepEqual(result.metrics.initiated_within_window_bytes, []);
  assert.deepEqual(result.metrics.completed_signal_bytes, []);
  assert.equal(result.requests.length, 0);
  assert.match(result.logs[0], /short fixture read/);
});

test('HTTP failure retains bounded diagnostic body and never retries or counts success', async () => {
  const result = await exercise({responses: [{status: 200}, {status: 400, body: 'x'.repeat(5000)}, {status: 200}]});
  const detail = JSON.parse(result.logs.find(value => value.startsWith('HC14_REQUEST_ERROR ')).slice(19));
  assert.equal(detail.group, 'edge-b'); assert.equal(detail.body.length, 4096);
  assert.equal(result.requests.length, 3); assert.equal(result.gets.length, 0);
  assert.deepEqual(result.metrics.initiated_signal_bytes, [24]);
  assert.deepEqual(result.metrics.completed_signal_bytes, []); assert.deepEqual(result.metrics.failed_batches, [1]);
});
test('HC15 only changes log identity, not requests, retries or failure accounting', async () => {
  const result = await exercise({experiment: 'HC-15', responses: [{status: 200}, {status: 400, body: 'reset'}, {status: 200}]});
  assert(result.logs.some(value => value.startsWith('HC15_REQUEST_ERROR ')));
  assert.equal(result.requests.length, 3); assert.deepEqual(result.metrics.failed_batches, [1]);
});

test('cloud HTTP and numerical errors both fail complete-chain accounting', async () => {
  for (const cloud of [{status: 503, body: 'not complete'}, {status: 200, json: () => ({...expected, flagCount: 9})}]) {
    const result = await exercise({cloud});
    assert.deepEqual(result.metrics.completed_batches, []); assert.deepEqual(result.metrics.failed_batches, [1]);
    assert.equal(result.gets.length, 1);
  }
});

test('upload only becomes late after the configured sending window ends', async () => {
  const onTime = await exercise({now: 1000002});
  const late = await exercise({now: 1010001});
  assert.deepEqual(onTime.metrics.late_upload_starts, [0]);
  assert.deepEqual(late.metrics.late_upload_starts, [1]);
  assert.deepEqual(late.metrics.completed_within_window_bytes, [0]);
  assert.deepEqual(late.metrics.completed_signal_bytes, [24]);
  assert.deepEqual(onTime.metrics.initiated_within_window_bytes, [24]);
  assert.deepEqual(late.metrics.initiated_within_window_bytes, [0]);
});

function sampleData({started = 4, completed = started, failed = 0, dropped = 0, late = 0, sent = 60, received = sent,
  last = 4000, httpRate = 0, initiatedInWindow = sent} = {}) {
  const counter = count => ({values: {count}});
  return {metrics: {
    started_batches: counter(started), upload_started_batches: counter(started), completed_batches: counter(completed),
    failed_batches: counter(failed), initiated_signal_bytes: counter(sent), completed_signal_bytes: counter(received),
    initiated_within_window_bytes: counter(initiatedInWindow),
    dropped_iterations: counter(dropped), late_upload_starts: counter(late), completed_within_window_bytes: counter(received),
    batch_started_epoch_ms: {values: {min: 1100, max: 2900}}, batch_finished_epoch_ms: {values: {max: last}},
    scenario_started_epoch_ms: {values: {min: 1000}}, attempt_finished_epoch_ms: {values: {max: last}},
    http_req_failed: {values: {rate: httpRate}},
  }};
}

test('plan uses exact cyclic original bytes, not wire size or output size', () => {
  const plan = buildRatePlan([{expected: {inputBytes: 10}}, {expected: {inputBytes: 20}}], 3, '3s');
  assert.equal(plan.plannedBatches, 9); assert.equal(plan.plannedSignalBytes, 130);
  assert.equal(plan.meanBatchSignalBytes, 15); assert.equal(plan.targetGBps, 45 / 1e9);
  assert.equal(plan.plannedGBps, 130 / 3 / 1e9);
  assert.throws(() => buildRatePlan(manifest, 273, '0s'));
});

test('summary includes final drain in complete-chain throughput rather than dividing by scheduled duration', () => {
  const plan = buildRatePlan([{expected: {inputBytes: 10}}, {expected: {inputBytes: 20}}], 2, '2s');
  const report = summarizeRate(sampleData(), plan, {run: 'test'});
  assert.equal(report.seconds, 2.9); assert.equal(report.GBps, 60 / 2.9 / 1e9);
  assert.equal(report.drainSeconds, 1); assert.equal(report.offeredLoadAchieved, true); assert.equal(report.valid, true);
  assert.equal(report.initiatedWithinWindowGBps,60/2/1e9);
});

test('dropped schedule is disclosed while fully accounted actual processing remains usable', () => {
  const plan = buildRatePlan([{expected: {inputBytes: 10}}, {expected: {inputBytes: 20}}], 2, '2s');
  const report = summarizeRate(sampleData({started: 3, dropped: 1, sent: 40}), plan, {});
  assert.equal(report.valid, true); assert.equal(report.offeredLoadAchieved, false);
  assert.equal(report.droppedIterations, 1); assert.equal(report.completionFractionOfPlan, 0.75);
  assert.equal(report.observedArrivalSlots,4);assert.equal(report.arrivalBoundaryDelta,0);
});

test('known integer-nanosecond plus-one boundary is accepted but neither missing nor arbitrary extra arrivals are', () => {
  const plan=buildRatePlan([{expected:{inputBytes:10}}],273,'10s');
  assert.equal(plan.plannedBatches,2730);assert.equal(plan.plannedSignalBytes,27300);assert.equal(arrivalBoundaryAllowance(plan),1);
  const report=started=>summarizeRate(sampleData({started,sent:started*10}),plan,{});
  assert.equal(report(2730).offeredLoadAchieved,true);
  const plusOne=report(2731);assert.equal(plusOne.offeredLoadAchieved,true);assert.equal(plusOne.observedArrivalSlots,2731);assert.equal(plusOne.arrivalBoundaryDelta,1);
  assert.equal(report(2729).offeredLoadAchieved,false);assert.equal(report(2732).offeredLoadAchieved,false);
  assert.equal(summarizeRate(sampleData({started:2730,dropped:1,sent:27300}),plan,{}).offeredLoadAchieved,false);
  assert.equal(summarizeRate(sampleData({started:2731,late:1,sent:27310,initiatedInWindow:27300}),plan,{}).offeredLoadAchieved,false);
  const exactPlan=buildRatePlan([{expected:{inputBytes:10}}],2,'2s');assert.equal(arrivalBoundaryAllowance(exactPlan),0);
  assert.equal(summarizeRate(sampleData({started:5,sent:50}),exactPlan,{}).offeredLoadAchieved,false);
});

test('failure, unfinished attempts and empty measurement never become valid throughput', () => {
  const plan = buildRatePlan(manifest, 2, '2s');
  assert.equal(summarizeRate(sampleData({completed: 3, failed: 1}), plan, {}).valid, false);
  assert.equal(summarizeRate(sampleData({completed: 3}), plan, {}).valid, false);
  assert.equal(summarizeRate(sampleData({httpRate: 0.01}), plan, {}).valid, false);
  const empty = summarizeRate({metrics: {}}, plan, {});
  assert.equal(empty.valid, false); assert.equal(empty.GBps, null); assert.equal(empty.offeredLoadAchieved, false);
});
