// FLPAR-12: reduce clients using existing shards, images, SDK and execution APIs.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir, stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parse, stringify} from '../../../frontend/node_modules/yaml/dist/index.js';
import {intervals} from '../parallel-benchmark/run.mjs';

const root=resolve(import.meta.dirname,'../../..'),folder=resolve(root,'.local/cea/par12');
const baselineId='par10-fedavg-cifar10-c18-preprocess';
export const sequence=[1,2,3,1,2,3,2,3,1,3,1,2].map((clients,index)=>({clients,warmup:index<3,index}));
export function reduced(source,clients){
  assert([1,2,3].includes(clients));
  const original=parse(source),flow=structuredClone(original),loop=flow.tasks[1].tasks[0].loop;
  assert.equal(original.id,baselineId);assert.equal(loop.concurrency,18);assert.equal(loop.values.value.length,18);
  assert.equal(flow.tasks[1].repeat.iterations.value,1);assert.equal(flow.inputs.batch_size.defaultValue,1024);
  loop.values.value=loop.values.value.slice(0,clients);loop.concurrency=clients;
  assert.deepEqual(loop.values.value,Array.from({length:clients},(_,i)=>({id:`edge-${'abc'[i]}1`,clusters:[`edge-${'abc'[i]}`]})));
  flow.id=`par12-fedavg-cifar10-c${clients}-preprocess`;
  flow.description=`FLPAR-12: ${clients} clients, original edge shards; reduced total load, not fixed-total-data speedup`;
  flow.labels={...flow.labels,benchmark:'FLPAR-12'};
  const proof=structuredClone(flow);
  for(const key of ['id','description','labels']){if(Object.hasOwn(original,key))proof[key]=original[key];else delete proof[key];}
  proof.tasks[1].tasks[0].loop=original.tasks[1].tasks[0].loop;assert.deepEqual(proof,original);
  return flow;
}
const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
export function summarize(rows){return [1,2,3].map(clients=>{
  const attempts=rows.filter(r=>r.clients===clients&&!r.warmup),success=attempts.filter(r=>r.execution.state==='SUCCESS'&&r.measurement.status==='AVAILABLE');
  return {clients,processedSamples:[8333,25000,50000][clients-1],attempts:attempts.length,success:success.length,
    meanSeconds:mean(success.map(r=>r.endToEndSeconds)),meanActiveSeconds:mean(success.map(r=>r.measurement.activeSeconds)),
    meanMBps:mean(success.map(r=>r.measurement.bytesPerSecond/1e6)),
    inputBytes:success.map(r=>r.measurement.inputBytes),outputBytes:success.map(r=>r.measurement.outputBytes),
    trainPeaks:success.map(r=>r.trainParallel.peak),rates:success.map(r=>r.measurement.bytesPerSecond/1e6),
    trainMeanSeconds:mean(success.flatMap(r=>r.reports.filter(p=>p.taskId==='train').map(p=>p.report.durationNs/1e9))),
    executionIds:attempts.map(r=>r.execution.id)};
});}

