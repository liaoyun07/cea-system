// LOCK-01 release evidence: keep original data/services, add one parallel smoke Flow.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const folder=`${root}/.local/cea/lock01`;
const env=Object.fromEntries(readFileSync(`${root}/deploy/cea/.env`,'utf8').split(/\r?\n/).filter(l=>/^[A-Z_0-9]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const headers={Authorization:`Basic ${Buffer.from(`${env.BACKEND_USER}:${env.BACKEND_PASSWORD}`).toString('base64')}`,'Content-Type':'application/json'};
const save=(name,value)=>writeFileSync(`${folder}/${name}.json`,JSON.stringify(value,null,2),{flag:'wx'});
const read=name=>JSON.parse(readFileSync(`${folder}/${name}.json`,'utf8'));
const docker=args=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});
async function api(path,method='GET',body,extra={}) {
  const r=await fetch(`http://127.0.0.1:${env.CEA_API_PORT}/api/namespaces/lab${path}`,{method,headers:{...headers,...extra},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  assert(r.ok,`${method} ${path}: ${r.status}`);return r.status===204?null:r.json();
}
async function all(path) {const out=[];for(let offset=0;;offset+=100){const rows=await api(`${path}?limit=100&offset=${offset}`);out.push(...rows);if(rows.length<100)return out;}}
async function snapshot() {
  const executions=await all('/executions');
  assert(executions.every(e=>['SUCCESS','FAILED','KILLED','SKIPPED'].includes(e.state)),'Active execution; do not publish');
  assert((await api('/edge/load/devices')).every(d=>!d.loadRunId),'Active terminal load; do not publish');
  const services=JSON.parse(docker(['inspect',...docker(['ps','-q']).trim().split(/\s+/)])).filter(c=>c.Name.startsWith('/cea-')).map(c=>({name:c.Name,id:c.Id,image:c.Image,started:c.State.StartedAt})).sort((a,b)=>a.name.localeCompare(b.name));
  return {at:new Date().toISOString(),executions,services,flows:await Promise.all((await all('/flows')).map(f=>api(`/flows/${f.flowId}`))),datasets:await all('/resources/datasets'),policies:await all('/edge/policies')};
}
mkdirSync(folder,{recursive:true});
const mode=process.argv[2];
if(mode==='capture') {
  assert(!existsSync(`${folder}/before.json`),'Keep original capture');
  const before=await snapshot();save('before',before);
  docker(['tag',before.services.find(c=>c.name==='/cea-backend-1').image,'cea/backend:before-lock01']);
  console.log(JSON.stringify({executions:before.executions.length,flows:before.flows.length,services:before.services.length,rollback:'cea/backend:before-lock01'}));
} else if(mode==='ready') {
  const before=read('before'),now=await snapshot();
  for(const key of ['executions','services','flows','datasets','policies'])assert.deepEqual(now[key],before[key]);
  console.log('CEA remains idle; original data/services unchanged before release.');
} else if(mode==='smoke') {
  assert(existsSync(`${folder}/before.json`));assert(!existsSync(`${folder}/accepted.json`),'Inspect accepted execution; do not resubmit');
  const id='lock01-parallel-check';
  await api(`/flows/${id}/revisions`,'POST',{expectedRevision:0,source:JSON.stringify({schemaVersion:1,namespace:'lab',id,tasks:[{id:'parallel',type:'core.Parallel',tasks:[{id:'first',type:'core.Sleep',duration:'PT3S'},{id:'second',type:'core.Sleep',duration:'PT3S'}]}]})});
  const accepted=await api('/executions','POST',{flowId:id,inputs:{}},{'Idempotency-Key':'lock01-parallel-check-20261014'});save('accepted',accepted);
  assert(/^[a-f0-9-]{36}$/.test(accepted.executionId));
  const end=Date.now()+60000;let execution,peakRunning=0;
  do {
    execution=await api(`/executions/${accepted.executionId}`);
    const sql=`SELECT COUNT(*) FROM wf_worker_job WHERE state='RUNNING' AND JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.executionId'))='${accepted.executionId}'`;
    peakRunning=Math.max(peakRunning,Number(docker(['exec','cea-mysql-1','sh','-c','MYSQL_PWD="$MYSQL_PASSWORD" exec mysql -u"$MYSQL_USER" cea -N -e "$1"','sh',sql]).trim()));
    if(['SUCCESS','FAILED','KILLED'].includes(execution.state))break;await new Promise(r=>setTimeout(r,200));
  }while(Date.now()<end);
  const tasks=await api(`/executions/${accepted.executionId}/tasks`);save('smoke',{execution,tasks,peakRunning});
  assert.equal(execution.state,'SUCCESS');
  assert.equal(peakRunning,2,'Both Worker leases must be active together');
  const children=tasks.filter(t=>['first','second'].includes(t.taskId));assert.equal(children.length,2);
  const overlapMs=Math.min(...children.map(t=>Date.parse(t.endedAt)))-Math.max(...children.map(t=>Date.parse(t.startedAt)));
  assert(overlapMs>=2000,`Expected overlapping tasks, got ${overlapMs} ms`);
  for(const child of children)assert.equal((await api(`/executions/${accepted.executionId}/tasks/${child.id}/attempts`)).length,1);
  console.log(JSON.stringify({executionId:execution.id,state:execution.state,overlapMs,peakRunning}));
} else if(mode==='verify') {
  const before=read('before'),after=await snapshot();
  for(const old of before.executions)assert.deepEqual(after.executions.find(e=>e.id===old.id),old);
  for(const old of before.flows)assert.deepEqual(after.flows.find(f=>f.flowId===old.flowId),old);
  for(const key of ['datasets','policies'])assert.deepEqual(after[key],before[key]);
  assert.equal(after.services.length,before.services.length);
  for(const old of before.services){const now=after.services.find(s=>s.name===old.name);assert(now);if(old.name==='/cea-backend-1')assert.notEqual(now.id,old.id);else assert.deepEqual(now,old);}
  save('after',after);console.log(JSON.stringify({result:'PASS',oldExecutions:before.executions.length,oldFlows:before.flows.length,unchangedServices:before.services.length-1}));
} else throw new Error('capture | ready | smoke | verify');
