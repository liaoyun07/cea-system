// FLPAR-09/10 capacity experiments and FLPAR-11 startup repair: fixed workloads, local evidence.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {execFileSync, spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {parse, stringify} from '../../../frontend/node_modules/yaml/dist/index.js';
import {intervals} from '../parallel-benchmark/run.mjs';

const batch=process.argv[3]??'par09';assert(['par09','par10','par11'].includes(batch));
const repaired=batch==='par11',expanded=batch!=='par09',count=expanded?18:9,runs=batch==='par10'?1:4;
const root=resolve(import.meta.dirname,'../../..'), folder=resolve(root,`.local/cea/${batch}`);
const mode=process.argv[2];assert(['capture','register','check-config','run','summary','verify'].includes(mode));
const originalId='par08-fedavg-cifar10-c9-preprocess';
const flowId=expanded?'par10-fedavg-cifar10-c18-preprocess':originalId;
const settings=Object.fromEntries((await readFile(resolve(root,'deploy/cea/.env'),'utf8')).split(/\r?\n/)
  .filter(l=>/^[A-Z_0-9]+=/.test(l)).map(l=>{const n=l.indexOf('=');return [l.slice(0,n),l.slice(n+1)];}));
const base=`http://127.0.0.1:${settings.CEA_API_PORT}`;
const authorization=`Basic ${Buffer.from(`${settings.BACKEND_USER}:${settings.BACKEND_PASSWORD}`).toString('base64')}`;
const read=name=>readFile(resolve(folder,name),'utf8').then(JSON.parse);
const save=(name,value)=>writeFile(resolve(folder,name),JSON.stringify(value,null,2),{flag:'wx'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await mkdir(folder,{recursive:true});
async function api(path,method='GET',body){
  const r=await fetch(`${base}/api/namespaces/lab${path}`,{method,headers:{Authorization:authorization,'Content-Type':'application/json','Idempotency-Key':randomUUID()},
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
  assert(r.ok,`${method} ${path}: ${r.status}`);return r.json();
}
async function all(path){const rows=[];for(let offset=0;;offset+=100){const page=await api(`${path}?limit=100&offset=${offset}`);rows.push(...page);if(page.length<100)return rows;}}
async function idle(){const rows=await all('/executions');assert(rows.every(e=>['SUCCESS','FAILED','KILLED'].includes(e.state)),'Active execution; do not restart or mix workload');return rows;}
function services(){const ids=execFileSync('docker',['ps','-q','--filter','label=com.docker.compose.project=cea'],{encoding:'utf8'}).trim().split(/\s+/);
  return JSON.parse(execFileSync('docker',['inspect',...ids],{encoding:'utf8'})).map(c=>({id:c.Id,name:c.Name,image:c.Image,started:c.State.StartedAt})).sort((a,b)=>a.name.localeCompare(b.name));}
const config=()=>readFile(resolve(root,'deploy/cea/application.yaml'),'utf8');
if(mode==='capture'){
  const executions=await idle(),flows=await Promise.all((await all('/flows')).map(f=>api(`/flows/${f.flowId}`)));
  const flow=parse(flows.find(f=>f.flowId===originalId).source),loop=flow.tasks[1].tasks[0].loop;
  assert.equal(loop.concurrency,9);assert.equal(loop.values.value.length,9);
  assert.equal(flow.inputs.batch_size.defaultValue,1024);assert.equal(flow.tasks[1].repeat.iterations.value,1);
  const original=await config();assert.equal(parse(original).platform.worker.concurrency,repaired?24:expanded?12:4);
  assert(repaired||!expanded||!flows.some(f=>f.flowId===flowId),'Do not overwrite an existing experiment Flow');
  await save('before.json',{executions,flows,datasets:await all('/resources/datasets'),services:services(),config:original});
  await writeFile(resolve(folder,'application-before.yaml'),original,{flag:'wx'});
  console.log(`Captured ${executions.length} terminal executions / ${flows.length} Flows / original capacity.`);
}else{
  const before=await read('before.json'),expected=parse(before.config);
  expected.platform.worker.concurrency=expanded?24:12;
  for(const id of ['edge-a','edge-b','edge-c'])expected.platform.jobs.slots.lab[id]=expanded?6:3;
  assert.deepEqual(parse(await config()),expected,'Only the authorized concurrency values may change');
  if(mode==='check-config'){await idle();console.log(`PASS: Worker${expected.platform.worker.concurrency}, edge slots${expected.platform.jobs.slots.lab['edge-a']} each, cloud2; no other configuration changes.`);}
  else if(mode==='register'){
    assert(expanded&&!repaired);await idle();
    const original=before.flows.find(f=>f.flowId===originalId);assert.deepEqual(await api(`/flows/${originalId}`),original);
    const old=parse(original.source),flow=structuredClone(old),loop=flow.tasks[1].tasks[0].loop;
    assert.equal(loop.values.source,'LITERAL');assert.equal(loop.concurrency,9);assert.equal(loop.values.value.length,9);
    loop.values.value=Array.from({length:count},(_,i)=>({id:`edge-${'abc'[i%3]}${Math.floor(i/3)+1}`,clusters:[`edge-${'abc'[i%3]}`]}));
    loop.concurrency=count;flow.id=flowId;flow.labels={...flow.labels,benchmark:'FLPAR-10'};
    flow.description='FLPAR-10: 18 clients, six per edge, repeated unchanged shards; one round';
    // Prove all executable fields other than Loop values/concurrency are unchanged.
    const proof=structuredClone(flow);proof.id=old.id;proof.labels=old.labels;proof.description=old.description;
    proof.tasks[1].tasks[0].loop=old.tasks[1].tasks[0].loop;assert.deepEqual(proof,old);
    for(const cluster of ['edge-a','edge-b','edge-c'])assert.equal(loop.values.value.filter(v=>v.clusters[0]===cluster).length,6);
    const source=stringify(flow);await api(`/flows/${flowId}/validate`,'POST',{source});
    await api(`/flows/${flowId}/revisions`,'POST',{source,expectedRevision:0});
    const registered=await api(`/flows/${flowId}`);
    await save('registered.json',registered);console.log(`Registered ${flowId}: Loop18, six clients per edge; all other behavior unchanged.`);
  }
  else if(mode==='run'){
    for(let i=0;i<runs;i++){
      try{const previous=await read(`trial-${i}.json`);assert.equal(previous.execution.state,'SUCCESS','Failure retained; do not replace it');continue;}
      catch(e){if(e.code!=='ENOENT')throw e;}
      await idle();
      const currentFlow=await api(`/flows/${flowId}`),savedFlow=expanded&&!repaired?await read('registered.json'):before.flows.find(f=>f.flowId===flowId);
      assert(Math.abs(Date.parse(currentFlow.createdAt)-Date.parse(savedFlow.createdAt))<=1,'Creation time must match DB precision');
      assert.deepEqual(currentFlow,{...savedFlow,createdAt:currentFlow.createdAt});
      const deployed=parse(execFileSync('docker',['exec','cea-backend-1','cat','/config/application.yaml'],{encoding:'utf8'}));
      assert.deepEqual(deployed,expected,'Mounted CEA configuration must match the tested capacity');
      const directory=resolve(folder,`run-${i}`);await mkdir(directory,{recursive:true});
      const observer=observe(directory);let accepted;
      try{
        try{accepted=await read(`accepted-${i}.json`);}catch(e){if(e.code!=='ENOENT')throw e;
          accepted=await api('/executions','POST',{flowId,inputs:{}});await save(`accepted-${i}.json`,accepted);}
        console.log(`${batch==='par10'?'Single 18-client trial':i===0?'Warmup':`Formal ${i}`}: ${accepted.executionId}`);
        const started=Date.now();let execution;
        do{execution=await api(`/executions/${accepted.executionId}`);if(['SUCCESS','FAILED','KILLED'].includes(execution.state))break;
          assert(Date.now()-started<600000,'Timed out; inspect existing execution, no auto retry/cancellation');await sleep(2000);}while(true);
        const tasks=await api(`/executions/${execution.id}/tasks`),measurement=await api(`/executions/${execution.id}/measurement`),reports=[];
        for(const task of tasks.filter(t=>t.state==='SUCCESS'&&t.outputs?.['cea-measurement.json']))
          reports.push({taskRunId:task.id,taskId:task.taskId,iteration:task.iteration,report:await api(`/executions/${execution.id}/tasks/${task.id}/output-json?port=cea-measurement.json`)});
        const evaluation=tasks.find(t=>t.taskId==='evaluate'&&t.state==='SUCCESS');
        const metrics=evaluation?await api(`/executions/${execution.id}/tasks/${evaluation.id}/output-json?port=metrics.json`):null;
        const result={execution,tasks,measurement,reports,metrics,warmup:batch!=='par10'&&i===0,
          endToEndSeconds:(Date.parse(execution.endedAt)-Date.parse(execution.createdAt))/1000};
        if(execution.state==='SUCCESS'){result.trainParallel=intervals(reports.filter(r=>r.taskId==='train').map(r=>r.report));result.allParallel=intervals(reports.map(r=>r.report));}
        await save(`trial-${i}.json`,result);
        console.log(`${execution.state}; ${measurement.status==='AVAILABLE'?`${(measurement.bytesPerSecond/1e6).toFixed(2)} MB/s; train peak ${result.trainParallel.peak}, mean ${result.trainParallel.meanParallel.toFixed(2)}`:'measurement unavailable'}`);
        assert.equal(execution.state,'SUCCESS','Failure retained: stop and inspect, no replacement sample');assert.equal(reports.length,2*count+3);
        if(!expanded){assert.equal(measurement.inputBytes,2461900839);assert.equal(measurement.outputBytes,1863001240);
          assert.equal(metrics.accuracy,.2124);assert(Math.abs(metrics.loss-2.2279879444122312)<1e-9);}
        else {
          const reference=JSON.parse(await readFile(resolve(folder,'../par09/trial-3.json'),'utf8'));
          for(const stage of ['preprocess','train'])for(let item=1;item<=count;item++){
            const current=reports.find(r=>r.taskId===stage&&r.iteration===item).report;
            const prior=reference.reports.find(r=>r.taskId===stage&&r.iteration===(item-1)%9+1).report;
            assert.deepEqual(current.inputs,prior.inputs,'Each client consumes the same complete shard/model');
            assert.deepEqual(current.outputs,prior.outputs,'Each client produces the same complete output sizes');
          }
          assert.equal(metrics.accuracy,.2124); // Exact model/aggregation check is performed after timing.
        }
        assert(Math.abs(result.allParallel.activeSeconds-measurement.activeSeconds)<1e-8);
      }finally{await observer.stop();}
    }
  }else if(mode==='summary'){
    const rows=[];for(let i=0;i<runs;i++){try{rows.push(await read(`trial-${i}.json`));}catch(e){if(e.code!=='ENOENT')throw e;}}
    const formal=rows.filter(r=>!r.warmup),success=formal.filter(r=>r.execution.state==='SUCCESS');
    const summary={attempts:formal.length,success:success.length,meanMBps:success.length?success.reduce((s,r)=>s+r.measurement.bytesPerSecond/1e6,0)/success.length:null,
      runs:rows.map(r=>({id:r.execution.id,warmup:r.warmup,state:r.execution.state,endToEndSeconds:r.endToEndSeconds,measurement:r.measurement,trainParallel:r.trainParallel,allParallel:r.allParallel}))};
    await save('summary.json',summary);console.log(JSON.stringify(summary,null,2));
  }else{
    const current=services();assert.equal(current.length,before.services.length);
    for(const old of before.services){const value=current.find(c=>c.name===old.name);assert(value);
      if(repaired&&['/cea-backend-1','/cea-cloud-1','/cea-edge-a-1','/cea-edge-b-1','/cea-edge-c-1'].includes(old.name))continue;
      assert.equal(value.id,old.id);assert.equal(value.image,old.image);
      if(old.name!=='/cea-backend-1')assert.equal(value.started,old.started);}
    for(const f of before.flows)assert.deepEqual(await api(`/flows/${f.flowId}`),f);
    assert.deepEqual(await all('/resources/datasets'),before.datasets);const executions=await idle();
    for(const old of before.executions)assert.deepEqual(executions.find(e=>e.id===old.id),old);
    if(expanded){
      assert.equal(executions.length,before.executions.length+runs);
      assert.equal((await all('/flows')).length,before.flows.length+(repaired?0:1));
      const registered=repaired?before.flows.find(f=>f.flowId===flowId):await read('registered.json'),currentFlow=await api(`/flows/${flowId}`);
      assert.deepEqual(currentFlow,{...registered,createdAt:currentFlow.createdAt});
      assert.equal((await read('audit.json')).result,'PASS');
      assert.equal((await read('models-audit.json')).result,'PASS');
      const visible=await fetch(`http://127.0.0.1:18080/api/namespaces/lab/flows/${flowId}`,{headers:{Authorization:authorization}});
      assert.equal(visible.status,200);assert.equal((await visible.json()).source,currentFlow.source);
    }
    assert.equal((await (await fetch(`${base}/health`)).json()).status,'UP');assert.equal((await fetch('http://127.0.0.1:18080/')).status,200);
    await save('after.json',{result:'PASS',verifiedAt:new Date().toISOString(),services:current,executionCount:executions.length});
    console.log(`PASS: all old objects preserved; only ${repaired?'backend and four K3s':'backend'} restarted; UI/API healthy.`);
  }
}

// Same bounded Pod/log capture approach as FLPAR-06; no profiling inside algorithms.
function observe(directory){
  const started=Date.now()-2000,processes=[],streams=[],tracked=new Set();let stopped=false;
  const events=createWriteStream(resolve(directory,'pod-events.jsonl'));streams.push(events);
  const redact=text=>text.replace(/(https?:\/\/[^\s"'?]+)\?[^\s"']+/g,'$1?[REDACTED]');
  for(const cluster of ['cloud','edge-a','edge-b','edge-c']){
    const child=spawn('docker',['exec',`cea-${cluster}-1`,'kubectl','get','pods','-n','cea-lab','--watch','--output-watch-events','-o','json','--request-timeout=120s'],{windowsHide:true});processes.push(child);
    const errors=createWriteStream(resolve(directory,`${cluster}-watch.log`));streams.push(errors);
    child.stderr.on('data',b=>{if(!stopped)errors.write(redact(b.toString()));});
    let buffer='',depth=0,quote=false,escaped=false,start=-1,position=0;
    child.stdout.on('data',chunk=>{if(stopped)return;buffer+=chunk.toString();
      for(;position<buffer.length;position++){const c=buffer[position];if(start<0){if(c!=='{')continue;start=position;depth=0;}
        if(quote){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quote=false;continue;}
        if(c==='"')quote=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){onEvent(cluster,JSON.parse(buffer.slice(start,position+1)));start=-1;}}
      if(start<0){buffer='';position=0;}else if(start>0){buffer=buffer.slice(start);position-=start;start=0;}
    });
  }
  function onEvent(cluster,event){const pod=event.object;
    if(!pod?.metadata?.name?.startsWith('cea-')||Date.parse(pod.metadata.creationTimestamp)<started)return;
    const statuses=[...(pod.status?.initContainerStatuses??[]),...(pod.status?.containerStatuses??[])];
    events.write(redact(JSON.stringify({observedAt:new Date().toISOString(),cluster,event:event.type,name:pod.metadata.name,phase:pod.status?.phase,statuses:statuses.map(s=>({name:s.name,state:s.state,lastState:s.lastState,restartCount:s.restartCount}))}))+'\n');
    for(const status of statuses){if(!status.state?.running&&!status.state?.terminated)continue;
      if(status.name!=='task'&&!(status.state?.terminated?.exitCode>0))continue;
      const key=`${cluster}-${pod.metadata.name}-${status.name}`;if(tracked.has(key))continue;tracked.add(key);
      const stream=createWriteStream(resolve(directory,`${key}.log`));streams.push(stream);
      const logger=spawn('docker',['exec',`cea-${cluster}-1`,'kubectl','logs','-n','cea-lab',pod.metadata.name,'-c',status.name,'--follow','--timestamps','--request-timeout=90s'],{windowsHide:true});processes.push(logger);
      logger.stdout.on('data',b=>{if(!stopped)stream.write(redact(b.toString()));});logger.stderr.on('data',b=>{if(!stopped)stream.write(redact(b.toString()));});
    }
  }
  return {async stop(){stopped=true;for(const child of processes)child.kill();await sleep(400);await Promise.all(streams.map(s=>new Promise(r=>s.end(r))));}};
}
