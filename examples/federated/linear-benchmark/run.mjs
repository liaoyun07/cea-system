// FLPAR-21: six-client MLP baseline versus linear/mmap/batched candidate.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parse,stringify} from '../../../frontend/node_modules/yaml/dist/index.js';
import {intervals} from '../parallel-benchmark/run.mjs';
import {observe} from '../thread-benchmark/observe.mjs';
import {openAsBlob} from 'node:fs';

export const sequence=[{kind:'baseline',warmup:true},{kind:'candidate',warmup:true},
  ...['baseline','candidate','candidate','baseline','baseline','candidate'].map(kind=>({kind,warmup:false}))]
  .map((p,index)=>({...p,index}));
export function variant(source,kind) {
  assert(['baseline','candidate'].includes(kind));
  const flow=parse(source),loop=flow.tasks[1].tasks[0];
  assert.equal(loop.loop.concurrency,6);assert.equal(loop.loop.values.value.length,6);
  assert.equal(flow.inputs.batch_size.defaultValue,1024);assert.equal(flow.inputs.local_epochs.defaultValue,1);
  assert.equal(flow.inputs.raw_training_dataset.defaultValue,'cifar10-raw-train/v2');
  flow.id='par21-'+kind;flow.description='FLPAR-21 six clients: '+kind;
  flow.labels={...flow.labels,benchmark:'FLPAR-21'};
  const train=loop.tasks.find(t=>t.id==='train').container;
  train.command=['env','OMP_NUM_THREADS=1','MKL_NUM_THREADS=1','python','/app/prepared_train.py','train'];
  if(kind==='candidate'){
    flow.inputs.model={type:'SELECT',values:['linear'],defaultValue:'linear'};
    function visit(tasks){for(const t of tasks??[]){
      if(t.container&&t.id!=='preprocess'){
        t.container.version='par21-v1';
        t.container.command=t.container.command.map(v=>['/app/app.py','/app/prepared_train.py'].includes(v)?'/app/linear_app.py':v);
        if(t.id==='evaluate')t.container.parameters.BATCH_SIZE={source:'LITERAL',value:1024};
      }visit(t.tasks);
    }}visit(flow.tasks);
  }
  return flow;
}

