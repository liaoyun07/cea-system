import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parse,stringify} from '../../../frontend/node_modules/yaml/dist/index.js';
import {intervals} from '../parallel-benchmark/run.mjs';
import {observe} from '../thread-benchmark/observe.mjs';

export function variant(source,file){
  const flow=parse(source),loop=flow.tasks[1].tasks[0];
  assert.equal(loop.loop.concurrency,3);assert.equal(loop.loop.values.value.length,3);
  assert.equal(flow.inputs.raw_training_dataset.defaultValue,'cifar10-raw-train/par22-double');
  assert.equal(flow.inputs.model.defaultValue,'linear');assert.equal(flow.inputs.local_epochs.defaultValue,1);
  assert.equal(flow.inputs.batch_size.defaultValue,1024);assert.equal(flow.tasks[1].repeat.iterations.value,1);
  flow.id='par24-compute-window';flow.description='FLPAR-24: same-run full SDK and resident-input compute spans; 3 clients, 100000 processed / 50000 unique samples';
  flow.labels={...flow.labels,benchmark:'FLPAR-24'};
  function visit(tasks){for(const t of tasks??[]){if(t.container){const c=t.container;
    const index=c.command.findIndex(v=>v==='/app/linear_app.py'||v==='/app/preprocess.py');assert(index>=0);
    const tail=t.id==='preprocess'?['preprocess']:c.command.slice(index+1);
    c.command=['env','OMP_NUM_THREADS=1','MKL_NUM_THREADS=1','python','/cea-work/in/compute-profile.py',...tail];
    c.namespaceFiles={'compute-profile.py':{path:file.path,revision:file.revision}};
    c.outputFiles.push('compute-profile.json');
  }visit(t.tasks);}}
  visit(flow.tasks);return flow;
}

const names=['init','preprocess','train','aggregate','evaluate'];
const mean=(rows,fn)=>rows.length?rows.reduce((n,r)=>n+fn(r),0)/rows.length:null;
export function summarize(reports,profiles){
  assert.equal(reports.length,9);assert.equal(profiles.length,9);
  for(const {taskRunId,report:p} of profiles){const r=reports.find(r=>r.taskRunId===taskRunId)?.report;assert(r);
    assert(p.eagerLoad);assert.equal(p.torchThreads,1);
    assert(r.startedAt<=p.read.startedAt&&p.read.endedAt<=p.compute.startedAt&&p.compute.endedAt<=p.write.startedAt&&p.write.endedAt<=r.endedAt);
    for(const key of ['read','compute','write'])assert(p[key].durationNs>0);
    assert(!r.outputs.some(f=>f.path.endsWith('compute-profile.json')));
  }
  const bytes=reports.flatMap(p=>[...p.report.inputs,...p.report.outputs]).reduce((n,f)=>n+f.bytes,0);
  const full=intervals(reports.map(r=>r.report)),compute=intervals(profiles.map(r=>r.report.compute));
  const stages=Object.fromEntries(names.map(name=>{const rr=reports.filter(r=>r.taskId===name),pp=profiles.filter(p=>p.taskId===name);
    const size=rr.flatMap(r=>[...r.report.inputs,...r.report.outputs]).reduce((n,f)=>n+f.bytes,0);
    const c=intervals(pp.map(p=>p.report.compute));
    return[name,{bytes:size,fullSeconds:intervals(rr.map(r=>r.report)).activeSeconds,computeSeconds:c.activeSeconds,
      computeGBps:size/c.activeSeconds/1e9,computePeak:c.peak,computeMeanParallel:c.meanParallel,
      meanReadSeconds:mean(pp,p=>p.report.read.durationNs/1e9),meanComputeSeconds:mean(pp,p=>p.report.compute.durationNs/1e9),meanWriteSeconds:mean(pp,p=>p.report.write.durationNs/1e9)}];}));
  return{bytes,fullSeconds:full.activeSeconds,computeSeconds:compute.activeSeconds,fullGBps:bytes/full.activeSeconds/1e9,computeGBps:bytes/compute.activeSeconds/1e9,stages};
}

