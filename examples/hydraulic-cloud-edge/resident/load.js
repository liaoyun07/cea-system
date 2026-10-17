import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { Counter, Trend } from 'k6/metrics';
import { open as fsOpen, SeekMode } from 'k6/experimental/fs';

const manifest = JSON.parse(open('/fixtures/manifest.json'));
const urls = JSON.parse(__ENV.ENDPOINTS);
const groups = ['edge-a', 'edge-b', 'edge-c'];
const captureErrors = __ENV.CAPTURE_ERRORS === '1';
const reuseBuffers = __ENV.REUSE_BUFFERS === '1';
const files = [];
const buffers = groups.map(() => new Map());
for (const item of manifest) {
  const handles = [];
  for (const [g, file] of item.files.entries()) {
    handles.push(await fsOpen('/fixtures/' + file.name));
    if (reuseBuffers && !buffers[g].has(file.length)) buffers[g].set(file.length, new Uint8Array(file.length));
  }
  files.push(handles);
}
const completedBytes = new Counter('completed_signal_bytes');
const completedBatches = new Counter('completed_batches');
const failedBatches = new Counter('failed_batches');
const startedBatches = new Counter('started_batches');
const batchMs = new Trend('batch_latency_ms', true);
const firstMs = new Trend('batch_started_epoch_ms');
const lastMs = new Trend('batch_finished_epoch_ms');
export const options = {
  scenarios: { batches: { executor: 'constant-vus', vus: Number(__ENV.VUS), duration: __ENV.DURATION,
                          gracefulStop: '30s' } },
  batch: 3, batchPerHost: 3, discardResponseBodies: true,
  systemTags: ['name', 'status', 'method', 'scenario'],
  summaryTrendStats: ['avg','min','max','p(95)','p(99)'],
  thresholds: { checks: ['rate==1'], http_req_failed: ['rate==0'], failed_batches: ['count==0'] },
};
export function setup() {
  for (const url of Object.values(urls)) {
    const r = http.post(url + '/reset', JSON.stringify({run: __ENV.RUN}), {responseType:'text', tags:{name:'reset'}});
    if (r.status !== 200) throw Error('reset failed: ' + r.body);
  }
}
export default async function () {
  const iteration = exec.scenario.iterationInTest;
  const index = iteration % manifest.length;
  const item = manifest[index];
  const payloads = [];
  for (let g=0; g<3; g++) {
    const file = files[index][g];
    await file.seek(0, SeekMode.Start);
    const bytes = reuseBuffers ? buffers[g].get(item.files[g].length) : new Uint8Array(item.files[g].length);
    const size = await file.read(bytes);
    if (size !== bytes.byteLength) throw Error('short fixture read');
    payloads.push(bytes.buffer);
  }
  const start = Date.now(); firstMs.add(start); startedBatches.add(1);
  let ok = false;
  try {
    const responses = http.batch(groups.map((g,i) => ['POST', urls[g]+'/process/'+__ENV.RUN+'/'+iteration,
      payloads[i], {headers:{'Content-Type':'application/octet-stream'},timeout:'30s',tags:{name:g},
        ...(captureErrors ? {responseType:'text'} : {})}]));
    if (!responses.every(r=>r.status===200)) {
      if (captureErrors) for (let i=0;i<responses.length;i++) {
        const r=responses[i];
        if (r.status!==200) console.error('HC_REQUEST_ERROR '+JSON.stringify({run:__ENV.RUN,iteration,group:groups[i],
          status:r.status,error:r.error,errorCode:r.error_code,body:String(r.body||'').slice(0,4096)}));
      }
      throw Error('edge request failed');
    }
    const response = http.get(urls.cloud+'/result/'+__ENV.RUN+'/'+iteration,
      {responseType:'text',timeout:'30s',tags:{name:'cloud-result'}});
    if (response.status !== 200) throw Error('cloud incomplete: ' + response.body);
    const result = response.json(), expected = item.expected;
    ok = result.inputBytes===expected.inputBytes && result.cycles===expected.cycles &&
      result.flagCount===expected.flagCount && Math.abs(result.scoreSum-expected.scoreSum)<=Math.max(1e-6,Math.abs(expected.scoreSum)*1e-10);
    if (ok) { completedBytes.add(result.inputBytes); completedBatches.add(1); }
  } catch(error) { console.error(String(error)); }
  finally {
    const ended=Date.now(); lastMs.add(ended); batchMs.add(ended-start);
    failedBatches.add(ok ? 0 : 1); check(ok, {'full batch correct':v=>v});
  }
}
export function teardown() {
  for (const [group,url] of Object.entries(urls)) {
    const response=http.get(url+'/stats',{responseType:'text',tags:{name:'stats'}});
    console.log('HC05_STATS '+group+' '+response.body);
  }
}
export function handleSummary(data) {
  if(!data.metrics.batch_finished_epoch_ms){
    return {'/output/invalid.json':JSON.stringify({run:__ENV.RUN,status:'INVALID_NO_COMPLETED_MEASUREMENT',k6:data})};
  }
  const seconds=(data.metrics.batch_finished_epoch_ms.values.max-data.metrics.batch_started_epoch_ms.values.min)/1000;
  const report={run:__ENV.RUN,vus:Number(__ENV.VUS),duration:__ENV.DURATION,seconds,
    signalBytes:data.metrics.completed_signal_bytes?.values.count||0,
    batches:data.metrics.completed_batches?.values.count||0,
    started:data.metrics.started_batches?.values.count||0,
    failed:data.metrics.failed_batches?.values.count||0,
    batchLatencyMs:data.metrics.batch_latency_ms.values,
    httpFailed:data.metrics.http_req_failed.values,
    receivedBytes:data.metrics.data_received.values.count,sentBytes:data.metrics.data_sent.values.count};
  report.GBps=report.signalBytes/seconds/1e9;
  console.log('HC05_REPORT '+JSON.stringify(report));
  return {'/output/summary.json':JSON.stringify({report,k6:data},null,2)};
}
