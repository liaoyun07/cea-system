// Real OFF-03 CEA workload, not a throughput or latency benchmark. Creates new receipts/executions only.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '');
const folder = `${root}/.local/cea/off03`;
const settings = Object.fromEntries((await readFile(`${root}/deploy/cea/.env`, 'utf8')).split(/\r?\n/).filter(v => /^[A-Z_0-9]+=/.test(v)).map(v => [v.slice(0,v.indexOf('=')),v.slice(v.indexOf('=')+1)]));
const headers = {Authorization:'Basic '+Buffer.from(settings.BACKEND_USER+':'+settings.BACKEND_PASSWORD).toString('base64')};
const api = async path => {const r=await fetch(`http://127.0.0.1:${settings.CEA_API_PORT}/api/namespaces/lab${path}`,{headers});assert.equal(r.status,200);return r.json();};
const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
const samples = () => api('/offloading/samples?limit=100');
const query = async sql => (await exec('docker',['exec','cea-mysql-1','sh','-c',`MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N -B "$MYSQL_DATABASE" -e "${sql}"`],{windowsHide:true,maxBuffer:2097152})).stdout.trim();
const transfers = async () => (await query("SELECT allocation_id,stage,source_id,target_id,bytes,seconds FROM res_file_transfer WHERE namespace='lab' ORDER BY sequence_no")).split('\n').filter(Boolean).map(line=>{const [key,stage,source,target,bytes,seconds]=line.trim().split('\t');return {key,stage,source,target,bytes:Number(bytes),seconds:Number(seconds)};});
const rate = (rows,source,target) => {const path=rows.filter(v=>v.source===source&&v.target===target).slice(-20);assert.ok(path.length);return path.reduce((s,v)=>s+v.bytes,0)/path.reduce((s,v)=>s+v.seconds,0);};
const close = (actual, expected) => assert.ok(Math.abs(actual-expected)<=1e-8*Math.max(1,Math.abs(expected)),`${actual} != ${expected}`);
await mkdir(`${folder}/receipts`,{recursive:true});
const manifest=JSON.parse(await readFile(`${root}/.local/cea/off02/signal-manifest.json`,'utf8'));
const runId=randomUUID();const completed=[];
async function execute(name,event,fileId=manifest.fileId,multiplier=1) {
  const receipt=`${folder}/receipts/${runId}-${name}.json`;
  await exec('docker',['run','--rm','--network','cea_default','--read-only','--cap-drop=ALL',
    '-v',`${root}/deploy/cea/secrets/edge/terminal.json:/run/secrets/terminal.json:ro`,
    '-v',`${root}/.local/cea/off02/terminal:/data:ro`,'-v',`${folder}/receipts:/evidence`,
    'cea/terminal-agent:off03-v1','python','/app/compute.py','--event',event,'--file',`/data/${fileId}`,'--receipt',`/evidence/${runId}-${name}.json`],
    {windowsHide:true,timeout:300000,maxBuffer:1048576});
  const saved=JSON.parse(await readFile(receipt,'utf8'));assert.equal(saved.feedbackAccepted,true);assert.equal(saved.response.state,'SUCCESS');
  const output=saved.response.result;
  for(const key of ['mean','rms','peak'])close(output[key],manifest.expected[key]);
  for(const key of ['samples','windows','alert_windows'])assert.equal(output[key],manifest.expected[key]*multiplier);
  const sample=(await samples()).find(s=>s.executionId===saved.executionId);assert.ok(sample?.measurement);
  if(event!=='offload-rule')assert.equal(sample.target.kind,event.slice('offload-'.length).toUpperCase());
  assert.equal(sample.measurement.terminal,'ep01-terminal');assert.equal(sample.measurement.edge,'edge-a');assert.equal(sample.measurement.flowId,event);
  close(sample.measurement.elapsedSeconds,saved.feedback.elapsedSeconds);
  close(sample.reward,saved.feedback.elapsedSeconds<=120?-saved.feedback.elapsedSeconds/120:-2);
  assert.ok(saved.feedback.elapsedSeconds>0);assert.equal(sample.measurement.feedbackOutcome,saved.feedback.elapsedSeconds<=120?'SUCCESS':'TIMEOUT');
  const rows=(await transfers()).filter(v=>v.key===sample.key);
  assert.equal(rows.length,sample.target.kind==='TERMINAL'?0:2);
  for(const row of rows){assert.equal(row.bytes,manifest.bytes*multiplier);assert.ok(row.seconds>0);}
  const record={name,event,fileId,receipt:saved,sample,transfers:rows};completed.push(record);
  console.log(`${name}: ${sample.target.kind} SUCCESS; end-to-end ${saved.feedback.elapsedSeconds.toFixed(3)}s; ${rows.length} measured transfers`);
  return record;
}
await execute('calibrate-edge','offload-edge');
await execute('calibrate-cloud','offload-cloud');
const beforeRule=await transfers();
const upload=manifest.bytes/rate(beforeRule,'terminal:ep01-terminal','store:cea-artifacts-edge-a');
const expectedTe=upload+manifest.bytes/rate(beforeRule,'store:cea-artifacts-edge-a','cluster:edge-a');
const expectedTc=upload+manifest.bytes/rate(beforeRule,'store:cea-artifacts-edge-a','cluster:cloud');
const first=await execute('rule-first','offload-rule');
assert.ok(first.sample.state,first.sample.measurement.unavailable);
close(first.sample.measurement.inputs[4],expectedTe);close(first.sample.measurement.inputs[5],expectedTc);
first.sample.measurement.inputs.forEach((v,i)=>close(first.sample.state[i],Math.log1p(v)));
const second=await execute('rule-second','offload-rule');
const linked=(await samples()).find(v=>v.key===first.sample.key);
assert.equal(linked.measurement.nextKey,second.sample.key);assert.equal(linked.measurement.trainable,true);assert.deepEqual(linked.measurement.nextState,second.sample.state);

