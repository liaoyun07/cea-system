import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {parse,stringify} from '../../../frontend/node_modules/yaml/dist/index.js';
const root=path.resolve(import.meta.dirname,'../../..'),folder=path.join(root,'.local/cea/cifar300');
const settings=Object.fromEntries((await fs.readFile(path.join(root,'deploy/cea/.env'),'utf8')).split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const n=l.indexOf('=');return[l.slice(0,n),l.slice(n+1)];}));
const authorization=`Basic ${Buffer.from(`${settings.BACKEND_USER}:${settings.BACKEND_PASSWORD}`).toString('base64')}`;
async function api(route,method='GET',body){
  const response=await fetch(`http://127.0.0.1:${settings.CEA_API_PORT}/api/namespaces/lab${route}`,{method,
    headers:{Authorization:authorization,'Content-Type':'application/json','Idempotency-Key':randomUUID()},
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
  assert(response.ok,`${method} ${route}: ${response.status}`);return response.json();
}
async function all(route){const rows=[];for(let offset=0;;offset+=100){const p=await api(`${route}?limit=100&offset=${offset}`);rows.push(...p);if(p.length<100)return rows;}}
const save=(name,value)=>fs.writeFile(path.join(folder,name),JSON.stringify(value,null,2),{flag:'wx'});
await fs.mkdir(folder,{recursive:true});
if(process.argv[2]==='register'){
  const image=process.argv[3];assert.match(image,/^registry-center:5000\/lab\/cea-federated@sha256:[a-f0-9]{64}$/);
  assert((await all('/executions')).every(e=>['SUCCESS','FAILED','KILLED'].includes(e.state)),'Wait for old cancellation');
  await save('image.json',{image});
  for(const role of ['fl-init','fedavg-train','fl-aggregate','fl-evaluate','fedcads-init','fedcads-train','fedcads-aggregate','fedcads-evaluate']){
    const old=await api(`/applications/${role}/versions/cifar-part-v1`);
    const next={...structuredClone(old),version:'cifar300-v1',image};
    if(next.parameters.MODEL)next.parameters.MODEL.choices.push('lenet');
    await api(`/applications/${role}/versions/cifar300-v1`,'PUT',next);
    assert.deepEqual(await api(`/applications/${role}/versions/cifar-part-v1`),old);
    await fs.writeFile(path.join(import.meta.dirname,`${role}-contract.json`),JSON.stringify(next,null,2));
  }
  for(const algorithm of ['fedavg','fedcads']){
    const flow=parse((await api(`/flows/cifar10-strong-${algorithm}`)).source);
    flow.id=`cifar300-strong-${algorithm}`;
    flow.description='CIFAR-10 strong non-IID 2500/10000/37500; author LeNet/fusion, 5 local epochs, 300 complete rounds; unchanged other hyperparameters';
    flow.inputs.rounds.defaultValue=300;flow.inputs.local_epochs.defaultValue=5;flow.inputs.model.defaultValue='lenet';
    const leaves=[flow.tasks[0],flow.tasks[1].tasks[0].tasks[0],...flow.tasks[1].tasks.slice(1)];
    for(const task of leaves){task.container.version='cifar300-v1';task.timeout='PT30M';}
    const source=stringify(flow);
    await api(`/flows/${flow.id}/validate`,'POST',{source});
    await api(`/flows/${flow.id}/revisions`,'POST',{source,expectedRevision:0});
    await fs.writeFile(path.join(import.meta.dirname,`${algorithm}.yaml`),source);
  }
  console.log('Registered two 300-round LeNet flows and eight independent contracts');
}else{
  assert.equal(process.argv[2],'run');
  const results=[];
  for(const algorithm of ['fedavg','fedcads']){
    let accepted;
    try{accepted=JSON.parse(await fs.readFile(path.join(folder,`${algorithm}-accepted.json`),'utf8'));}
    catch(error){if(error.code!=='ENOENT')throw error;
      assert((await all('/executions')).every(e=>['SUCCESS','FAILED','KILLED'].includes(e.state)),'Unexpected active execution');
      accepted=await api('/executions','POST',{flowId:`cifar300-strong-${algorithm}`,revision:1,inputs:{rounds:300,local_epochs:5,model:'lenet',seed:31}});
      await save(`${algorithm}-accepted.json`,accepted);
    }
    console.log(`${algorithm} 300 rounds: ${accepted.executionId}`);
    let execution,last=-1;
    while(true){
      execution=await api(`/executions/${accepted.executionId}`);
      if(['SUCCESS','FAILED','KILLED'].includes(execution.state))break;
      const tasks=await api(`/executions/${accepted.executionId}/tasks`);
      const done=tasks.filter(t=>t.taskId==='evaluate'&&t.state==='SUCCESS');
      if(done.length!==last){last=done.length;
        if(last){const task=done.sort((a,b)=>Date.parse(a.endedAt)-Date.parse(b.endedAt)).at(-1);
          const metrics=await api(`/executions/${accepted.executionId}/tasks/${task.id}/output-json?port=metrics.json`);
          await fs.writeFile(path.join(folder,`${algorithm}-progress.json`),JSON.stringify({executionId:accepted.executionId,...metrics},null,2));
          console.log(JSON.stringify(metrics));
        }else console.log('init/first train');
      }
      await new Promise(r=>setTimeout(r,15000));
    }
    const tasks=await api(`/executions/${accepted.executionId}/tasks`),evaluations=[];
    for(const t of tasks.filter(t=>t.taskId==='evaluate'&&t.state==='SUCCESS'))evaluations.push({...await api(`/executions/${accepted.executionId}/tasks/${t.id}/output-json?port=metrics.json`),taskRunId:t.id,endedAt:t.endedAt});
    evaluations.sort((a,b)=>a.round-b.round);
    const trial={algorithm,execution,tasks,evaluations,seconds:execution.state==='SUCCESS'?(Date.parse(execution.endedAt)-Date.parse(execution.startedAt))/1000:null};
    await save(`${algorithm}.json`,trial);
    assert.equal(execution.state,'SUCCESS','Failure retained; no automatic replacement');
    assert.deepEqual(evaluations.map(e=>e.round),Array.from({length:300},(_,i)=>i+1));assert(evaluations.every(e=>e.samples===10000));
    const first=evaluations.find(e=>e.accuracy>=.90);
    results.push({algorithm,wholeFlowSeconds:trial.seconds,best:evaluations.reduce((a,b)=>a.accuracy>=b.accuracy?a:b),final:evaluations.at(-1),
      first90Round:first?.round??null,first90Seconds:first?(Date.parse(first.endedAt)-Date.parse(execution.startedAt))/1000:null});
  }
  await save('comparison.json',{results,speedGainPercent:results.every(r=>r.first90Seconds)?(results[0].first90Seconds/results[1].first90Seconds-1)*100:null});
  console.log(JSON.stringify(results,null,2));
}