async function main(mode) {
  const root=fileURLToPath(new URL('../../../',import.meta.url)),folder=`${root}/.local/cea/par21`;
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
  if(mode==='register') {
    const executions=await idle();let before=await optional('before');
    if(!before){before={executions,flows:await Promise.all((await all('/flows')).map(f=>api(`/flows/${f.flowId}`))),datasets:await all('/resources/datasets'),services:services(),config:await readFile(`${root}/deploy/cea/application.yaml`,'utf8')};await save('before',before);}
    const baseline=before.flows.find(f=>f.flowId==='par15-fedavg-cifar10-c6-preprocess');assert(baseline);
    const definitions=[['fl-init','par08-v1'],['fedavg-train','par08-prepared-v1'],['fl-aggregate','par16-v1'],['fl-evaluate','par08-v1']];
    let apps=await optional('applications');
    if(!apps){
      apps=[];
      for(const [id,oldVersion] of definitions){
        const original=await api('/applications/'+id+'/versions/'+oldVersion);
        const parameters=structuredClone(original.parameters);
        if(parameters.MODEL){parameters.MODEL.defaultValue='linear';parameters.MODEL.choices=['linear'];}
        let current=await optional('app-'+id);
        if(!current){
          if(id==='fl-init'){
            const form=new FormData();
            form.append('contract',new Blob([JSON.stringify({parameters})],{type:'application/json'}));
            form.append('file',await openAsBlob(folder+'/linear.tar'),'linear.tar');
            const response=await fetch(base+'/applications/fl-init/versions/par21-v1/upload',{method:'POST',headers:{Authorization},body:form});
            assert(response.ok,'Upload HTTP '+response.status);current=await response.json();
          }else{
            const first=await read('app-fl-init');
            await api('/applications/'+id+'/versions/par21-v1','PUT',{...original,version:'par21-v1',image:first.image,parameters});
            current=await api('/applications/'+id+'/versions/par21-v1');
          }
          await save('app-'+id,current);
        }
        assert.deepEqual(current.parameters,parameters);
        assert.deepEqual(await api('/applications/'+id+'/versions/'+oldVersion),original);
        apps.push({original,current});
      }await save('applications',apps);
    }
    const flows=[];
    for(const kind of ['baseline','candidate']){
      const flow=variant(baseline.source,kind);let current=await optional(flow.id);
      if(!current){const source=stringify(flow);await api('/flows/'+flow.id+'/validate','POST',{source});
        await api('/flows/'+flow.id+'/revisions','POST',{source,expectedRevision:0});
        current=await api('/flows/'+flow.id);await save(flow.id,current);}
      assert.deepEqual(parse(current.source),flow);flows.push(current);
    }
    if(!await optional('published'))await save('published',flows);
    console.log('Published two isolated CEA Flows and four Application versions; original objects retained.');
  }else if(mode==='run') {
    const before=await read('before'),published=await read('published');
    for(const planned of sequence) {
      const {index,kind}=planned,prior=await optional(`trial-${index}`);
      if(prior){if(prior.execution.state!=='SUCCESS')assert.equal((await optional(`failure-${index}`))?.environmentReady,true,'Review retained failure before continuing');continue;}
      assert.deepEqual(services(),before.services);
      const flow=published.find(f=>f.flowId===`par21-${kind}`);
      const directory=`${folder}/logs-${index}`;await mkdir(directory,{recursive:true});const observer=observe(directory);
      try {
        let accepted=await optional(`accepted-${index}`);
        if(!accepted){await idle();let request=await optional(`request-${index}`);if(!request){request={key:randomUUID(),body:{flowId:flow.flowId,revision:flow.revision,inputs:{}}};await save(`request-${index}`,request);}
          accepted=await api('/executions','POST',request.body,request.key);await save(`accepted-${index}`,accepted);}
        console.log(`${index+1}/${sequence.length}: ${kind} ${planned.warmup?'warmup':'formal'} ${accepted.executionId}`);
        let execution;const deadline=Date.now()+600000;
        do{execution=await api(`/executions/${accepted.executionId}`);if(['SUCCESS','FAILED','KILLED'].includes(execution.state))break;assert(Date.now()<deadline,'Timeout: resume same accepted execution');await new Promise(r=>setTimeout(r,1500));}while(true);
        const tasks=await api(`/executions/${execution.id}/tasks`),measurement=await api(`/executions/${execution.id}/measurement`),reports=[];
        for(const t of tasks)if(t.outputs?.['cea-measurement.json'])reports.push({taskRunId:t.id,taskId:t.taskId,iteration:t.iteration,report:await api(`/executions/${execution.id}/tasks/${t.id}/output-json?port=cea-measurement.json`)});
        const evaluation=tasks.find(t=>t.taskId==='evaluate'&&t.state==='SUCCESS');
        const metrics=evaluation?await api(`/executions/${execution.id}/tasks/${evaluation.id}/output-json?port=metrics.json`):null;
        const stages=Object.fromEntries(['init','preprocess','train','aggregate','evaluate'].map(name=>{const rows=reports.filter(p=>p.taskId===name);return[name,rows.length?{...intervals(rows.map(p=>p.report)),bytes:rows.flatMap(p=>[...p.report.inputs,...p.report.outputs]).reduce((n,f)=>n+f.bytes,0)}:null];}));
        const row={...planned,execution,tasks,measurement,reports,metrics,stages,totalSeconds:(Date.parse(execution.endedAt)-Date.parse(execution.createdAt))/1000};await save(`trial-${index}`,row);
        console.log(`${execution.state}: ${(measurement.bytesPerSecond/1e6).toFixed(2)} MB/s; train ${stages.train?.activeSeconds}s; total ${row.totalSeconds}s`);
        assert.equal(execution.state,'SUCCESS','Failure retained: inspect before remaining planned trials');
        assert.equal(measurement.status,'AVAILABLE');assert.equal(reports.length,15);assert.equal(metrics.samples,10000);
        // Floating-point reduction order can change loss JSON text by a byte.
        // Keep all data/model bytes fixed and count the real metrics file size.
        const metricsBytes=reports.find(p=>p.taskId==='evaluate').report.outputs.find(f=>f.path.endsWith('/metrics.json')).bytes;
        if(kind==='baseline')assert.equal(measurement.inputBytes+measurement.outputBytes-metricsBytes,2925862481);
        for(const [side,key] of [['inputs','inputBytes'],['outputs','outputBytes']])assert.equal(reports.flatMap(p=>p.report[side]).reduce((n,f)=>n+f.bytes,0),measurement[key]);
        assert(Math.abs(intervals(reports.map(p=>p.report)).activeSeconds-measurement.activeSeconds)<1e-8);
      }finally{await observer.stop();}
    }
  }else if(mode==='review-failure') {
    await idle();assert.equal((await(await fetch(origin+'/health')).json()).status,'UP');const nodes=[];
    for(const cluster of ['cloud','edge-a','edge-b','edge-c']){const result=JSON.parse(execFileSync('docker',['exec',`cea-${cluster}-1`,'kubectl','get','nodes','-o','json'],{encoding:'utf8'}));
      for(const n of result.items){assert(n.status.conditions.some(c=>c.type==='Ready'&&c.status==='True'));assert(!n.status.conditions.some(c=>/Pressure$/.test(c.type)&&c.status==='True'));}nodes.push({cluster,result});}
    for(const {index} of sequence){const row=await optional(`trial-${index}`);if(!row||row.execution.state==='SUCCESS'||await optional(`failure-${index}`))continue;
      const attempts=[];for(const t of row.tasks.filter(t=>t.state==='FAILED'))attempts.push({taskId:t.taskId,taskRunId:t.id,attempts:await api(`/executions/${row.execution.id}/tasks/${t.id}/attempts`)});
      await save(`failure-${index}`,{environmentReady:true,nodes,attempts,limitation:'Failure retained, not replaced or automatically repaired; raw logs separately captured.'});}
    console.log('Environment Ready; failed trials retained.');
  }else if(mode==='audit') {
    const rows=await Promise.all(sequence.map(p=>read(`trial-${p.index}`))),jobs=[],copies=[];
    const published=await read('published'),imageMaps={};
    for(const f of published){
      const images=new Map();
      async function visit(tasks){for(const t of tasks??[]){
        if(t.container){const c=t.container;images.set(t.id,(await api('/applications/'+c.applicationId+'/versions/'+c.version)).image.split('@')[1]);}
        await visit(t.tasks);
      }}await visit(parse(f.source).tasks);imageMaps[f.flowId]=images;
    }
    for(const row of rows){if(row.execution.state!=='SUCCESS'){assert.equal((await read(`failure-${row.index}`)).environmentReady,true);continue;}
      for(const cluster of ['cloud','edge-a','edge-b','edge-c']) {
        const leaves=row.tasks.filter(t=>t.outputs?.['cea-measurement.json']&&(['preprocess','train'].includes(t.taskId)?`edge-${'abc'[(t.iteration-1)%3]}`:'cloud')===cluster),names=leaves.map(t=>`cea-${t.id}-a1`);
        const get=(kind,args)=>JSON.parse(execFileSync('docker',['exec',`cea-${cluster}-1`,'kubectl','get',kind,...args,'-n','cea-lab','-o','json'],{encoding:'utf8',maxBuffer:20*1024*1024})).items;
        const actual=get('jobs',names),pods=get('pods',['-l',`job-name in (${names.join(',')})`]);assert.equal(pods.length,leaves.length);
        for(const t of leaves){const job=actual.find(j=>j.metadata.name===`cea-${t.id}-a1`),pod=pods.find(p=>p.metadata.labels['job-name']===job.metadata.name),main=job.spec.template.spec.containers.find(c=>c.name==='task');
          assert.equal(job.status.succeeded,1);assert.equal(pod.status.phase,'Succeeded');
          for(const s of [...pod.status.initContainerStatuses,...pod.status.containerStatuses]){assert.equal(s.restartCount,0);assert.equal(s.state.terminated.exitCode,0);}
          assert.equal(main.image.split('@')[1],imageMaps['par21-'+row.kind].get(t.taskId));
          assert.deepEqual(main.command,['/bin/sh']);assert.equal(main.args[0],'-c');assert.equal(main.args[2],'cea-task');
          if(t.taskId==='train'){assert.deepEqual(main.args.slice(3),['env','OMP_NUM_THREADS=1','MKL_NUM_THREADS=1','python',row.kind==='candidate'?'/app/linear_app.py':'/app/prepared_train.py','train']);}
          jobs.push({index:row.index,taskId:t.taskId,taskRunId:t.id,cluster,image:main.image,command:main.args.slice(3)});
          if(t.outputs['model.pt']){const uri=new URL(t.outputs['model.pt']),bucket=cluster==='cloud'?'cea-artifacts':`cea-artifacts-${cluster}`;assert.equal(uri.hostname,bucket);assert.equal(uri.protocol,'s3:');assert.match(uri.pathname,/^\/[A-Za-z0-9/._-]+$/);copies.push({source:`${cluster==='cloud'?'local':cluster}/${bucket}${uri.pathname}`,destination:`par21/models/${row.index}/${t.taskId}-${t.iteration}.pt`});}
        }
      }
    }
    const mean=(r,fn)=>r.length?r.reduce((n,x)=>n+fn(x),0)/r.length:null;
    const summary=['baseline','candidate'].map(kind=>{
      const planned=rows.filter(r=>r.kind===kind&&!r.warmup),ok=planned.filter(r=>r.execution.state==='SUCCESS');
      return{kind,attempts:planned.length,succeeded:ok.length,MBps:mean(ok,r=>r.measurement.bytesPerSecond/1e6),
        sdkSeconds:mean(ok,r=>r.measurement.activeSeconds),totalSeconds:mean(ok,r=>r.totalSeconds),
        trainSeconds:mean(ok,r=>r.stages.train.activeSeconds),preprocessSeconds:mean(ok,r=>r.stages.preprocess.activeSeconds),
        evaluateSeconds:mean(ok,r=>r.stages.evaluate.activeSeconds),accuracy:mean(ok,r=>r.metrics.accuracy),
        loss:mean(ok,r=>r.metrics.loss),bytes:mean(ok,r=>r.measurement.inputBytes+r.measurement.outputBytes),
        meanClientSeconds:mean(ok,r=>mean(r.reports.filter(p=>p.taskId==='train'),p=>p.report.durationNs/1e9)),
        meanTrainParallel:mean(ok,r=>r.stages.train.meanParallel),trainPeaks:ok.map(r=>r.stages.train.peak)};
    });
    await save('audit',{result:'PASS',scope:'successful executions only',jobs,copies,summary});console.log(JSON.stringify(summary));
  }else if(mode==='verify') {
    const before=await read('before'),published=await read('published'),executions=await idle();
    for(const old of before.executions)assert.deepEqual(executions.find(e=>e.id===old.id),old);assert.equal(executions.length,before.executions.length+sequence.length);
    assert.equal((await all('/flows')).length,before.flows.length+published.length);
    for(const f of [...before.flows,...published])assert.deepEqual(await api(`/flows/${f.flowId}`),f);
    assert.deepEqual(await all('/resources/datasets'),before.datasets);assert.equal(await readFile(`${root}/deploy/cea/application.yaml`,'utf8'),before.config);assert.deepEqual(services(),before.services);
    assert.equal((await read('audit')).result,'PASS');assert.equal((await read('models-audit')).result,'PASS');
    for(const a of await read('applications'))for(const v of [a.original,a.current])assert.deepEqual(await api(`/applications/${v.applicationId}/versions/${v.version}`),v);
    const last=await read('trial-7'),r=await fetch(`http://127.0.0.1:18080/api/namespaces/lab/executions/${last.execution.id}/measurement`,{headers:{Authorization}});assert(r.ok);assert.deepEqual(await r.json(),last.measurement);
    assert.equal((await(await fetch(origin+'/health')).json()).status,'UP');await save('after',{result:'PASS',executions:executions.length,flows:before.flows.length+published.length,services:services()});console.log('CEA deployed experiment Flows and original data/services verified.');
  }else throw Error('register | run | review-failure | audit | verify');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main(process.argv[2]);
