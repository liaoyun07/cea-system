// FLPAR-22: same 100,000 processed samples, six small versus three doubled clients.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parse,stringify} from '../../../frontend/node_modules/yaml/dist/index.js';
import {intervals} from '../parallel-benchmark/run.mjs';
import {sequence} from '../linear-benchmark/run.mjs';
import {observe} from '../thread-benchmark/observe.mjs';
export {sequence};

export function variant(source,kind) {
  assert(['baseline','candidate'].includes(kind));
  const flow=parse(source),loop=flow.tasks[1].tasks[0];
  assert.equal(flow.inputs.model.defaultValue,'linear');
  assert.equal(flow.inputs.local_epochs.defaultValue,1);
  assert.equal(flow.inputs.batch_size.defaultValue,1024);
  assert.equal(loop.loop.concurrency,6);assert.equal(loop.loop.values.value.length,6);
  assert.equal(flow.inputs.raw_training_dataset.defaultValue,'cifar10-raw-train/v2');
  flow.id='par22-'+kind;flow.description=`FLPAR-22 ${kind==='baseline'?'six small':'three doubled'} clients, 100000 processed / 50000 unique samples`;
  flow.labels={...flow.labels,benchmark:'FLPAR-22'};
  if(kind==='candidate'){
    loop.loop.values.value=loop.loop.values.value.slice(0,3);loop.loop.concurrency=3;
    flow.inputs.raw_training_dataset.defaultValue='cifar10-raw-train/par22-double';
    flow.inputs.raw_training_dataset.values=['cifar10-raw-train/par22-double'];
    loop.tasks.find(t=>t.id==='preprocess').container.version='par22-v1';
  }
  return flow;
}

