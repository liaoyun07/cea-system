import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Execute the real k6 iteration with minimal IO/metric stubs; no service traffic.
const source=readFileSync(new URL('load.js',import.meta.url),'utf8')
  .replace(/^import .*;\r?$/gm,'').replace('export const options','const options')
  .replace('export default async function ()','async function run()').replaceAll('export function ','function ');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
async function exercise(capture,responses,reuse=false,twice=false){
  const metrics={},logs=[],requests=[];let checks=0;
  class Metric{constructor(name){this.name=name;metrics[name]=[];}add(v){metrics[this.name].push(v);}}
  const expected={inputBytes:24,cycles:1,flagCount:0,scoreSum:1};
  const http={batch(r){requests.push(...r);return responses;},get(){return {status:200,json:()=>expected};}};
  const initialize=new AsyncFunction('http','check','exec','Counter','Trend','fsOpen','SeekMode','open','__ENV','console',source+'; return {run,options};');
  const module=await initialize(http,ok=>{checks+=Number(ok);},{scenario:{iterationInTest:0}},Metric,Metric,
    async()=>({seek:async()=>{},read:async bytes=>bytes.length}),{Start:0},
    ()=>JSON.stringify([{files:[0,1,2].map(i=>({name:i+'.npz',length:8})),expected}]),
    {CAPTURE_ERRORS:capture?'1':'0',REUSE_BUFFERS:reuse?'1':'0',RUN:'test',VUS:'12',DURATION:'30s',ENDPOINTS:JSON.stringify({'edge-a':'a','edge-b':'b','edge-c':'c',cloud:'cloud'})},
    {error:v=>logs.push(v),log:()=>{}});
  await module.run();if(twice)await module.run();return {metrics,logs,requests,checks,options:module.options};
}
test('captures failed edge status and truncated error body without counting it as success',async()=>{
  const r=await exercise(true,[{status:200},{status:400,body:'x'.repeat(5000)},{status:200}]);
  const detail=JSON.parse(r.logs.find(x=>x.startsWith('HC_REQUEST_ERROR ')).slice(17));
  assert.equal(detail.group,'edge-b');assert.equal(detail.iteration,0);assert.equal(detail.status,400);assert.equal(detail.body.length,4096);
  assert(r.requests.every(x=>x[3].responseType==='text'));
  assert.deepEqual(r.metrics.failed_batches,[1]);assert.deepEqual(r.metrics.completed_signal_bytes,[]);assert.equal(r.checks,0);
});
test('retains network error code when no HTTP body exists',async()=>{
  const r=await exercise(true,[{status:0,error:'connection reset',error_code:104},{status:200},{status:200}]);
  const detail=JSON.parse(r.logs.find(x=>x.startsWith('HC_REQUEST_ERROR ')).slice(17));
  assert.equal(detail.errorCode,104);assert.equal(detail.body,'');assert.equal(detail.error,'connection reset');
});
test('successful batch keeps original raw-byte accounting and does not emit error logs',async()=>{
  const r=await exercise(true,[{status:200},{status:200},{status:200}]);
  assert.deepEqual(r.metrics.completed_signal_bytes,[24]);assert.deepEqual(r.metrics.completed_batches,[1]);
  assert.deepEqual(r.metrics.started_batches,[1]);assert.deepEqual(r.metrics.failed_batches,[0]);assert.equal(r.checks,1);assert.equal(r.logs.length,0);
  assert.equal(r.options.discardResponseBodies,true);
});
test('historical mode leaves response overrides and diagnostic logging disabled',async()=>{
  const r=await exercise(false,[{status:400},{status:200},{status:200}]);
  assert(r.requests.every(x=>x[3].responseType===undefined));assert.equal(r.logs.length,1);assert.equal(r.logs[0],'Error: edge request failed');
});
test('opt-in buffer reuse preserves business success accounting and separates groups',async()=>{
  const r=await exercise(true,[{status:200},{status:200},{status:200}],true,true);
  assert.equal(r.requests[0][2],r.requests[3][2]);assert.notEqual(r.requests[0][2],r.requests[1][2]);
  assert.deepEqual(r.metrics.completed_signal_bytes,[24,24]);assert.equal(r.checks,2);
});
test('business default retains legacy buffer allocation',async()=>{
  const r=await exercise(true,[{status:200},{status:200},{status:200}],false,true);
  assert.notEqual(r.requests[0][2],r.requests[3][2]);
});
