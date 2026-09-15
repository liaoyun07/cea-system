// FLPAR-13: change the three existing edge shards, not client counts or execution semantics.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parse, stringify} from '../../../frontend/node_modules/yaml/dist/index.js';
import {intervals} from '../parallel-benchmark/run.mjs';

const root=resolve(import.meta.dirname,'../../..'),folder=resolve(root,'.local/cea/par13');
export const targets=['par08-fedavg-cifar10-c9-preprocess','par10-fedavg-cifar10-c18-preprocess',
  ...[1,2,3].map(n=>`par12-fedavg-cifar10-c${n}-preprocess`)];
const smokeId=targets.at(-1);
export function balanced(source){
  const flow=parse(source),input=flow.inputs.raw_training_dataset;
  assert(targets.includes(flow.id));assert.equal(input.defaultValue,'cifar10-raw-train/v1');
  assert.deepEqual(input.values,['cifar10-raw-train/v1']);
  input.defaultValue='cifar10-raw-train/v2';input.values=['cifar10-raw-train/v2'];
  const preprocess=flow.tasks[1].tasks[0].tasks.find(t=>t.id==='preprocess').container;
  assert.equal(preprocess.applicationId,'fl-preprocess');assert.equal(preprocess.version,'par08-v1');
  preprocess.version='par13-v1';
  return flow;
}