async function main(mode) {
  const root=fileURLToPath(new URL('../../../',import.meta.url)),clean=process.env.FLPAR22_CLEAN==='1',batch=clean?'par22-clean':'par22',folder=`${root}/.local/cea/${batch}`;
  const settings=Object.fromEntries((await readFile(`${root}/deploy/cea/.env`,'utf8')).split(/\r?\n/).filter(l=>/^[A-Z_0-9]+=/.test(l)).map(l=>{const n=l.indexOf('=');return[l.slice(0,n),l.slice(n+1)];}));
  const origin=`http://127.0.0.1:${settings.CEA_API_PORT}`,base=`${origin}/api/namespaces/lab`;
  const Authorization='Basic '+Buffer.from(`${settings.BACKEND_USER}:${settings.BACKEND_PASSWORD}`).toString('base64');
  await mkdir(folder,{recursive:true});
  const read=async name=>JSON.parse(await readFile(`${folder}/${name}.json`,'utf8'));
  const optional=async name=>{try{return await read(name);}catch(e){if(e.code!=='ENOENT')throw e;return null;}};
  const save=(name,value)=>writeFile(`${folder}/${name}.json`,JSON.stringify(value,null,2),{flag:'wx'});
  async function api(path,method='GET',body,key=randomUUID()) {
    const r=await fetch(base+path,{method,headers:{Authorization,'Content-Type':'application/json','Idempotency-Key':key},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
    assert(r.ok,`${method} ${path}: HTTP ${r.status}`);return r.json();
  }
  async function all(path){const out=[];for(let offset=0;;offset+=100){const rows=await api(`${path}?limit=100&offset=${offset}`);out.push(...rows);if(rows.length<100)return out;}}
  async function idle(){const rows=await all('/executions');assert(rows.every(e=>['SUCCESS','FAILED','KILLED'].includes(e.state)),'Active execution');return rows;}
  function services(){const ids=execFileSync('docker',['ps','-q','--filter','label=com.docker.compose.project=cea'],{encoding:'utf8'}).trim().split(/\s+/);
    return JSON.parse(execFileSync('docker',['inspect',...ids],{encoding:'utf8'})).map(c=>({id:c.Id,name:c.Name,image:c.Image,started:c.State.StartedAt})).sort((a,b)=>a.name.localeCompare(b.name));}
  function noObservers(){const deadline=Date.now()+5000;let state;do{state=['cloud','edge-a','edge-b','edge-c'].map(cluster=>({cluster,execIds:JSON.parse(execFileSync('docker',['inspect','--format','{{json .ExecIDs}}',`cea-${cluster}-1`],{encoding:'utf8'}))??[]}));if(state.every(c=>c.execIds.length===0))return state;}while(Date.now()<deadline);assert.fail('Previous observer remains');}
  async function applications(flows){const out={};async function visit(tasks){for(const t of tasks??[]){if(t.container){const c=t.container,key=c.applicationId+'/'+c.version;if(!out[key])out[key]=await api('/applications/'+c.applicationId+'/versions/'+c.version);}await visit(t.tasks);}}
    for(const f of flows)await visit(parse(f.source).tasks);return out;}
  if(mode==='capture'){
    if(clean){noObservers();assert.equal(JSON.parse(await readFile(`${root}/.local/cea/par22/observer-check/result.json`,'utf8')).result,'PASS');}
    const executions=await idle(),flows=await Promise.all((await all('/flows')).map(f=>api('/flows/'+f.flowId)));
    await save('before',{executions,flows,datasets:await all('/resources/datasets'),services:services(),applications:await applications(flows),config:await readFile(`${root}/deploy/cea/application.yaml`,'utf8')});
    if(clean)await save('published',JSON.parse(await readFile(`${root}/.local/cea/par22/published.json`,'utf8')));
    console.log('Captured original CEA state; no objects changed.');
  }else if(mode==='register'){
    assert(!clean,'Clean rerun reuses existing definitions');
    await idle();assert.equal((await read('readback-audit')).result,'PASS');
    const before=await read('before'),source=before.flows.find(f=>f.flowId==='par21-candidate');assert(source);
    const dataset={datasetId:'cifar10-raw-train',version:'par22-double',format:'pt',locations:[...'abc'].map(letter=>({clusterId:`edge-${letter}`,uri:`s3://datasets/par22/raw/edge-${letter}.pt`}))};
    const original=before.applications['fl-preprocess/par18-v1'],app=structuredClone(original);assert(original);
    app.version='par22-v1';app.parameters.RAW_DATASET.defaultValue='cifar10-raw-train/par22-double';
    app.parameters.RAW_DATASET.dataset.allowed=[{datasetId:dataset.datasetId,version:dataset.version}];
    await api('/resources/datasets/cifar10-raw-train/versions/par22-double','PUT',dataset);
    await api('/applications/fl-preprocess/versions/par22-v1','PUT',app);
    const flows=[];
    for(const kind of ['baseline','candidate']){const flow=variant(source.source,kind);let current=await optional(flow.id);
      if(!current){const yaml=stringify(flow);await api('/flows/'+flow.id+'/validate','POST',{source:yaml});await api('/flows/'+flow.id+'/revisions','POST',{source:yaml,expectedRevision:0});current=await api('/flows/'+flow.id);await save(flow.id,current);}
      assert.deepEqual(parse(current.source),flow);flows.push(current);}
    await save('published',{flows,dataset:await api('/resources/datasets/cifar10-raw-train/versions/par22-double'),application:await api('/applications/fl-preprocess/versions/par22-v1')});
    console.log('Published two isolated Flows, duplicated-data version and same-image contract; services unchanged.');
  }else if(mode==='run'){
    const before=await read('before'),published=await read('published');
    for(const planned of sequence){const {index,kind}=planned,prior=await optional(`trial-${index}`);
      if(prior){if(prior.execution.state!=='SUCCESS')assert.equal((await optional(`failure-${index}`))?.environmentReady,true,'Review retained failure first');continue;}
      assert.deepEqual(services(),before.services);
      if(clean)noObservers();
      const flow=published.flows.find(f=>f.flowId==='par22-'+kind),directory=`${folder}/logs-${index}`;
      await mkdir(directory,{recursive:true});const observer=observe(directory);
      try{
        let accepted=await optional(`accepted-${index}`);
        if(!accepted){await idle();let request=await optional(`request-${index}`);if(!request){request={key:randomUUID(),body:{flowId:flow.flowId,revision:flow.revision,inputs:{}}};await save(`request-${index}`,request);}
          accepted=await api('/executions','POST',request.body,request.key);await save(`accepted-${index}`,accepted);}
        console.log(`${index+1}/8 ${kind} ${planned.warmup?'warmup':'formal'} ${accepted.executionId}`);
        let execution;const deadline=Date.now()+600000;
        do{execution=await api(`/executions/${accepted.executionId}`);if(['SUCCESS','FAILED','KILLED'].includes(execution.state))break;assert(Date.now()<deadline,'Timeout: resume accepted execution');await new Promise(r=>setTimeout(r,1500));}while(true);
        const tasks=await api(`/executions/${execution.id}/tasks`),measurement=await api(`/executions/${execution.id}/measurement`),reports=[];
        for(const t of tasks)if(t.outputs?.['cea-measurement.json'])reports.push({taskRunId:t.id,taskId:t.taskId,iteration:t.iteration,report:await api(`/executions/${execution.id}/tasks/${t.id}/output-json?port=cea-measurement.json`)});
        const evaluation=tasks.find(t=>t.taskId==='evaluate'&&t.state==='SUCCESS');
        const metrics=evaluation?await api(`/executions/${execution.id}/tasks/${evaluation.id}/output-json?port=metrics.json`):null;
        const stages=Object.fromEntries(['init','preprocess','train','aggregate','evaluate'].map(name=>{const rows=reports.filter(p=>p.taskId===name);return[name,rows.length?{...intervals(rows.map(p=>p.report)),bytes:rows.flatMap(p=>[...p.report.inputs,...p.report.outputs]).reduce((n,f)=>n+f.bytes,0)}:null];}));
        const row={...planned,execution,tasks,measurement,reports,metrics,stages,totalSeconds:(Date.parse(execution.endedAt)-Date.parse(execution.createdAt))/1000};await save(`trial-${index}`,row);
        console.log(`${execution.state}: ${measurement.status==='AVAILABLE'?(measurement.bytesPerSecond/1e6).toFixed(2)+' MB/s':'measurement unavailable'}; SDK ${measurement.activeSeconds}s; total ${row.totalSeconds}s`);
        assert.equal(execution.state,'SUCCESS','Failure retained: inspect before remaining trials');
        assert.equal(measurement.status,'AVAILABLE');assert.equal(reports.length,kind==='baseline'?15:9);assert.equal(metrics.samples,10000);
        for(const [side,key] of [['inputs','inputBytes'],['outputs','outputBytes']])assert.equal(reports.flatMap(p=>p.report[side]).reduce((n,f)=>n+f.bytes,0),measurement[key]);
        assert(Math.abs(intervals(reports.map(p=>p.report)).activeSeconds-measurement.activeSeconds)<1e-8);
      }finally{await observer.stop();if(clean)await save(`observers-stopped-${index}`,noObservers());}
    }
  }else if(mode==='review-failure'){
    await idle();assert.equal((await(await fetch(origin+'/health')).json()).status,'UP');const nodes=[];
    for(const cluster of ['cloud','edge-a','edge-b','edge-c']){const result=JSON.parse(execFileSync('docker',['exec',`cea-${cluster}-1`,'kubectl','get','nodes','-o','json'],{encoding:'utf8'}));
      for(const n of result.items){assert(n.status.conditions.some(c=>c.type==='Ready'&&c.status==='True'));assert(!n.status.conditions.some(c=>/Pressure$/.test(c.type)&&c.status==='True'));}nodes.push({cluster,result});}
    for(const {index} of sequence){const row=await optional(`trial-${index}`);if(!row||row.execution.state==='SUCCESS'||await optional(`failure-${index}`))continue;const attempts=[];
      for(const t of row.tasks.filter(t=>t.state==='FAILED'))attempts.push({taskId:t.taskId,attempts:await api(`/executions/${row.execution.id}/tasks/${t.id}/attempts`)});
      await save(`failure-${index}`,{environmentReady:true,nodes,attempts,limitation:'Failure retained, not replaced or automatically repaired; see captured logs.'});}
  }else if(mode==='audit'){
    const published=await read('published'),apps=await applications(published.flows),rows=await Promise.all(sequence.map(p=>read(`trial-${p.index}`))),jobs=[],copies=[];
    for(const row of rows){if(row.execution.state!=='SUCCESS'){assert.equal((await read(`failure-${row.index}`)).environmentReady,true);continue;}
      const flow=parse(published.flows.find(f=>f.flowId==='par22-'+row.kind).source),definitions=[flow.tasks[0],...flow.tasks[1].tasks[0].tasks,...flow.tasks[1].tasks.slice(1)];
      for(const cluster of ['cloud','edge-a','edge-b','edge-c']){
        const leaves=row.tasks.filter(t=>t.outputs?.['cea-measurement.json']&&(['preprocess','train'].includes(t.taskId)?`edge-${'abc'[(t.iteration-1)%3]}`:'cloud')===cluster),names=leaves.map(t=>`cea-${t.id}-a1`);
        const get=(kind,args)=>JSON.parse(execFileSync('docker',['exec',`cea-${cluster}-1`,'kubectl','get',kind,...args,'-n','cea-lab','-o','json'],{encoding:'utf8',maxBuffer:20*1024*1024})).items;
        const actual=get('jobs',names),pods=get('pods',['-l',`job-name in (${names.join(',')})`]);assert.equal(pods.length,leaves.length);
        for(const t of leaves){const job=actual.find(j=>j.metadata.name===`cea-${t.id}-a1`),pod=pods.find(p=>p.metadata.labels['job-name']===job.metadata.name),main=job.spec.template.spec.containers.find(c=>c.name==='task'),definition=definitions.find(d=>d.id===t.taskId).container;
          assert.equal(job.status.succeeded,1);assert.equal(pod.status.phase,'Succeeded');
          for(const s of [...pod.status.initContainerStatuses,...pod.status.containerStatuses]){assert.equal(s.restartCount,0);assert.equal(s.state.terminated.exitCode,0);}
          assert.equal(main.image.split('@')[1],apps[definition.applicationId+'/'+definition.version].image.split('@')[1]);
          assert.deepEqual(main.command,['/bin/sh']);assert.deepEqual(main.args.slice(3),definition.command);
          if(t.taskId==='preprocess')assert.equal(main.env.find(e=>e.name==='RAW_DATASET').value,flow.inputs.raw_training_dataset.defaultValue);
          jobs.push({index:row.index,taskId:t.taskId,taskRunId:t.id,cluster,image:main.image});
          if(t.outputs['model.pt']){const uri=new URL(t.outputs['model.pt']),bucket=cluster==='cloud'?'cea-artifacts':`cea-artifacts-${cluster}`;assert.equal(uri.hostname,bucket);assert.equal(uri.protocol,'s3:');assert.match(uri.pathname,/^\/[A-Za-z0-9/._-]+$/);
            copies.push({source:`${cluster==='cloud'?'local':cluster}/${bucket}${uri.pathname}`,destination:`${batch}/models/${row.index}/${t.taskId}-${t.iteration}.pt`});}
        }
      }
    }
    const mean=(rows,fn)=>rows.length?rows.reduce((n,r)=>n+fn(r),0)/rows.length:null;
    const summary=['baseline','candidate'].map(kind=>{const planned=rows.filter(r=>r.kind===kind&&!r.warmup),ok=planned.filter(r=>r.execution.state==='SUCCESS');
      return{kind,attempts:planned.length,succeeded:ok.length,MBps:mean(ok,r=>r.measurement.bytesPerSecond/1e6),sdkSeconds:mean(ok,r=>r.measurement.activeSeconds),totalSeconds:mean(ok,r=>r.totalSeconds),bytes:mean(ok,r=>r.measurement.inputBytes+r.measurement.outputBytes),accuracy:mean(ok,r=>r.metrics.accuracy),loss:mean(ok,r=>r.metrics.loss),
        stages:Object.fromEntries(['preprocess','train','aggregate','evaluate'].map(s=>[s,{unionSeconds:mean(ok,r=>r.stages[s].activeSeconds),meanParallel:mean(ok,r=>r.stages[s].meanParallel),meanTaskSeconds:mean(ok,r=>mean(r.reports.filter(p=>p.taskId===s),p=>p.report.durationNs/1e9)),peaks:ok.map(r=>r.stages[s].peak)}]))};});
    await save('audit',{result:'PASS',scope:'successful executions only',jobs,copies,summary});console.log(JSON.stringify(summary));
  }else if(mode==='verify'){
    const before=await read('before'),published=await read('published'),executions=await idle(),datasets=await all('/resources/datasets');
    for(const old of before.executions)assert.deepEqual(executions.find(e=>e.id===old.id),old);assert.equal(executions.length,before.executions.length+8);
    assert.equal((await all('/flows')).length,before.flows.length+(clean?0:2));for(const f of [...before.flows,...published.flows])assert.deepEqual(await api('/flows/'+f.flowId),f);
    assert.equal(datasets.length,before.datasets.length+(clean?0:1));for(const d of [...before.datasets,published.dataset])assert.deepEqual(datasets.find(x=>x.datasetId===d.datasetId&&x.version===d.version),d);
    for(const a of [...Object.values(before.applications),published.application])assert.deepEqual(await api(`/applications/${a.applicationId}/versions/${a.version}`),a);
    assert.equal(await readFile(`${root}/deploy/cea/application.yaml`,'utf8'),before.config);assert.deepEqual(services(),before.services);
    assert.equal((await read('audit')).result,'PASS');assert.equal((await read('models-audit')).result,'PASS');
    const last=await read('trial-7'),response=await fetch(`http://127.0.0.1:18080/api/namespaces/lab/executions/${last.execution.id}/measurement`,{headers:{Authorization}});assert(response.ok);assert.deepEqual(await response.json(),last.measurement);
    if(clean){noObservers();for(const {index} of sequence)assert((await read(`observers-stopped-${index}`)).every(c=>c.execIds.length===0));}
    assert.equal((await(await fetch(origin+'/health')).json()).status,'UP');await save('after',{result:'PASS',executions:executions.length,flows:before.flows.length+(clean?0:2),services:services()});console.log('Original objects retained, new experiment deployed and CEA healthy.');
  }else throw Error('capture | register | run | review-failure | audit | verify');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main(process.argv[2]);