async function main(mode){
 const root=fileURLToPath(new URL('../../../',import.meta.url)),folder=`${root}/.local/cea/par24`;
 const settings=Object.fromEntries((await readFile(`${root}/deploy/cea/.env`,'utf8')).split(/\r?\n/).filter(l=>/^[A-Z_0-9]+=/.test(l)).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}));
 const origin=process.env.FLPAR24_API_ORIGIN??`http://127.0.0.1:${settings.CEA_API_PORT}`,base=origin+'/api/namespaces/lab';
 const uiOrigin=process.env.FLPAR24_UI_ORIGIN??'http://127.0.0.1:18080';
 const Authorization='Basic '+Buffer.from(`${settings.BACKEND_USER}:${settings.BACKEND_PASSWORD}`).toString('base64');
 await mkdir(folder,{recursive:true});
 const read=async n=>JSON.parse(await readFile(`${folder}/${n}.json`,'utf8'));
 const optional=async n=>{try{return await read(n);}catch(e){if(e.code!=='ENOENT')throw e;return null;}};
 const save=async(n,v)=>writeFile(`${folder}/${n}.json`,JSON.stringify(v,null,2),{flag:'wx'});
 async function api(path,method='GET',body,key=randomUUID()){
   const r=await fetch(base+path,{method,headers:{Authorization,'Content-Type':'application/json','Idempotency-Key':key},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
   assert(r.ok,`${method} ${path}: HTTP ${r.status}`);return r.json();
 }
 async function all(path){const rows=[];for(let offset=0;;offset+=100){const page=await api(`${path}?limit=100&offset=${offset}`);rows.push(...page);if(page.length<100)return rows;}}
 async function idle(){const rows=await all('/executions');assert(rows.every(e=>['SUCCESS','FAILED','KILLED'].includes(e.state)),'Another execution is active; no benchmark submitted');return rows;}
 function services(){const ids=execFileSync('docker',['ps','-q','--filter','label=com.docker.compose.project=cea'],{encoding:'utf8'}).trim().split(/\s+/);
   return JSON.parse(execFileSync('docker',['inspect',...ids],{encoding:'utf8'})).map(c=>({id:c.Id,name:c.Name,image:c.Image,started:c.State.StartedAt})).sort((a,b)=>a.name.localeCompare(b.name));}
 function noObservers(){const deadline=Date.now()+5000;do{const rows=['cloud','edge-a','edge-b','edge-c'].map(c=>({cluster:c,execIds:JSON.parse(execFileSync('docker',['inspect','--format','{{json .ExecIDs}}',`cea-${c}-1`],{encoding:'utf8'}))??[]}));if(rows.every(r=>r.execIds.length===0))return rows;}while(Date.now()<deadline);assert.fail('Existing remote exec: inspect before running');}
 async function applications(flows){const result={};async function visit(tasks){for(const t of tasks??[]){if(t.container){const c=t.container,key=c.applicationId+'/'+c.version;if(!result[key])result[key]=await api('/applications/'+c.applicationId+'/versions/'+c.version);}await visit(t.tasks);}}for(const f of flows)await visit(parse(f.source).tasks);return result;}
 if(mode==='register'){
   noObservers();const executions=await idle();let before=await optional('before');
   if(!before){const flows=await Promise.all((await all('/flows')).map(f=>api('/flows/'+f.flowId)));
     before={executions,flows,applications:await applications(flows),datasets:await all('/resources/datasets'),services:services(),origin,uiOrigin,config:await readFile(`${root}/deploy/cea/application.yaml`,'utf8'),sourceRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()};await save('before',before);}
   const source=before.flows.find(f=>f.flowId==='par22-candidate');assert(source);
   let file=await optional('namespace-file');if(!file){file=await api('/files','POST',{path:'diagnostics/flpar24-compute.py',expectedRevision:0,content:await readFile(new URL('profile_compute.py',import.meta.url),'utf8')});await save('namespace-file',file);}
   const flow=variant(source.source,file);if(!await optional('published')){const source=stringify(flow);await api('/flows/'+flow.id+'/validate','POST',{source});await api('/flows/'+flow.id+'/revisions','POST',{source,expectedRevision:0});await save('published',await api('/flows/'+flow.id));}
   assert.deepEqual(parse((await read('published')).source),flow);console.log('Published one isolated Flow and fixed script; existing images, applications and data unchanged.');
 }else if(mode==='run'){
   const before=await read('before'),flow=await read('published');
   for(let index=0;index<4;index++){
     const prior=await optional(`trial-${index}`);if(prior){if(prior.execution.state!=='SUCCESS')assert((await optional(`failure-${index}`))?.environmentReady,'Review failure before continuing');continue;}
     assert.deepEqual(services(),before.services);noObservers();const directory=`${folder}/logs-${index}`;await mkdir(directory,{recursive:true});
     const observer=observe(directory);
     try{
       let accepted=await optional(`accepted-${index}`);
       if(!accepted){await idle();let request=await optional(`request-${index}`);if(!request){request={key:randomUUID(),body:{flowId:flow.flowId,revision:flow.revision,inputs:{}}};await save(`request-${index}`,request);}accepted=await api('/executions','POST',request.body,request.key);await save(`accepted-${index}`,accepted);}
       console.log(`${index}/3 ${index===0?'warmup':'formal'} ${accepted.executionId}`);
       let execution;const deadline=Date.now()+600000;
       do{execution=await api('/executions/'+accepted.executionId);if(['SUCCESS','FAILED','KILLED'].includes(execution.state))break;assert(Date.now()<deadline,'Timeout; resume existing execution');await new Promise(r=>setTimeout(r,1500));}while(true);
       const tasks=await api(`/executions/${execution.id}/tasks`),measurement=await api(`/executions/${execution.id}/measurement`),reports=[],profiles=[];
       for(const t of tasks)for(const [port,target] of [['cea-measurement.json',reports],['compute-profile.json',profiles]])if(t.outputs?.[port])target.push({taskRunId:t.id,taskId:t.taskId,iteration:t.iteration,report:await api(`/executions/${execution.id}/tasks/${t.id}/output-json?port=${port}`)});
       const evaluation=tasks.find(t=>t.taskId==='evaluate'&&t.state==='SUCCESS');
       const metrics=evaluation?await api(`/executions/${execution.id}/tasks/${evaluation.id}/output-json?port=metrics.json`):null;
       const row={index,warmup:index===0,execution,tasks,measurement,reports,profiles,metrics,totalSeconds:(Date.parse(execution.endedAt)-Date.parse(execution.createdAt))/1000};
       await save(`trial-${index}`,row);assert.equal(execution.state,'SUCCESS','Failed sample retained; inspect logs and health');assert.equal(measurement.status,'AVAILABLE');
       const summary=summarize(reports,profiles);assert(Math.abs(summary.fullSeconds-measurement.activeSeconds)<1e-8);assert.equal(summary.bytes,measurement.inputBytes+measurement.outputBytes);assert.equal(metrics.samples,10000);
       await save(`summary-${index}`,summary);console.log(JSON.stringify({index,fullGBps:summary.fullGBps,computeGBps:summary.computeGBps,fullSeconds:summary.fullSeconds,computeSeconds:summary.computeSeconds,totalSeconds:row.totalSeconds}));
     }finally{await observer.stop();await save(`observers-stopped-${index}`,noObservers());}
   }
 }else if(mode==='review-failure'){
   await idle();noObservers();assert.equal((await(await fetch(origin+'/health')).json()).status,'UP');const nodes=[];
   for(const c of ['cloud','edge-a','edge-b','edge-c']){const result=JSON.parse(execFileSync('docker',['exec',`cea-${c}-1`,'kubectl','get','nodes','-o','json'],{encoding:'utf8'}));for(const n of result.items){assert(n.status.conditions.some(s=>s.type==='Ready'&&s.status==='True'));assert(!n.status.conditions.some(s=>/Pressure$/.test(s.type)&&s.status==='True'));}nodes.push({cluster:c,result});}
   for(let i=0;i<4;i++){const r=await optional(`trial-${i}`);if(!r||r.execution.state==='SUCCESS'||await optional(`failure-${i}`))continue;const attempts=[];for(const t of r.tasks.filter(t=>t.state==='FAILED'))attempts.push({taskId:t.taskId,attempts:await api(`/executions/${r.execution.id}/tasks/${t.id}/attempts`)});await save(`failure-${i}`,{environmentReady:true,nodes,attempts});}
   console.log('Health checked; failures retained, continue only remaining planned trials.');
 }else if(mode==='audit'){
   const before=await read('before'),flow=parse((await read('published')).source),definitions=[flow.tasks[0],...flow.tasks[1].tasks[0].tasks,...flow.tasks[1].tasks.slice(1)],jobs=[],copies=[],rows=[];
   for(let i=0;i<4;i++){const row=await read(`trial-${i}`);if(row.execution.state!=='SUCCESS'){assert((await read(`failure-${i}`)).environmentReady);continue;}const summary=summarize(row.reports,row.profiles);rows.push({index:i,warmup:row.warmup,totalSeconds:row.totalSeconds,...summary});
     for(const cluster of ['cloud','edge-a','edge-b','edge-c']){const leaves=row.tasks.filter(t=>t.outputs?.['cea-measurement.json']&&(['preprocess','train'].includes(t.taskId)?`edge-${'abc'[(t.iteration-1)%3]}`:'cloud')===cluster),names=leaves.map(t=>`cea-${t.id}-a1`);
       const get=(kind,args)=>JSON.parse(execFileSync('docker',['exec',`cea-${cluster}-1`,'kubectl','get',kind,...args,'-n','cea-lab','-o','json'],{encoding:'utf8',maxBuffer:20*1024*1024})).items;
       const actual=get('jobs',names),pods=get('pods',['-l',`job-name in (${names.join(',')})`]);assert.equal(pods.length,leaves.length);
       for(const t of leaves){const job=actual.find(j=>j.metadata.name===`cea-${t.id}-a1`),pod=pods.find(p=>p.metadata.labels['job-name']===job.metadata.name),main=job.spec.template.spec.containers.find(c=>c.name==='task'),def=definitions.find(d=>d.id===t.taskId).container;
         assert.equal(job.status.succeeded,1);assert.equal(pod.status.phase,'Succeeded');for(const s of [...pod.status.initContainerStatuses,...pod.status.containerStatuses]){assert.equal(s.restartCount,0);assert.equal(s.state.terminated.exitCode,0);}
         assert.equal(main.image.split('@')[1],before.applications[def.applicationId+'/'+def.version].image.split('@')[1]);assert.deepEqual(main.args.slice(3),def.command);
         jobs.push({index:i,taskRunId:t.id,taskId:t.taskId,cluster,image:main.image});
         if(t.outputs['model.pt']){const uri=new URL(t.outputs['model.pt']),bucket=cluster==='cloud'?'cea-artifacts':`cea-artifacts-${cluster}`;assert.equal(uri.hostname,bucket);assert.equal(uri.protocol,'s3:');assert.match(uri.pathname,/^\/[A-Za-z0-9/._-]+$/);copies.push({source:`${cluster==='cloud'?'local':cluster}/${bucket}${uri.pathname}`,destination:`par24/models/${i}/${t.taskId}-${t.iteration}.pt`});}
       }
     }
   }
   const formal=rows.filter(r=>!r.warmup),summary={success:formal.length,planned:3,...Object.fromEntries(['fullGBps','computeGBps','fullSeconds','computeSeconds','totalSeconds','bytes'].map(k=>[k,mean(formal,r=>r[k])])),stages:Object.fromEntries(names.map(n=>[n,Object.fromEntries(Object.keys(formal[0]?.stages[n]??{}).map(k=>[k,mean(formal,r=>r.stages[n][k])]))]))};
   await save('audit',{result:'PASS',scope:'successful executions only',jobs,copies,rows,summary});console.log(JSON.stringify(summary,null,2));
 }else if(mode==='verify'){
   const before=await read('before'),published=await read('published'),executions=await idle();noObservers();
   for(const e of before.executions)assert.deepEqual(executions.find(r=>r.id===e.id),e);assert.equal(executions.length,before.executions.length+4);
   assert.equal((await all('/flows')).length,before.flows.length+1);for(const f of [...before.flows,published])assert.deepEqual(await api('/flows/'+f.flowId),f);
   for(const a of Object.values(before.applications))assert.deepEqual(await api('/applications/'+a.applicationId+'/versions/'+a.version),a);
   assert.deepEqual(await all('/resources/datasets'),before.datasets);assert.deepEqual(services(),before.services);assert.equal(await readFile(`${root}/deploy/cea/application.yaml`,'utf8'),before.config);
   assert.equal((await read('audit')).result,'PASS');assert.equal((await read('models-audit')).result,'PASS');
   for(let i=0;i<4;i++){assert((await read(`observers-stopped-${i}`)).every(r=>!r.execIds.length));const r=await read(`trial-${i}`);const response=await fetch(`${uiOrigin}/api/namespaces/lab/executions/${r.execution.id}/measurement`,{headers:{Authorization}});assert(response.ok);assert.deepEqual(await response.json(),r.measurement);}
   assert.equal((await(await fetch(origin+'/health')).json()).status,'UP');await save('after',{result:'PASS',executions:executions.length,flows:before.flows.length+1,services:services()});console.log('Original objects/services preserved; experiment and original measurement visible in CEA.');
 }else throw Error('register | run | review-failure | audit | verify');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main(process.argv[2]);
