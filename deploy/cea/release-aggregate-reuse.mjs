// FLPAR-16: ordinary catalog/Flow revisions; no overwrite of prior versions or executions.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {openAsBlob} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {parse,stringify} from '../../frontend/node_modules/yaml/dist/index.js';

const root=fileURLToPath(new URL('../../',import.meta.url)),folder=`${root}/.local/cea/par16`;
const mode=process.argv[2];
const selected=['fedavg','fedprox','par12-fedavg-cifar10-c3-preprocess','par15-fedavg-cifar10-c6-preprocess',
  'par08-fedavg-cifar10-c9-preprocess','par10-fedavg-cifar10-c18-preprocess'];
const env=Object.fromEntries((await readFile(`${root}/deploy/cea/.env`,'utf8')).split(/\r?\n/)
  .filter(l=>/^[A-Z_0-9]+=/.test(l)).map(l=>{const n=l.indexOf('=');return[l.slice(0,n),l.slice(n+1)];}));
const base=`http://127.0.0.1:${env.CEA_API_PORT}/api/namespaces/lab`;
const authorization=`Basic ${Buffer.from(`${env.BACKEND_USER}:${env.BACKEND_PASSWORD}`).toString('base64')}`;
const read=async name=>JSON.parse(await readFile(`${folder}/${name}.json`,'utf8'));
const save=(name,value)=>writeFile(`${folder}/${name}.json`,JSON.stringify(value,null,2),{flag:'wx'});
async function api(path,method='GET',body,key=randomUUID()) {
  const response=await fetch(base+path,{method,headers:{Authorization:authorization,'Content-Type':'application/json','Idempotency-Key':key},body:body?JSON.stringify(body):undefined});
  assert(response.ok,`${method} ${path}: HTTP ${response.status}`);return response.json();
}
async function all(path){const result=[];for(let offset=0;;offset+=100){const page=await api(`${path}?limit=100&offset=${offset}`);result.push(...page);if(page.length<100)return result;}}
async function idle(){const result=await all('/executions');assert(result.every(e=>['SUCCESS','FAILED','KILLED'].includes(e.state)),'Active executions; stop before publication');return result;}
function services(){const ids=execFileSync('docker',['ps','-q','--filter','label=com.docker.compose.project=cea'],{encoding:'utf8'}).trim().split(/\s+/);
  return JSON.parse(execFileSync('docker',['inspect',...ids],{encoding:'utf8'})).map(x=>({id:x.Id,name:x.Name,image:x.Image,startedAt:x.State.StartedAt})).sort((a,b)=>a.name.localeCompare(b.name));}
