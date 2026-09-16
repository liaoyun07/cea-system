// FLPAR-14: time the already-published balanced three-client Flow; no configuration writes.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parse} from '../../../frontend/node_modules/yaml/dist/index.js';
import {intervals} from '../parallel-benchmark/run.mjs';

const root=resolve(import.meta.dirname,'../../..'),folder=resolve(root,'.local/cea/par14');
const flowId='par12-fedavg-cifar10-c3-preprocess';
export function summary(rows){
  const formal=rows.filter(r=>!r.warmup),success=formal.filter(r=>r.execution.state==='SUCCESS'&&r.measurement.status==='AVAILABLE');
  const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
  return {attempts:formal.length,success:success.length,meanMBps:mean(success.map(r=>r.measurement.bytesPerSecond/1e6)),
    meanActiveSeconds:mean(success.map(r=>r.measurement.activeSeconds)),meanTotalSeconds:mean(success.map(r=>r.totalSeconds)),
    rows:formal.map(r=>({executionId:r.execution.id,state:r.execution.state,MBps:r.measurement.bytesPerSecond/1e6,
      activeSeconds:r.measurement.activeSeconds,totalSeconds:r.totalSeconds,trainPeak:r.train?.peak}))};
}
async function main(){
  const mode=process.argv[2];assert(['run','audit','verify'].includes(mode));await mkdir(folder,{recursive:true});
  const env=Object.fromEntries((await readFile(resolve(root,'deploy/cea/.env'),'utf8')).split(/\r?\n/).filter(l=>/^[A-Z_0-9]+=/.test(l))
    .map(l=>{const n=l.indexOf('=');return [l.slice(0,n),l.slice(n+1)];}));
  const base=`http://127.0.0.1:${env.CEA_API_PORT}`,Authorization='Basic '+Buffer.from(`${env.BACKEND_USER}:${env.BACKEND_PASSWORD}`).toString('base64');
  async function api(path,method='GET',body,key=randomUUID()){
    const r=await fetch(`${base}/api/namespaces/lab${path}`,{method,headers:{Authorization,'Content-Type':'application/json','Idempotency-Key':key},
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});assert(r.ok,`${method} ${path}: HTTP ${r.status}`);return r.json();}
  const read=name=>readFile(resolve(folder,name),'utf8').then(JSON.parse);
  const save=(name,data)=>writeFile(resolve(folder,name),JSON.stringify(data,null,2),{flag:'wx'});
  async function all(path){const values=[];for(let offset=0;;offset+=100){const page=await api(`${path}?limit=100&offset=${offset}`);values.push(...page);if(page.length<100)return values;}}
  async function idle(){const rows=await all('/executions');assert(rows.every(r=>['SUCCESS','FAILED','KILLED'].includes(r.state)),'Another execution is active');return rows;}
  function services(){const ids=execFileSync('docker',['ps','-q','--filter','label=com.docker.compose.project=cea'],{encoding:'utf8'}).trim().split(/\s+/);
    return JSON.parse(execFileSync('docker',['inspect',...ids],{encoding:'utf8'})).map(c=>({id:c.Id,name:c.Name,image:c.Image,started:c.State.StartedAt})).sort((a,b)=>a.name.localeCompare(b.name));}
  const config=()=>readFile(resolve(root,'deploy/cea/application.yaml'),'utf8');
  const published=JSON.parse(await readFile(resolve(folder,'../par13/published.json'),'utf8'));
  const reference=JSON.parse(await readFile(resolve(folder,'../par13/smoke.json'),'utf8'));
  let before;try{before=await read('before.json');}catch(e){if(e.code!=='ENOENT'||mode!=='run')throw e;
    const executions=await idle(),flows=await Promise.all((await all('/flows')).map(f=>api(`/flows/${f.flowId}`)));
    const flow=flows.find(f=>f.flowId===flowId);assert.deepEqual(flow,published.flows.find(f=>f.flowId===flowId));
    const definition=parse(flow.source);assert.equal(definition.tasks[1].tasks[0].loop.concurrency,3);
    assert.equal(definition.tasks[1].tasks[0].loop.values.value.length,3);assert.equal(definition.inputs.batch_size.defaultValue,1024);
    before={executions,flows,datasets:await all('/resources/datasets'),services:services(),config:await config()};await save('before.json',before);}
  assert.deepEqual(services(),before.services);assert.equal(await config(),before.config);
  if(mode==='run'){
    for(let index=0;index<4;index++){
      try{const prior=await read(`trial-${index}.json`);assert.equal(prior.execution.state,'SUCCESS','Recorded failure; do not replace');continue;}catch(e){if(e.code!=='ENOENT')throw e;}
      assert.deepEqual(await api(`/flows/${flowId}`),before.flows.find(f=>f.flowId===flowId));let accepted;
      try{accepted=await read(`accepted-${index}.json`);}catch(e){if(e.code!=='ENOENT')throw e;await idle();let request;
        try{request=await read(`request-${index}.json`);}catch(e){if(e.code!=='ENOENT')throw e;request={key:randomUUID(),body:{flowId,inputs:{}}};await save(`request-${index}.json`,request);}
        accepted=await api('/executions','POST',request.body,request.key);await save(`accepted-${index}.json`,accepted);}
      console.log(`${index===0?'Warmup':`Formal ${index}/3`}: ${accepted.executionId}`);let execution;const start=Date.now();
      do{execution=await api(`/executions/${accepted.executionId}`);if(['SUCCESS','FAILED','KILLED'].includes(execution.state))break;
        assert(Date.now()-start<600000,'Timeout: inspect existing execution, no automatic replacement');await new Promise(r=>setTimeout(r,2000));}while(true);
      const tasks=await api(`/executions/${execution.id}/tasks`),measurement=await api(`/executions/${execution.id}/measurement`),reports=[];
      for(const task of tasks.filter(t=>t.outputs?.['cea-measurement.json']))reports.push({taskRunId:task.id,taskId:task.taskId,iteration:task.iteration,
        report:await api(`/executions/${execution.id}/tasks/${task.id}/output-json?port=cea-measurement.json`)});
      const evaluation=tasks.find(t=>t.taskId==='evaluate'&&t.state==='SUCCESS');
      const metrics=evaluation?await api(`/executions/${execution.id}/tasks/${evaluation.id}/output-json?port=metrics.json`):null;
      const result={index,warmup:index===0,execution,tasks,measurement,reports,metrics,
        totalSeconds:(Date.parse(execution.endedAt)-Date.parse(execution.createdAt))/1000,train:intervals(reports.filter(p=>p.taskId==='train').map(p=>p.report))};
      await save(`trial-${index}.json`,result);console.log(`${execution.state}: ${(measurement.bytesPerSecond/1e6).toFixed(2)} MB/s, SDK ${measurement.activeSeconds}s, total ${result.totalSeconds}s, train peak ${result.train.peak}`);
      assert.equal(execution.state,'SUCCESS','Failure retained; stop without replacing');assert.equal(reports.length,9);assert.equal(measurement.status,'AVAILABLE');assert.deepEqual(metrics,reference.metrics);
      for(const entry of reports){const expected=reference.reports.find(p=>p.taskId===entry.taskId&&p.iteration===entry.iteration).report;
        assert.deepEqual(entry.report.inputs,expected.inputs);assert.deepEqual(entry.report.outputs,expected.outputs);}
      for(const [field,key] of [['inputs','inputBytes'],['outputs','outputBytes']])assert.equal(reports.flatMap(p=>p.report[field]).reduce((n,f)=>n+f.bytes,0),measurement[key]);
      assert(Math.abs(intervals(reports.map(p=>p.report)).activeSeconds-measurement.activeSeconds)<1e-8);
    }
    const rows=await Promise.all([0,1,2,3].map(n=>read(`trial-${n}.json`))),result=summary(rows);await save('summary.json',result);console.log(JSON.stringify(result,null,2));return;
  }
  const rows=await Promise.all([0,1,2,3].map(n=>read(`trial-${n}.json`)));assert(rows.every(r=>r.execution.state==='SUCCESS'));
  if(mode==='audit'){
    const jobs=[],copies=[],warnings=[];
    const refAudit=JSON.parse(await readFile(resolve(folder,'../par13/audit.json'),'utf8'));
    for(const row of rows)for(const cluster of ['cloud','edge-a','edge-b','edge-c']){
      const leaves=row.tasks.filter(t=>t.outputs?.['cea-measurement.json']&&(['preprocess','train'].includes(t.taskId)?`edge-${'abc'[t.iteration-1]}`:'cloud')===cluster);
      const names=leaves.map(t=>`cea-${t.id}-a1`);for(const name of names)assert.match(name,/^cea-[a-f0-9-]{36}-a1$/);
      const get=(kind,args)=>JSON.parse(execFileSync('docker',['exec',`cea-${cluster}-1`,'kubectl','get',kind,...args,'-n','cea-lab','-o','json'],{encoding:'utf8',maxBuffer:20*1024*1024})).items;
      const actual=get('jobs',names),pods=get('pods',['-l',`job-name in (${names.join(',')})`]);assert.equal(actual.length,leaves.length);assert.equal(pods.length,leaves.length);
      const podNames=new Set(pods.map(p=>p.metadata.name));for(const e of get('events',[]).filter(e=>e.type==='Warning'&&podNames.has(e.involvedObject?.name)))warnings.push({index:row.index,cluster,reason:e.reason,count:e.count??1});
      for(const task of leaves){const job=actual.find(j=>j.metadata.name===`cea-${task.id}-a1`),pod=pods.find(p=>p.metadata.labels['job-name']===job.metadata.name);
        assert.equal(job.status.succeeded,1);assert.equal(pod.status.phase,'Succeeded');const main=job.spec.template.spec.containers.find(c=>c.name==='task');
        assert.equal(main.image,refAudit.jobs.find(j=>j.taskId===task.taskId&&j.cluster===cluster).image);
        for(const s of [...pod.status.initContainerStatuses,...pod.status.containerStatuses]){assert.equal(s.restartCount,0);assert.equal(s.state.terminated.exitCode,0);}
        if(task.taskId==='train'){const log=execFileSync('docker',['exec',`cea-${cluster}-1`,'kubectl','logs',`job/${job.metadata.name}`,'-n','cea-lab','-c','task'],{encoding:'utf8'});
          const output=log.split(/\r?\n/).filter(l=>l.startsWith('{')).map(l=>JSON.parse(l)).find(l=>l.clientId);assert.equal(output.samples,[16667,16667,16666][task.iteration-1]);}
        jobs.push({index:row.index,taskRunId:task.id,taskId:task.taskId,cluster,image:main.image});
        if(task.outputs['model.pt']){const uri=new URL(task.outputs['model.pt']),bucket=cluster==='cloud'?'cea-artifacts':`cea-artifacts-${cluster}`;
          assert.equal(uri.protocol,'s3:');assert.equal(uri.hostname,bucket);assert.match(uri.pathname,/^\/[A-Za-z0-9/._-]+$/);
          copies.push({source:`${cluster==='cloud'?'local':cluster}/${bucket}${uri.pathname}`,destination:`par14/models/${row.index}/${task.taskId}-${task.iteration}.pt`});}
      }
    }
    assert.equal(jobs.length,36);assert.equal(copies.length,20);await save('audit.json',{result:'PASS',jobs,copies,warnings});console.log(`PASS: 36 Jobs/SDK, 20 model references, ${warnings.length} startup warnings.`);return;
  }
  const executions=await idle();for(const old of before.executions)assert.deepEqual(executions.find(e=>e.id===old.id),old);
  assert.equal(executions.length,before.executions.length+4);assert.equal((await all('/flows')).length,before.flows.length);
  for(const flow of before.flows)assert.deepEqual(await api(`/flows/${flow.flowId}`),flow);assert.deepEqual(await all('/resources/datasets'),before.datasets);
  assert.equal((await read('audit.json')).result,'PASS');assert.equal((await read('models-audit.json')).result,'PASS');
  const ui=await fetch(`http://127.0.0.1:18080/api/namespaces/lab/executions/${rows[3].execution.id}/measurement`,{headers:{Authorization}});
  assert.equal(ui.status,200);assert.deepEqual(await ui.json(),rows[3].measurement);
  assert.equal((await (await fetch(`${base}/health`)).json()).status,'UP');assert.equal((await fetch('http://127.0.0.1:18080/')).status,200);
  await save('after.json',{result:'PASS',executionCount:executions.length,verifiedAt:new Date().toISOString(),services:services()});console.log('PASS: existing Flows/data/history/capacity/services unchanged; 4 new executions visible in CEA.');
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await main();
