// Two real, sequential runs of existing frozen workflows; no training or service changes.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync,copyFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {parse} from '../../../frontend/node_modules/yaml/dist/index.js';

const root=path.resolve(import.meta.dirname,'../../..');process.chdir(root);
const folder=path.join(root,'.local/cea/fl-resource95-20261017');mkdirSync(folder,{recursive:true});
const protocol={id:'FL-RESOURCE95-01',algorithms:['fedavg','fedcads'],rounds:40,seed:31,targetAccuracy:.95,
  trainingDataset:'mnist-train/strong-noniid-v1',testDataset:'mnist-test/v1',model:'mlp',localEpochs:1,batchSize:128,
  learningRate:.1,alpha:.001,rho:.1,clientSamples:[3000,12000,45000],clientWeights:[1,4,15],cadsSchedule:40,
  imageDigest:'sha256:71768d8fc05aaa34c2b97f657f08d2d31b5a1384bfa3e614b3fa5bdbe01df47b',
  helperDigest:'sha256:2d47e6a4a6e56d1e12ec9cb49515ec2c714874b90bc228ef2e2436c529183b02',
  measurement:'Init plus all rounds through first evaluation >=95%; include files-in/task/files-out and failed retries. Full 40 rounds retained separately.',
  repeatPolicy:'One seed, one pair, no failed-run replacement or tuning; reuse accepted IDs on resume.'};