function containers(flow){const result=[];function visit(tasks){for(const task of tasks??[]){if(task.container)result.push(task.container);visit(task.tasks);}}visit(flow.tasks);return result;}
await mkdir(folder,{recursive:true});
if(mode==='capture') {
  const executions=await idle(),flows=await Promise.all((await all('/flows')).map(f=>api(`/flows/${f.flowId}`)));
  for(const id of selected){const flow=flows.find(f=>f.flowId===id);assert(flow);assert(containers(parse(flow.source)).some(c=>c.applicationId==='fl-aggregate'&&c.version==='par08-v1'));}
  await save('before',{executions,flows,services:services(),datasets:await all('/resources/datasets'),application:await api('/applications/fl-aggregate/versions/par08-v1'),config:await readFile(`${root}/deploy/cea/application.yaml`,'utf8')});
  console.log(`Captured ${flows.length} Flows, ${executions.length} terminal executions.`);
} else if(mode==='upload') {
  const before=await read('before');await idle();
  const form=new FormData();form.append('contract',new Blob([JSON.stringify({parameters:before.application.parameters})],{type:'application/json'}));
  form.append('file',await openAsBlob(`${folder}/aggregate.tar`),'aggregate.tar');
  const response=await fetch(base+'/applications/fl-aggregate/versions/par16-v1/upload',{method:'POST',headers:{Authorization:authorization},body:form});
  assert(response.ok,`Upload HTTP ${response.status}`);const app=await response.json();
  assert.equal(app.version,'par16-v1');assert.deepEqual(app.parameters,before.application.parameters);await save('application',app);console.log('Registered fl-aggregate/par16-v1');
} else if(mode==='publish') {
  const before=await read('before');await idle();const app=await read('application');
  assert.deepEqual(await api('/applications/fl-aggregate/versions/par16-v1'),app);
  const updated=[];
  for(const id of selected){const original=before.flows.find(f=>f.flowId===id);assert.deepEqual(await api(`/flows/${id}`),original);
    const flow=parse(original.source);for(const c of containers(flow))if(c.applicationId==='fl-aggregate'){assert.equal(c.version,'par08-v1');c.version='par16-v1';}
    const source=stringify(flow);await api(`/flows/${id}/validate`,'POST',{source});
    await api(`/flows/${id}/revisions`,'POST',{source,expectedRevision:original.revision});
    const current=await api(`/flows/${id}`);assert.deepEqual(parse(current.source),flow);updated.push(current);console.log(`${id}: r${current.revision}`);
  }await save('published',updated);
} else if(mode==='reuse') {
  const path='/applications/fl-aggregate/versions/par16-v1/preparations';const result=[];
  for(const cluster of ['cloud','edge-a','edge-b','edge-c']) {
    const start=performance.now(),first=await api(`${path}/${cluster}`,'POST');const firstMs=performance.now()-start;
    const history=await all(path);const then=performance.now(),again=await api(`${path}/${cluster}`,'POST');const reuseMs=performance.now()-then;
    assert.deepEqual(again,first);assert.deepEqual(await all(path),history);
    result.push({cluster,firstMs,reuseMs,image:first.image});
  }await save('reuse',result);console.log(JSON.stringify(result));
} else if(mode==='smoke') {
  await idle();const flowId=process.argv[3];assert(selected.includes(flowId));const name=`smoke-${flowId}`;
  let request;try{request=await read(name+'-request');}catch(e){if(e.code!=='ENOENT')throw e;request={key:randomUUID(),body:{flowId,inputs:flowId==='fedavg'||flowId==='fedprox'?{rounds:2}: {}}};await save(name+'-request',request);}
  let accepted;try{accepted=await read(name+'-accepted');}catch(e){if(e.code!=='ENOENT')throw e;accepted=await api('/executions','POST',request.body,request.key);await save(name+'-accepted',accepted);}
  const deadline=Date.now()+600000;let execution;
  do{execution=await api(`/executions/${accepted.executionId}`);if(['SUCCESS','FAILED','KILLED'].includes(execution.state))break;assert(Date.now()<deadline,'Smoke timeout; no retry or cancellation');await new Promise(r=>setTimeout(r,2000));}while(true);
  const tasks=await api(`/executions/${execution.id}/tasks`),measurement=await api(`/executions/${execution.id}/measurement`);
  await save(name,{execution,tasks,measurement});console.log(`${flowId}: ${execution.id} ${execution.state}`);assert.equal(execution.state,'SUCCESS');assert.equal(measurement.status,'AVAILABLE');
} else if(mode==='verify') {
  const before=await read('before'),published=await read('published'),current=await idle();
  for(const old of before.executions)assert.deepEqual(current.find(e=>e.id===old.id),old);
  for(const old of before.flows)assert.deepEqual(await api(`/flows/${old.flowId}`),published.find(f=>f.flowId===old.flowId)??old);
  assert.deepEqual(await all('/resources/datasets'),before.datasets);
  assert.deepEqual(await api('/applications/fl-aggregate/versions/par08-v1'),before.application);
  assert.equal(await readFile(`${root}/deploy/cea/application.yaml`,'utf8'),before.config);
  const live=services();assert.equal(live.length,before.services.length);
  for(const old of before.services.filter(s=>s.name!=='/cea-backend-1'))assert.deepEqual(live.find(s=>s.name===old.name),old);
  await save('after',{result:'PASS',services:live,executionCount:current.length,published:published.map(f=>({id:f.flowId,revision:f.revision}))});console.log('Preservation verified.');
} else throw new Error('capture | upload | publish | reuse | smoke FLOW | verify');