async function main(){
  const mode=process.argv[2];assert(['capture','register','run','summary','audit','verify'].includes(mode));
  await mkdir(folder,{recursive:true});
  const settings=Object.fromEntries((await readFile(resolve(root,'deploy/cea/.env'),'utf8')).split(/\r?\n/)
    .filter(l=>/^[A-Z_0-9]+=/.test(l)).map(l=>{const n=l.indexOf('=');return [l.slice(0,n),l.slice(n+1)];}));
  const base=`http://127.0.0.1:${settings.CEA_API_PORT}`;
  const authorization='Basic '+Buffer.from(`${settings.BACKEND_USER}:${settings.BACKEND_PASSWORD}`).toString('base64');
  async function api(path,method='GET',body,key=randomUUID()){
    const r=await fetch(`${base}/api/namespaces/lab${path}`,{method,headers:{Authorization:authorization,'Content-Type':'application/json','Idempotency-Key':key},
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
    assert(r.ok,`${method} ${path}: HTTP ${r.status}`);return r.json();
  }
  const read=name=>readFile(resolve(folder,name),'utf8').then(JSON.parse);
  const save=(name,value)=>writeFile(resolve(folder,name),JSON.stringify(value,null,2),{flag:'wx'});
  async function all(path){const rows=[];for(let offset=0;;offset+=100){const page=await api(`${path}?limit=100&offset=${offset}`);rows.push(...page);if(page.length<100)return rows;}}
  async function idle(){const rows=await all('/executions');assert(rows.every(e=>['SUCCESS','FAILED','KILLED'].includes(e.state)),'Active execution; do not mix workloads');return rows;}
  function services(){const ids=execFileSync('docker',['ps','-q','--filter','label=com.docker.compose.project=cea'],{encoding:'utf8'}).trim().split(/\s+/);
    return JSON.parse(execFileSync('docker',['inspect',...ids],{encoding:'utf8'})).map(c=>({id:c.Id,name:c.Name,image:c.Image,started:c.State.StartedAt,
      cpus:c.HostConfig.NanoCpus,memory:c.HostConfig.Memory})).sort((a,b)=>a.name.localeCompare(b.name));}
  const config=()=>readFile(resolve(root,'deploy/cea/application.yaml'),'utf8');
  if(mode==='capture'){
    const executions=await idle(),flows=await Promise.all((await all('/flows')).map(f=>api(`/flows/${f.flowId}`)));
    assert(flows.some(f=>f.flowId===baselineId));assert(!flows.some(f=>f.flowId.startsWith('par12-')));
    const configuration=await config(),p=parse(configuration).platform;
    assert.equal(p.worker.concurrency,24);for(const edge of ['edge-a','edge-b','edge-c'])assert.equal(p.jobs.slots.lab[edge],6);
    await save('before.json',{executions,flows,datasets:await all('/resources/datasets'),services:services(),config:configuration});
    console.log(`Captured ${executions.length} terminal executions / ${flows.length} Flows; no service changes.`);return;
  }
  const before=await read('before.json');
  const preserved=async()=>{assert.deepEqual(services(),before.services);assert.equal(await config(),before.config);
    assert.deepEqual(parse(execFileSync('docker',['exec','cea-backend-1','cat','/config/application.yaml'],{encoding:'utf8'})),parse(before.config));};
  await preserved();
  if(mode==='register'){
    await idle();const source=before.flows.find(f=>f.flowId===baselineId).source;
    const registered=[];
    for(const clients of [1,2,3]){const flow=reduced(source,clients),sourceText=stringify(flow);
      const existing=(await all('/flows')).find(f=>f.flowId===flow.id);
      if(existing)assert.equal((await api(`/flows/${flow.id}`)).source,sourceText,'Never overwrite an existing Flow');
      else{await api(`/flows/${flow.id}/validate`,'POST',{source:sourceText});await api(`/flows/${flow.id}/revisions`,'POST',{source:sourceText,expectedRevision:0});}
      registered.push(await api(`/flows/${flow.id}`));
    }
    await save('registered.json',registered);console.log('Registered three isolated 1/2/3-client Flows; algorithms, datasets and original Flows unchanged.');return;
  }
  if(mode==='run'){
    const registered=await read('registered.json');
    for(const planned of sequence){const {index,clients,warmup}=planned;let accepted;
      try{const prior=await read(`trial-${index}.json`);assert.equal(prior.execution.state,'SUCCESS','Failure retained; inspect before continuing');continue;}
      catch(e){if(e.code!=='ENOENT')throw e;}
      await preserved();const flow=registered.find(f=>f.flowId===`par12-fedavg-cifar10-c${clients}-preprocess`);
      assert.deepEqual(await api(`/flows/${flow.flowId}`),flow);
      try{accepted=await read(`accepted-${index}.json`);}catch(e){if(e.code!=='ENOENT')throw e;
        await idle();let request;
        try{request=await read(`request-${index}.json`);}catch(e){if(e.code!=='ENOENT')throw e;request={key:randomUUID(),body:{flowId:flow.flowId,inputs:{}}};await save(`request-${index}.json`,request);}
        accepted=await api('/executions','POST',request.body,request.key);await save(`accepted-${index}.json`,accepted);
      }
      console.log(`${index+1}/12 ${clients} clients ${warmup?'warmup':'formal'} ${accepted.executionId}`);
      let execution;const started=Date.now();
      do{execution=await api(`/executions/${accepted.executionId}`);if(['SUCCESS','FAILED','KILLED'].includes(execution.state))break;
        assert(Date.now()-started<600000,'Timeout: inspect existing run; do not replace or cancel');await new Promise(r=>setTimeout(r,2000));}while(true);
      const tasks=await api(`/executions/${execution.id}/tasks`),measurement=await api(`/executions/${execution.id}/measurement`),reports=[];
      for(const task of tasks.filter(t=>t.state==='SUCCESS'&&t.outputs?.['cea-measurement.json']))reports.push({taskRunId:task.id,taskId:task.taskId,iteration:task.iteration,
        report:await api(`/executions/${execution.id}/tasks/${task.id}/output-json?port=cea-measurement.json`)});
      const evaluation=tasks.find(t=>t.taskId==='evaluate'&&t.state==='SUCCESS');
      const metrics=evaluation?await api(`/executions/${execution.id}/tasks/${evaluation.id}/output-json?port=metrics.json`):null;
      const result={...planned,execution,tasks,measurement,reports,metrics,endToEndSeconds:(Date.parse(execution.endedAt)-Date.parse(execution.createdAt))/1000};
      if(execution.state==='SUCCESS'){result.trainParallel=intervals(reports.filter(r=>r.taskId==='train').map(r=>r.report));result.allParallel=intervals(reports.map(r=>r.report));}
      await save(`trial-${index}.json`,result);
      console.log(`${execution.state}; ${result.endToEndSeconds}s; ${measurement.status==='AVAILABLE'?`${(measurement.bytesPerSecond/1e6).toFixed(2)} MB/s; SDK ${measurement.activeSeconds.toFixed(3)}s; train peak ${result.trainParallel.peak}`:measurement.status}`);
      assert.equal(execution.state,'SUCCESS','Failure retained; stop without replacement');assert.equal(reports.length,2*clients+3);assert.equal(measurement.status,'AVAILABLE');
      assert.equal(metrics.samples,10000);assert.equal(metrics.round,1);
      assert(Math.abs(result.allParallel.activeSeconds-measurement.activeSeconds)<1e-8);
      for(const [field,key] of [['inputs','inputBytes'],['outputs','outputBytes']])assert.equal(reports.flatMap(p=>p.report[field]).reduce((s,f)=>s+f.bytes,0),measurement[key]);
    }return;
  }
  const rows=[];for(const {index} of sequence){try{rows.push(await read(`trial-${index}.json`));}catch(e){if(e.code!=='ENOENT')throw e;}}
  if(mode==='summary'){const result=summarize(rows);await save('summary.json',result);console.log(JSON.stringify(result,null,2));return;}
  assert.equal(rows.length,12);assert(rows.every(r=>r.execution.state==='SUCCESS'));
  if(mode==='audit'){
    const images=JSON.parse(await readFile(resolve(folder,'../par08/images.json'),'utf8'));
    const reference=JSON.parse(await readFile(resolve(folder,'../par11/trial-1.json'),'utf8'));
    const audited=[],copies=[],launchWarnings=[];
    for(const row of rows){const jobs=[];
      for(const cluster of ['cloud','edge-a','edge-b','edge-c']){
        const leaves=row.tasks.filter(t=>['init','preprocess','train','aggregate','evaluate'].includes(t.taskId)&&
          (['preprocess','train'].includes(t.taskId)?`edge-${'abc'[t.iteration-1]}`:'cloud')===cluster);if(!leaves.length)continue;
        const names=leaves.map(t=>`cea-${t.id}-a1`);for(const name of names)assert.match(name,/^cea-[a-f0-9-]{36}-a1$/);
        const get=(kind,args)=>JSON.parse(execFileSync('docker',['exec',`cea-${cluster}-1`,'kubectl','get',kind,...args,'-n','cea-lab','-o','json'],{encoding:'utf8',maxBuffer:20*1024*1024})).items;
        const actualJobs=get('jobs',names),pods=get('pods',['-l',`job-name in (${names.join(',')})`]);
        assert.equal(actualJobs.length,leaves.length);assert.equal(pods.length,leaves.length);
        const podNames=new Set(pods.map(p=>p.metadata.name));
        for(const e of get('events',[]).filter(e=>e.type==='Warning'&&podNames.has(e.involvedObject?.name)))launchWarnings.push({index:row.index,cluster,pod:e.involvedObject.name,reason:e.reason,count:e.count??1});
        for(const task of leaves){const name=`cea-${task.id}-a1`,job=actualJobs.find(j=>j.metadata.name===name),pod=pods.find(p=>p.metadata.labels['job-name']===name);
          assert.equal(job.status.succeeded,1);assert.equal(pod.status.phase,'Succeeded');assert.equal(job.spec.suspend,false);assert(!job.metadata.annotations?.['cea.platform/files-pending']);
          const main=job.spec.template.spec.containers.find(c=>c.name==='task'),key=['preprocess','train'].includes(task.taskId)?'preprocess':'federated';
          assert(main.image.endsWith(images[key].slice(images[key].indexOf('@'))));
          const statuses=[...pod.status.initContainerStatuses,...pod.status.containerStatuses];assert.equal(statuses.length,3);
          for(const status of statuses){assert.equal(status.state.terminated.exitCode,0);assert.equal(status.restartCount,0);}
          const report=row.reports.find(r=>r.taskRunId===task.id).report;
          if(['preprocess','train'].includes(task.taskId)){
            const prior=reference.reports.find(r=>r.taskId===task.taskId&&r.iteration===task.iteration).report;
            assert.deepEqual(report.inputs,prior.inputs);assert.deepEqual(report.outputs,prior.outputs);
            if(task.taskId==='preprocess')assert.equal(report.inputs[0].bytes,(await stat(resolve(folder,`../par05/raw/${cluster}.pt`))).size);
            if(task.taskId==='train'){const env=Object.fromEntries(main.env.map(e=>[e.name,e.value]));
              assert.equal(env.CLIENT_ID,`${cluster}1`);assert.equal(env.BATCH_SIZE,'1024');assert.equal(env.LOCAL_EPOCHS,'1');assert.equal(env.LEARNING_RATE,'0.01');assert(!('DATASET' in env));}
          }
          jobs.push({taskRunId:task.id,taskId:task.taskId,item:task.iteration,cluster,image:main.image,jobCreatedAt:job.metadata.creationTimestamp,createdAt:pod.metadata.creationTimestamp,
            containers:statuses.map(s=>({name:s.name,...s.state.terminated}))});
          if(task.outputs['model.pt']){const uri=new URL(task.outputs['model.pt']),bucket=cluster==='cloud'?'cea-artifacts':`cea-artifacts-${cluster}`;
            assert.equal(uri.protocol,'s3:');assert.equal(uri.hostname,bucket);assert.match(uri.pathname,/^\/[A-Za-z0-9/._-]+$/);
            copies.push({source:`${cluster==='cloud'?'local':cluster}/${bucket}${uri.pathname}`,destination:`par12/models/${row.index}/${task.taskId}-${task.iteration}.pt`});}
        }
      }
      assert.equal(jobs.length,2*row.clients+3);audited.push({index:row.index,clients:row.clients,executionId:row.execution.id,jobs});
    }
    assert.equal(copies.length,48);assert.equal(audited.reduce((n,r)=>n+r.jobs.length,0),84);
    await save('audit.json',{result:'PASS',rows:audited,copies,launchWarnings});console.log(`PASS: 84 Jobs/SDK reports; 48 models to audit; ${launchWarnings.length} startup warnings.`);return;
  }
  await idle();for(const flow of before.flows)assert.deepEqual(await api(`/flows/${flow.flowId}`),flow);
  assert.deepEqual(await all('/resources/datasets'),before.datasets);
  const executions=await all('/executions');for(const old of before.executions)assert.deepEqual(executions.find(e=>e.id===old.id),old);
  assert.equal(executions.length,before.executions.length+12);assert.equal((await all('/flows')).length,before.flows.length+3);
  assert.equal((await read('audit.json')).result,'PASS');assert.equal((await read('models-audit.json')).result,'PASS');
  for(const flow of await read('registered.json')){
    const response=await fetch(`http://127.0.0.1:18080/api/namespaces/lab/flows/${flow.flowId}`,{headers:{Authorization:authorization},signal:AbortSignal.timeout(30000)});
    assert.equal(response.status,200);assert.deepEqual(await response.json(),flow);
  }
  assert.equal((await (await fetch(`${base}/health`)).json()).status,'UP');assert.equal((await fetch('http://127.0.0.1:18080/')).status,200);
  await save('after.json',{result:'PASS',verifiedAt:new Date().toISOString(),executionCount:executions.length,services:services()});
  console.log('PASS: original objects, capacity and all services unchanged; three new Flows visible through 18080.');
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await main();
