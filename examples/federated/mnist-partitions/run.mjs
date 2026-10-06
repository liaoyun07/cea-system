import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {parse,stringify} from '../../../frontend/node_modules/yaml/dist/index.js';
import {connect,partitions} from './flows.mjs';
import {connectCifar,partitions as cifarPartitions} from '../cifar10-partitions/flows.mjs';

const root=path.resolve(import.meta.dirname,'../../..');
const kind=process.argv.includes('--equal')?'equal':'strong';
const dataset=process.argv.includes('--cifar10')?'cifar10':'mnist';
const choices=dataset==='cifar10'?cifarPartitions:partitions;
const connector=dataset==='cifar10'?connectCifar:connect;
const version=dataset==='cifar10'?'cifar-part-v1':'mnist-part-v1';
const sourceFolder=dataset==='cifar10'?path.resolve(import.meta.dirname,'../cifar10-partitions'):import.meta.dirname;
const target=dataset==='cifar10'?.90:.95;
const folder=path.join(root,`.local/cea/${dataset}-partitions/flow-${kind}`);
const settings=Object.fromEntries((await fs.readFile(path.join(root,'deploy/cea/.env'),'utf8')).split(/\r?\n/)
  .filter(l=>l&&!l.startsWith('#')).map(l=>{const n=l.indexOf('=');return[l.slice(0,n),l.slice(n+1)];}));
