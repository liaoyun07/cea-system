import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../../..');
const folder=path.join(root,'.local/cea/three-way-strong-40');
const settings=Object.fromEntries((await fs.readFile(path.join(root,'deploy/cea/.env'),'utf8')).split(/\r?\n/)
  .filter(l=>l&&!l.startsWith('#')).map(l=>{const n=l.indexOf('=');return[l.slice(0,n),l.slice(n+1)];}));
const headers={Authorization:`Basic ${Buffer.from(`${settings.BACKEND_USER}:${settings.BACKEND_PASSWORD}`).toString('base64')}`};
async function api(route){const r=await fetch(`http://127.0.0.1:${settings.CEA_API_PORT}/api/namespaces/lab${route}`,{headers,signal:AbortSignal.timeout(30000)});assert(r.ok,`${route}: ${r.status}`);return r.json();}
const summary=JSON.parse(await fs.readFile(path.join(folder,'summary.json')));
assert.equal(summary.length,6);
const audits=[];
for(const row of summary){
  const result=JSON.parse(await fs.readFile(path.join(folder,`${row.dataset}-${row.algorithm}.json`)));
  const base=`/executions/${result.execution.id}`;
  const execution=await api(base),tasks=await api(`${base}/tasks`);
  assert.equal(execution.state,'SUCCESS');
  assert.equal(execution.startedAt,result.execution.startedAt);assert.equal(execution.endedAt,result.execution.endedAt);
  assert.equal(result.seconds,(Date.parse(execution.endedAt)-Date.parse(execution.startedAt))/1000);
  for(const [name,count] of Object.entries({init:1,train:120,aggregate:40,evaluate:40})){
    const selected=tasks.filter(t=>t.taskId===name);assert.equal(selected.length,count);
    assert(selected.every(t=>t.state==='SUCCESS'));
  }
  assert.deepEqual(result.evaluations.map(e=>e.round),Array.from({length:40},(_,i)=>i+1));
  for(const e of result.evaluations){
    const live=await api(`${base}/tasks/${e.taskRunId}/output-json?port=metrics.json`);
    assert.equal(live.round,e.round);assert.equal(live.samples,10000);
    assert.equal(live.accuracy,e.accuracy);assert.equal(live.loss,e.loss);
    assert(Number.isFinite(e.loss)&&e.accuracy>=0&&e.accuracy<=1);
  }
  audits.push({dataset:row.dataset,algorithm:row.algorithm,executionId:execution.id,applicationTasks:201,evaluations:40,testSamples:10000});
}
for(const old of JSON.parse(await fs.readFile(path.join(folder,'before.json'))).flows)assert.deepEqual(await api(`/flows/${old.flowId}`),old);
await fs.writeFile(path.join(folder,'audit.json'),JSON.stringify({verifiedAt:new Date().toISOString(),audits,oldFlowsUnchanged:true},null,2));
console.log(JSON.stringify({audits,oldFlowsUnchanged:true},null,2));
console.log('MNIST first-95 speedup:',...summary.filter(r=>r.dataset==='mnist').map(r=>({algorithm:r.algorithm,seconds:r.first95.elapsedSeconds,
  timeReduction:1-r.first95.elapsedSeconds/summary[0].first95.elapsedSeconds,speedIncrease:summary[0].first95.elapsedSeconds/r.first95.elapsedSeconds-1})));