// Same algorithm, real larger file; no synthetic sleep or changed task command to manufacture a delay.
const largeId=randomUUID(),multiplier=44;
assert.ok(manifest.bytes*multiplier<=64*1024*1024);
const small=await readFile(`${root}/.local/cea/off02/terminal/${manifest.fileId}`);
await writeFile(`${root}/.local/cea/off02/terminal/${largeId}`,Buffer.concat(Array(multiplier).fill(small)),{flag:'wx'});
assert.equal((await stat(`${root}/.local/cea/off02/terminal/${largeId}`)).size,manifest.bytes*multiplier);
// CEA already configures two cloud slots (edge-a has one). Do not change placement capacity for this test.
const large=execute('overlap-large','offload-cloud',largeId,multiplier);
let original;
for(let i=0;i<300;i++) {
  try {const receipt=JSON.parse(await readFile(`${folder}/receipts/${runId}-overlap-large.json`,'utf8'));original=(await samples()).find(v=>v.executionId===receipt.executionId);if(original)break;}catch{}
  await wait(100);
}
assert.ok(original,'large request must reach decision before second request');
const tiny=execute('overlap-small','offload-cloud');
const [a,b]=await Promise.all([large,tiny]);
const final=await samples();const finalA=final.find(s=>s.key===a.sample.key),finalB=final.find(s=>s.key===b.sample.key);
const before=JSON.parse(await readFile(`${folder}/samples-before.json`,'utf8'));
for(const old of before) {
  const current=final.find(s=>s.key===old.key);assert.ok(current);assert.equal(current.measurement,null);
  const canonicalTime=v=>typeof v==='string'?v.replace(/(\.\d*?[1-9])0+Z$/,'$1Z').replace(/\.0+Z$/,'Z'):v;
  for(const [key,value] of Object.entries(old))assert.deepEqual(key.endsWith('At')?canonicalTime(current[key]):current[key],key.endsWith('At')?canonicalTime(value):value,`historical sample changed: ${old.key}/${key}`);
}
assert.equal(finalA.measurement.nextKey,finalB.key);assert.deepEqual(finalA.measurement.nextState,finalB.state);
close(finalB.measurement.inputs[3],manifest.bytes*multiplier/1048576);
assert.ok(Date.parse(finalB.finishedAt)<Date.parse(finalA.finishedAt),'expected real smaller request to finish before larger request');
assert.equal(finalA.measurement.trainable,true);assert.equal(finalB.measurement.trainable,false,'continuous stream tail must not invent done');
assert.equal(await query("SELECT COUNT(*) FROM res_offload_workload WHERE namespace='lab' AND released=FALSE"),'0');
const evidence={runId,verifiedAt:new Date().toISOString(),result:'PASS',cases:completed,nextAssociation:{first:finalA,second:finalB},expectedTe,expectedTc};
await writeFile(`${folder}/run-${runId}.json`,JSON.stringify(evidence,null,2));
console.log(`PASS: 6 real executions; measured transfer estimates, original terminal feedback, nonzero unfinished queue, out-of-order completion and next-state association. Evidence run-${runId}.json`);