async function main(){
  const mode=process.argv[2];assert(['capture','publish','smoke','verify'].includes(mode));
  await mkdir(folder,{recursive:true});
  const settings=Object.fromEntries((await readFile(resolve(root,'deploy/cea/.env'),'utf8')).split(/\r?\n/)
    .filter(l=>/^[A-Z_0-9]+=/.test(l)).map(l=>{const n=l.indexOf('=');return [l.slice(0,n),l.slice(n+1)];}));
  const base=`http://127.0.0.1:${settings.CEA_API_PORT}`;
  const authorization='Basic '+Buffer.from(`${settings.BACKEND_USER}:${settings.BACKEND_PASSWORD}`).toString('base64');
  async function api(path,method='GET',body,key=randomUUID()){
    const response=await fetch(`${base}/api/namespaces/lab${path}`,{method,headers:{Authorization:authorization,'Content-Type':'application/json','Idempotency-Key':key},
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
    assert(response.ok,`${method} ${path}: HTTP ${response.status}`);return response.json();
  }
  const read=name=>readFile(resolve(folder,name),'utf8').then(JSON.parse);
  const save=(name,value)=>writeFile(resolve(folder,name),JSON.stringify(value,null,2),{flag:'wx'});
  async function all(path){const rows=[];for(let offset=0;;offset+=100){const page=await api(`${path}?limit=100&offset=${offset}`);rows.push(...page);if(page.length<100)return rows;}}
  async function idle(){const rows=await all('/executions');assert(rows.every(e=>['SUCCESS','FAILED','KILLED'].includes(e.state)),'Active executions: do not change inputs mid-run');return rows;}
  function services(){const ids=execFileSync('docker',['ps','-q','--filter','label=com.docker.compose.project=cea'],{encoding:'utf8'}).trim().split(/\s+/);
    return JSON.parse(execFileSync('docker',['inspect',...ids],{encoding:'utf8'})).map(c=>({id:c.Id,name:c.Name,image:c.Image,started:c.State.StartedAt})).sort((a,b)=>a.name.localeCompare(b.name));}
  if(mode==='capture'){
    const executions=await idle(),flows=await Promise.all((await all('/flows')).map(f=>api(`/flows/${f.flowId}`)));
    for(const id of targets)assert(flows.some(f=>f.flowId===id));
    await save('before.json',{executions,flows,datasets:await all('/resources/datasets'),services:services(),
      application:await api('/applications/fl-preprocess/versions/par08-v1'),config:await readFile(resolve(root,'deploy/cea/application.yaml'),'utf8')});
    console.log(`Captured ${executions.length} executions / ${flows.length} Flows. Only five current preprocessing Flow revisions are targets.`);return;
  }
  const before=await read('before.json');assert.deepEqual(services(),before.services);
  assert.equal(await readFile(resolve(root,'deploy/cea/application.yaml'),'utf8'),before.config);
  if(mode==='publish'){
    await idle();assert.equal((await read('uploaded.json')).result,'PASS');assert.equal((await read('data-audit.json')).result,'PASS');
    const dataset={datasetId:'cifar10-raw-train',version:'v2',format:'pt',locations:[...'abc'].map(letter=>({clusterId:`edge-${letter}`,uri:`s3://datasets/par13/raw/edge-${letter}.pt`}))};
    await api('/resources/datasets/cifar10-raw-train/versions/v2','PUT',dataset);
    const app=structuredClone(before.application);app.version='par13-v1';
    app.parameters.RAW_DATASET.defaultValue='cifar10-raw-train/v2';app.parameters.RAW_DATASET.dataset.allowed=[{datasetId:'cifar10-raw-train',version:'v2'}];
    await api('/applications/fl-preprocess/versions/par13-v1','PUT',app);
    const published=[];
    for(const id of targets){const old=before.flows.find(f=>f.flowId===id),source=stringify(balanced(old.source));
      const current=await api(`/flows/${id}`);
      if(current.source!==source){assert.deepEqual(current,old,'Flow concurrently modified');
        await api(`/flows/${id}/validate`,'POST',{source});await api(`/flows/${id}/revisions`,'POST',{source,expectedRevision:old.revision});}
      published.push(await api(`/flows/${id}`));
    }
    await save('published.json',{dataset,app,flows:published});console.log('Published raw v2 and five Flow revisions; all client counts/concurrency and images unchanged.');return;
  }
  const published=await read('published.json');
  if(mode==='smoke'){
    assert.deepEqual(await api(`/flows/${smokeId}`),published.flows.find(f=>f.flowId===smokeId));
    let accepted;try{accepted=await read('accepted.json');}catch(e){if(e.code!=='ENOENT')throw e;await idle();let request;
      try{request=await read('request.json');}catch(e){if(e.code!=='ENOENT')throw e;request={key:randomUUID(),body:{flowId:smokeId,inputs:{}}};await save('request.json',request);}
      accepted=await api('/executions','POST',request.body,request.key);await save('accepted.json',accepted);}
    console.log(`Three-cluster smoke ${accepted.executionId}`);let execution;const started=Date.now();
    do{execution=await api(`/executions/${accepted.executionId}`);if(['SUCCESS','FAILED','KILLED'].includes(execution.state))break;
      assert(Date.now()-started<600000,'Timeout: inspect existing run; no automatic replacement');await new Promise(r=>setTimeout(r,2000));}while(true);
    const tasks=await api(`/executions/${execution.id}/tasks`),measurement=await api(`/executions/${execution.id}/measurement`),reports=[];
    for(const task of tasks.filter(t=>t.outputs?.['cea-measurement.json']))reports.push({taskRunId:task.id,taskId:task.taskId,iteration:task.iteration,
      report:await api(`/executions/${execution.id}/tasks/${task.id}/output-json?port=cea-measurement.json`)});
    const evaluation=tasks.find(t=>t.taskId==='evaluate'&&t.state==='SUCCESS');
    const metrics=evaluation?await api(`/executions/${execution.id}/tasks/${evaluation.id}/output-json?port=metrics.json`):null;
    await save('smoke.json',{execution,tasks,measurement,reports,metrics});
    assert.equal(execution.state,'SUCCESS');assert.equal(reports.length,9);assert.equal(measurement.status,'AVAILABLE');
    assert.equal(metrics.samples,10000);assert.equal(metrics.round,1);
    assert(Math.abs(intervals(reports.map(p=>p.report)).activeSeconds-measurement.activeSeconds)<1e-8);
    for(const [field,key] of [['inputs','inputBytes'],['outputs','outputBytes']])assert.equal(reports.flatMap(p=>p.report[field]).reduce((n,f)=>n+f.bytes,0),measurement[key]);
    const manifest=await read('raw/manifest.json'),copies=[],jobs=[];
    for(const task of tasks.filter(t=>t.outputs?.['cea-measurement.json'])){
      const edge=['preprocess','train'].includes(task.taskId),cluster=edge?`edge-${'abc'[task.iteration-1]}`:'cloud',name=`cea-${task.id}-a1`;
      assert.match(name,/^cea-[a-f0-9-]{36}-a1$/);
      const job=JSON.parse(execFileSync('docker',['exec',`cea-${cluster}-1`,'kubectl','get','job',name,'-n','cea-lab','-o','json'],{encoding:'utf8'}));
      assert.equal(job.status.succeeded,1);const container=job.spec.template.spec.containers.find(c=>c.name==='task');
      if(task.taskId==='preprocess'){
        assert(container.image.endsWith(published.app.image.slice(published.app.image.indexOf('@'))));
        const env=Object.fromEntries(container.env.map(e=>[e.name,e.value]));assert.equal(env.RAW_DATASET,'cifar10-raw-train/v2');
        assert.equal(reports.find(r=>r.taskRunId===task.id).report.inputs[0].bytes,manifest.shards[task.iteration-1].bytes);
      }
      if(task.taskId==='train'){
        const log=execFileSync('docker',['exec',`cea-${cluster}-1`,'kubectl','logs',`job/${name}`,'-c','task','-n','cea-lab'],{encoding:'utf8'});
        const result=log.split(/\r?\n/).filter(l=>l.startsWith('{')).map(l=>JSON.parse(l)).find(l=>l.clientId);
        assert.equal(result.samples,manifest.shards[task.iteration-1].samples);assert.equal(result.clientId,`${cluster}1`);
      }
      jobs.push({taskRunId:task.id,taskId:task.taskId,cluster,image:container.image});
      if(task.outputs['model.pt']){const uri=new URL(task.outputs['model.pt']),bucket=cluster==='cloud'?'cea-artifacts':`cea-artifacts-${cluster}`;
        assert.equal(uri.protocol,'s3:');assert.equal(uri.hostname,bucket);assert.match(uri.pathname,/^\/[A-Za-z0-9/._-]+$/);
        copies.push({source:`${cluster==='cloud'?'local':cluster}/${bucket}${uri.pathname}`,destination:`par13/models/${task.taskId}-${task.iteration}.pt`});}
    }
    await save('audit.json',{result:'PASS',jobs,copies});console.log('PASS: 9 Jobs/SDK reports; train samples 16667 / 16667 / 16666.');return;
  }
  const executions=await idle();
  for(const flow of before.flows)assert.deepEqual(await api(`/flows/${flow.flowId}`),published.flows.find(f=>f.flowId===flow.flowId)??flow);
  const datasets=await all('/resources/datasets');for(const old of before.datasets)assert.deepEqual(datasets.find(d=>d.datasetId===old.datasetId&&d.version===old.version),old);
  assert.deepEqual(await api('/applications/fl-preprocess/versions/par08-v1'),before.application);
  assert.deepEqual(await api('/resources/datasets/cifar10-raw-train/versions/v2'),published.dataset);
  assert.equal(datasets.length,before.datasets.length+1);assert.equal((await all('/flows')).length,before.flows.length);
  for(const old of before.executions)assert.deepEqual(executions.find(e=>e.id===old.id),old);assert.equal(executions.length,before.executions.length+1);
  for(const flow of published.flows){const response=await fetch(`http://127.0.0.1:18080/api/namespaces/lab/flows/${flow.flowId}`,{headers:{Authorization:authorization}});
    assert.equal(response.status,200);assert.deepEqual(await response.json(),flow);}
  assert.equal((await read('audit.json')).result,'PASS');assert.equal((await read('data-model-audit.json')).result,'PASS');
  assert.equal((await (await fetch(`${base}/health`)).json()).status,'UP');assert.equal((await fetch('http://127.0.0.1:18080/')).status,200);
  await save('after.json',{result:'PASS',verifiedAt:new Date().toISOString(),executionCount:executions.length,services:services()});
  console.log('PASS: deployed data/references visible through 18080; original versions/history retained; 19 services not restarted.');
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await main();