const authorization=`Basic ${Buffer.from(`${settings.BACKEND_USER}:${settings.BACKEND_PASSWORD}`).toString('base64')}`;
async function api(route,method='GET',body){
  const response=await fetch(`http://127.0.0.1:${settings.CEA_API_PORT}/api/namespaces/lab${route}`,{method,
    headers:{Authorization:authorization,'Content-Type':'application/json','Idempotency-Key':randomUUID()},
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
  assert(response.ok,`${method} ${route}: ${response.status}`);
  return response.json();
}
async function all(route){const rows=[];for(let offset=0;;offset+=100){const p=await api(`${route}?limit=100&offset=${offset}`);rows.push(...p);if(p.length<100)return rows;}}
const save=(name,value)=>fs.writeFile(path.join(folder,name),JSON.stringify(value,null,2),{flag:'wx'});
const read=async name=>JSON.parse(await fs.readFile(path.join(folder,name),'utf8'));
function services(){const ids=execFileSync('docker',['ps','-q','--filter','label=com.docker.compose.project=cea'],{encoding:'utf8'}).trim().split(/\s+/);
  return JSON.parse(execFileSync('docker',['inspect',...ids],{encoding:'utf8'})).map(c=>({id:c.Id,name:c.Name,image:c.Image,startedAt:c.State.StartedAt})).sort((a,b)=>a.name.localeCompare(b.name));}
const mode=process.argv[2];
await fs.mkdir(folder,{recursive:true});
if(mode==='register'){
  const image=process.argv[3];assert.match(image,/^registry-center:5000\/lab\/cea-federated@sha256:[a-f0-9]{64}$/);
  const flows=await all('/flows');
  assert(!flows.some(f=>new RegExp(`^${dataset}-(equal|strong)-(fedavg|fedcads)$`).test(f.flowId)),'Do not overwrite existing flows');
  assert((await all('/executions')).every(e=>['SUCCESS','FAILED','KILLED'].includes(e.state)),'Active execution');
  await save('before.json',{flows:await Promise.all(flows.map(f=>api(`/flows/${f.flowId}`))),services:services(),
    applicationConfig:await fs.readFile(path.join(root,'deploy/cea/application.yaml'),'utf8')});
  await save('image.json',{image});
  for(const p of Object.values(choices))assert.equal((await api(`/resources/datasets/${dataset}-train/versions/${p.version}`)).locations.length,3);
  for(const role of ['fl-init','fedavg-train','fl-aggregate','fl-evaluate','fedcads-init','fedcads-train','fedcads-aggregate','fedcads-evaluate']){
    const contract=await api(`/applications/${role}/versions/conv01-v1`);
    const next={...structuredClone(contract),version,image};
    if(next.parameters.DATASET?.dataset)next.parameters.DATASET.dataset.allowed.push(...Object.values(choices).map(p=>({datasetId:`${dataset}-train`,version:p.version})));
    if(next.parameters.TRAINING_DATASET?.choices)next.parameters.TRAINING_DATASET.choices.push(...Object.values(choices).map(p=>`${dataset}-train/${p.version}`));
    await api(`/applications/${role}/versions/${version}`,'PUT',next);
    assert.deepEqual(await api(`/applications/${role}/versions/conv01-v1`),contract);
    await fs.writeFile(path.join(sourceFolder,`${role}-contract.json`),JSON.stringify(next,null,2));
  }
  for(const algorithm of ['fedavg','fedcads'])for(const p of ['equal','strong']){
    const flow=connector(parse((await api(`/flows/conv02-${algorithm}-mnist`)).source),algorithm,p),source=stringify(flow);
    await api(`/flows/${flow.id}/validate`,'POST',{source});
    await api(`/flows/${flow.id}/revisions`,'POST',{source,expectedRevision:0});
    await fs.writeFile(path.join(sourceFolder,`${p}-${algorithm}.yaml`),source);
  }
  console.log('Connected two datasets with four independent flows and eight new contracts; original flows preserved.');
}else{
  assert.equal(mode,'run');
  const before=JSON.parse(await fs.readFile(path.join(root,`.local/cea/${dataset}-partitions/flow-strong/before.json`),'utf8'));
  assert.deepEqual(services(),before.services);
  const results=[];
  for(const algorithm of ['fedavg','fedcads']){
    const name=algorithm;
    try{results.push(await read(`${name}.json`));continue;}catch(error){if(error.code!=='ENOENT')throw error;}
    let accepted;
    try{accepted=await read(`${name}-accepted.json`);}catch(error){if(error.code!=='ENOENT')throw error;
      assert((await all('/executions')).every(e=>['SUCCESS','FAILED','KILLED'].includes(e.state)),'Unexpected active execution');
      accepted=await api('/executions','POST',{flowId:`${dataset}-${kind}-${algorithm}`,revision:1,inputs:{rounds:40,seed:31}});
      await save(`${name}-accepted.json`,accepted);
    }
    console.log(`${algorithm} ${kind} 40 rounds seed31: ${accepted.executionId}`);
    let execution,last=-1;const deadline=Date.now()+(dataset==='cifar10'?14400000:2700000);
    while(true){
      execution=await api(`/executions/${accepted.executionId}`);
      if(['SUCCESS','FAILED','KILLED'].includes(execution.state))break;
      assert(Date.now()<deadline,'Still active; retain accepted id, do not resubmit');
      const tasks=await api(`/executions/${accepted.executionId}/tasks`);
      const evaluations=tasks.filter(t=>t.taskId==='evaluate'&&t.state==='SUCCESS');
      if(evaluations.length!==last){last=evaluations.length;
        if(last){const t=evaluations.sort((a,b)=>Date.parse(a.endedAt)-Date.parse(b.endedAt)).at(-1);
          console.log(JSON.stringify({algorithm,...await api(`/executions/${accepted.executionId}/tasks/${t.id}/output-json?port=metrics.json`)}));}
        else console.log(`${algorithm}: init/training`);
      }
      await new Promise(resolve=>setTimeout(resolve,4000));
    }
    const tasks=await api(`/executions/${accepted.executionId}/tasks`),evaluations=[];
    for(const t of tasks.filter(t=>t.taskId==='evaluate'&&t.state==='SUCCESS'))evaluations.push({...await api(`/executions/${accepted.executionId}/tasks/${t.id}/output-json?port=metrics.json`),taskRunId:t.id,endedAt:t.endedAt});
    evaluations.sort((a,b)=>a.round-b.round);
    const result={algorithm,kind,seed:31,execution,tasks,evaluations,
      seconds:execution.state==='SUCCESS'?(Date.parse(execution.endedAt)-Date.parse(execution.startedAt))/1000:null};
    await save(`${name}.json`,result);results.push(result);
    assert.equal(execution.state,'SUCCESS','Failure retained, do not replace');
    assert.deepEqual(evaluations.map(e=>e.round),Array.from({length:40},(_,i)=>i+1));
    assert(evaluations.every(e=>e.samples===10000));
  }
  const summary=results.map(r=>({algorithm:r.algorithm,kind,seed:r.seed,state:r.execution.state,seconds:r.seconds,
    best:r.evaluations.reduce((a,b)=>a.accuracy>=b.accuracy?a:b),final:r.evaluations.at(-1),
    target,firstTarget:r.evaluations.find(e=>e.accuracy>=target)??null,
    ...(dataset==='mnist'?{first95:r.evaluations.find(e=>e.accuracy>=.95)??null}:{})}));
  for(const old of before.flows)assert.deepEqual(await api(`/flows/${old.flowId}`),old);
  assert.deepEqual(services(),before.services);
  assert.equal(await fs.readFile(path.join(root,'deploy/cea/application.yaml'),'utf8'),before.applicationConfig);
  await save('summary.json',summary);console.log(JSON.stringify(summary,null,2));
  if(dataset==='cifar10'&&kind==='strong'){
    const {finish}=await import('../cifar10-partitions/finish.mjs');
    await finish(root);
  }
}