const settings=Object.fromEntries(readFileSync('deploy/cea/.env','utf8').split(/\r?\n/).filter(l=>/^[A-Z_0-9]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const headers={Authorization:'Basic '+Buffer.from(settings.BACKEND_USER+':'+settings.BACKEND_PASSWORD).toString('base64'),'Content-Type':'application/json'};
async function api(route,body,key){const response=await fetch(`http://127.0.0.1:${settings.CEA_API_PORT}/api/namespaces/lab${route}`,{
  method:body?'POST':'GET',headers:{...headers,...(key?{'Idempotency-Key':key}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
  assert(response.ok,`${route}: HTTP ${response.status}`);return response.json();}
const save=(name,value,once=false)=>writeFileSync(path.join(folder,name),JSON.stringify(value,null,2),{flag:once?'wx':'w'});
const read=name=>JSON.parse(readFileSync(path.join(folder,name),'utf8'));
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true,maxBuffer:128*1024*1024}).trim();
const terminal=state=>['SUCCESS','FAILED','KILLED','SKIPPED'].includes(state);
async function all(route){const result=[];for(let offset=0;;offset+=100){const rows=await api(`${route}?limit=100&offset=${offset}`);result.push(...rows);if(rows.length<100)return result;}}
function services(){return JSON.parse(docker('inspect',...docker('ps','-q').split(/\s+/))).map(c=>({name:c.Name,id:c.Id,image:c.Image,started:c.State.StartedAt})).sort((a,b)=>a.name.localeCompare(b.name));}
function clusterFor(task){return task.taskId==='train'?['edge-a','edge-b','edge-c'][task.iteration-1]:'cloud';}
const roles=['fl-init','fedavg-train','fl-aggregate','fl-evaluate','fedcads-init','fedcads-train','fedcads-aggregate','fedcads-evaluate'];
async function freeze(){
  assert(!existsSync(folder+'/before.json'),'Already prepared; do not overwrite evidence');
  const executions=await all('/executions');assert(executions.every(e=>terminal(e.state)),'An ordinary workflow is active');
  const flows=await all('/flows'),definitions=await Promise.all(flows.map(f=>api('/flows/'+f.flowId)));
  for(const algorithm of protocol.algorithms){const f=definitions.find(f=>f.flowId==='mnist-strong-'+algorithm);assert(f);assert.equal(f.revision,1);
    assert.deepEqual(parse(f.source),parse(readFileSync(`examples/federated/mnist-partitions/strong-${algorithm}.yaml`,'utf8')),'Existing definition differs');}
  const contracts={};for(const role of roles){contracts[role]=await api(`/applications/${role}/versions/mnist-part-v1`);assert(contracts[role].image.endsWith('@'+protocol.imageDigest));}
  const datasets={};for(const [id,version] of [['mnist-train','strong-noniid-v1'],['mnist-test','v1']])datasets[id]=await api(`/resources/datasets/${id}/versions/${version}`);
  const storage=parse(readFileSync('deploy/cea/secrets/backend/storage-endpoints.yaml','utf8'));
  for(const cluster of ['cloud','edge-a','edge-b','edge-c'])assert(storage.platform.jobs.helpers.lab[cluster].endsWith('@'+protocol.helperDigest));
  const nodes={};for(const cluster of ['cloud','edge-a','edge-b','edge-c']){
    const data=JSON.parse(docker('exec','cea-'+cluster+'-1','kubectl','get','nodes','-o','json'));
    nodes[cluster]=data.items.map(n=>({name:n.metadata.name,capacity:n.status.capacity,allocatable:n.status.allocatable,conditions:n.status.conditions.map(c=>({type:c.type,status:c.status}))}));
    assert(nodes[cluster].every(n=>n.conditions.some(c=>c.type==='Ready'&&c.status==='True')));
  }
  mkdirSync(folder+'/before-files',{recursive:true});
  for(const file of ['README.md','docs/02-feature-index.md','docs/03-implementation-plan.md','docs/04-progress.md']){
    const target=folder+'/before-files/'+file;mkdirSync(path.dirname(target),{recursive:true});copyFileSync(file,target);}
  save('protocol.json',protocol,true);save('before.json',{flows:definitions,executions,contracts,datasets,services:services(),nodes,
    sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()},true);
  console.log(JSON.stringify({prepared:true,oldExecutions:executions.length,oldFlows:flows.length,services:services().length,protocol}));
}
async function run(){
  const before=read('before.json');assert.deepEqual(read('protocol.json'),protocol);assert.deepEqual(services(),before.services);
  for(const algorithm of protocol.algorithms){
    const receipt=algorithm+'-accepted.json';let accepted;
    if(existsSync(folder+'/'+receipt))accepted=read(receipt);
    else{
      assert((await all('/executions')).every(e=>terminal(e.state)),'Unexpected active execution');
      const flow=before.flows.find(f=>f.flowId==='mnist-strong-'+algorithm);assert.deepEqual(await api('/flows/'+flow.flowId),flow);
      accepted=await api('/executions',{flowId:flow.flowId,revision:1,inputs:{rounds:40,seed:31}},protocol.id+'-'+algorithm);
      save(receipt,accepted,true);
    }
    console.log(algorithm+' execution '+accepted.executionId);
    const prefix='/executions/'+accepted.executionId,evaluations=new Map();let execution;
    const deadline=Date.now()+3600000;
    while(true){
      execution=await api(prefix);const tasks=await api(prefix+'/tasks');
      for(const task of tasks.filter(t=>t.taskId==='evaluate'&&t.state==='SUCCESS'))if(!evaluations.has(task.id)){
        const value={...await api(`${prefix}/tasks/${task.id}/output-json?port=metrics.json`),taskRunId:task.id,endedAt:task.endedAt};
        assert.equal(value.round,task.iteration);assert.equal(value.samples,10000);assert(Number.isFinite(value.accuracy));evaluations.set(task.id,value);
        console.log(JSON.stringify({algorithm,round:value.round,accuracy:value.accuracy,seconds:(Date.parse(task.endedAt)-Date.parse(execution.startedAt))/1000}));
      }
      save('state.json',{algorithm,executionId:execution.id,state:execution.state,completedRounds:evaluations.size,lastEvaluation:[...evaluations.values()].at(-1),updatedAt:new Date().toISOString()});
      if(terminal(execution.state)){
        const usage=await api(prefix+'/resource-usage');save(algorithm+'.json',{algorithm,execution,tasks,evaluations:[...evaluations.values()].sort((a,b)=>a.round-b.round),usage});
        assert.equal(execution.state,'SUCCESS','Failed execution retained; no replacement run');
        assert.equal(evaluations.size,40);assert.equal(usage.status,'COMPLETE','Resource summary incomplete');
        assert.equal(new Set(usage.jobs.map(j=>j.taskRunId)).size,201);
        await auditJobs(algorithm);break;
      }
      assert(Date.now()<deadline,'Observation deadline reached; keep accepted ID, do not resubmit');
      await new Promise(resolve=>setTimeout(resolve,5000));
    }
  }
  const {summarize,compare}=await import('./analysis.mjs');
  const summaries=protocol.algorithms.map(a=>summarize(read(a+'.json'),.95));save('summary.json',{protocol,results:summaries,comparison:compare(...summaries)});
  await audit();console.log(JSON.stringify(read('summary.json'),null,2));
}
async function auditJobs(algorithm){
  const result=read(algorithm+'.json'),byId=new Map(result.tasks.map(t=>[t.id,t])),evidence=[];
  for(const cluster of ['cloud','edge-a','edge-b','edge-c']){
    const expected=result.usage.jobs.filter(j=>clusterFor(byId.get(j.taskRunId))===cluster);
    if(!expected.length)continue;
    const response=JSON.parse(docker('exec','cea-'+cluster+'-1','kubectl','-n','cea-lab','get','jobs',...expected.map(j=>j.usage.jobName),'-o','json'));
    const jobs=response.items||[response];assert.equal(jobs.length,expected.length);
    for(const job of jobs){const record=expected.find(j=>j.usage.jobName===job.metadata.name);assert.equal(job.metadata.uid,record.usage.jobUid);
      if(record.state==='SUCCESS')assert.equal(job.status.succeeded,1);
      else {assert.equal(record.state,'FAILED');assert(job.spec.suspend===true || job.status.failed>0,'Failed attempt must retain failure/suspension evidence');}
      const containers=[...job.spec.template.spec.initContainers,...job.spec.template.spec.containers];
      for(const c of containers)assert(c.image.endsWith('@'+(c.name==='task'?protocol.imageDigest:protocol.helperDigest)),c.name+' digest differs');
      evidence.push({cluster,name:job.metadata.name,uid:job.metadata.uid,taskRunId:record.taskRunId,attemptNo:record.attemptNo,containers:containers.map(c=>({name:c.name,image:c.image,resources:c.resources??{}}))});
    }
  }
  save(algorithm+'-jobs.json',evidence);console.log(algorithm+' actual Job identities/images audited: '+evidence.length);
}
async function audit(){
  const before=read('before.json');assert.deepEqual(services(),before.services,'Existing services changed');
  const executions=await all('/executions');for(const e of before.executions)assert.deepEqual(executions.find(n=>n.id===e.id),e);
  for(const flow of before.flows)assert.deepEqual(await api('/flows/'+flow.flowId),flow);
  for(const role of roles)assert.deepEqual(await api(`/applications/${role}/versions/mnist-part-v1`),before.contracts[role]);
  for(const [id,version] of [['mnist-train','strong-noniid-v1'],['mnist-test','v1']])assert.deepEqual(await api(`/resources/datasets/${id}/versions/${version}`),before.datasets[id]);
  const resourceSpecs=new Map();
  for(const algorithm of protocol.algorithms){
    const result=read(algorithm+'.json'),e=result.execution;assert.equal(e.flowId,'mnist-strong-'+algorithm);assert.equal(e.flowRevision,1);
    for(const [key,value] of Object.entries({rounds:40,seed:31,model:'mlp',training_dataset:protocol.trainingDataset,test_dataset:protocol.testDataset,local_epochs:1,batch_size:128,learning_rate:.1}))assert.deepEqual(e.inputs[key],value);
    assert.deepEqual(e.inputs.clients,['a','b','c'].map((c,i)=>({id:'edge-'+c,clusters:['edge-'+c],weight:[1,4,15][i]})));
    if(algorithm==='fedcads'){assert.equal(e.inputs.alpha,.001);assert.equal(e.inputs.rho,.1);}
    if(existsSync(folder+'/'+algorithm+'-prefix.json')){
      const {summarize}=await import('./analysis.mjs');assert.deepEqual(summarize(result).toTarget,read(algorithm+'-prefix.json').toTarget,'Later rounds changed first-target accounting');
    }
    for(const job of read(algorithm+'-jobs.json'))for(const container of job.containers){
      const key=job.cluster+'/'+container.name;
      if(resourceSpecs.has(key))assert.deepEqual(container.resources,resourceSpecs.get(key),'Resource specification changed: '+key);
      else resourceSpecs.set(key,container.resources);
    }
  }
  save('audit.json',{passed:true,oldExecutions:before.executions.length,oldFlows:before.flows.length,oldServices:before.services.length,contracts:roles.length,datasetsUnchanged:true,actualInputsVerified:true,resourceSpecs:Object.fromEntries(resourceSpecs)});
  console.log('Old executions, flows, contracts and services unchanged');
}
async function cleanup(){
  assert.equal(read('audit.json').passed,true);assert.equal(read('model-audit.json').passed,true);
  const results=new Map();
  for(const algorithm of protocol.algorithms){
    const result=read(algorithm+'.json');assert.equal(result.execution.id,read(algorithm+'-accepted.json').executionId);
    assert.equal(result.execution.state,'SUCCESS');assert.equal(result.usage.status,'COMPLETE');
    const records=read(algorithm+'-jobs.json');assert.equal(records.length,result.usage.jobs.length);
    assert.equal(new Set(records.map(j=>j.name)).size,records.length);
    for(const record of records){const job=result.usage.jobs.find(j=>j.taskRunId===record.taskRunId&&j.attemptNo===record.attemptNo);
      assert(job);assert.equal(record.name,job.usage.jobName);assert.equal(record.uid,job.usage.jobUid);}
    assert.deepEqual(await api('/executions/'+result.execution.id+'/resource-usage'),result.usage);
    results.set(algorithm,{result,records});
  }
  const removed=[];
  for(const algorithm of protocol.algorithms){
    const {result,records}=results.get(algorithm);
    for(const cluster of ['cloud','edge-a','edge-b','edge-c']){
      const selected=records.filter(j=>j.cluster===cluster);if(!selected.length)continue;
      for(const j of selected)assert.equal(j.name,`cea-${j.taskRunId}-a${j.attemptNo}`);
      const response=JSON.parse(docker('exec','cea-'+cluster+'-1','kubectl','-n','cea-lab','get','jobs',...selected.map(j=>j.name),'-o','json'));
      const current=response.items||[response];assert.equal(current.length,selected.length);
      for(const j of selected)assert.equal(current.find(k=>k.metadata.name===j.name)?.metadata.uid,j.uid,'Job identity changed');
      docker('exec','cea-'+cluster+'-1','kubectl','-n','cea-lab','delete','jobs',...selected.map(j=>j.name),'--wait=true');removed.push(...selected.map(j=>({cluster,name:j.name})));
    }
    assert.deepEqual(await api('/executions/'+result.execution.id+'/resource-usage'),result.usage,'Persisted usage changed after Job deletion');
  }
  save('cleanup.json',{removed,recordsPreserved:true});console.log('Cleaned only '+removed.length+' experiment Jobs; records/models retained');
}
try{
  const mode=process.argv[2];
  if(mode==='prepare')await freeze();
  else if(mode==='run')await run();
  else if(mode==='audit')await audit();
  else if(mode==='cleanup')await cleanup();
  else if(mode==='prefix'){
    const algorithm=process.argv[3];assert(protocol.algorithms.includes(algorithm));
    const id=read(algorithm+'-accepted.json').executionId,route='/executions/'+id;
    const execution=await api(route),tasks=await api(route+'/tasks'),evaluations=[];
    for(const task of tasks.filter(t=>t.taskId==='evaluate'&&t.state==='SUCCESS'))evaluations.push({...await api(`${route}/tasks/${task.id}/output-json?port=metrics.json`),taskRunId:task.id,endedAt:task.endedAt});
    const {summarize}=await import('./analysis.mjs'),summary=summarize({algorithm,execution,tasks,evaluations,usage:await api(route+'/resource-usage')});
    assert.equal(summary.status,'COMPLETE','First target prefix is not complete yet');save(algorithm+'-prefix.json',summary,true);
    console.log(JSON.stringify({algorithm,firstHitRound:summary.firstHitRound,firstHitAccuracy:summary.firstHitAccuracy,toTarget:summary.toTarget},null,2));
  }
  else if(mode==='inspect'){
    for(const algorithm of protocol.algorithms)if(existsSync(folder+'/'+algorithm+'-accepted.json')){
      const id=read(algorithm+'-accepted.json').executionId,execution=await api('/executions/'+id),tasks=await api('/executions/'+id+'/tasks'),usage=await api('/executions/'+id+'/resource-usage');
      const completed=tasks.filter(t=>['init','train','aggregate','evaluate'].includes(t.taskId)&&t.state==='SUCCESS');
      console.log(JSON.stringify({algorithm,id,state:execution.state,successfulTasks:completed.length,completeJobs:usage.completeJobs,
        finishedWithoutCompleteUsage:completed.filter(t=>!usage.jobs.some(j=>j.taskRunId===t.id&&j.usage?.containers.every(c=>c.status==='COMPLETE'))).map(t=>t.id),
        observedCpuCoreSeconds:usage.observedCpuCoreSeconds,observedMemoryGiBSeconds:usage.observedMemoryGiBSeconds,
        activeTasks:tasks.filter(t=>t.state==='RUNNING'&&['init','train','aggregate','evaluate'].includes(t.taskId)).map(t=>({id:t.id,taskId:t.taskId,iteration:t.iteration,startedAt:t.startedAt}))}));
    }
  }
  else if(mode==='report'){const {summarize,compare}=await import('./analysis.mjs');const results=protocol.algorithms.map(a=>summarize(read(a+'.json'),.95));save('summary.json',{protocol,results,comparison:compare(...results)});console.log(JSON.stringify(read('summary.json'),null,2));}
  else throw Error('Use prepare, run, inspect, prefix, audit, report or cleanup');
}catch(error){save('error-'+Date.now()+'.json',{message:error.message,at:new Date().toISOString()});throw error;}
