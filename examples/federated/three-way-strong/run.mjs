import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {stringify} from '../../../frontend/node_modules/yaml/dist/index.js';
import {datasets,algorithms,definition,filePath} from './definitions.mjs';
const root=path.resolve(import.meta.dirname,'../../..');
const folder=path.join(root,'.local/cea/three-way-strong-40');
const settings=Object.fromEntries((await fs.readFile(path.join(root,'deploy/cea/.env'),'utf8')).split(/\r?\n/)
  .filter(l=>l&&!l.startsWith('#')).map(l=>{const n=l.indexOf('=');return[l.slice(0,n),l.slice(n+1)];}));
const auth=`Basic ${Buffer.from(`${settings.BACKEND_USER}:${settings.BACKEND_PASSWORD}`).toString('base64')}`;
async function api(route,method='GET',body,key=randomUUID()) {
  const response=await fetch(`http://127.0.0.1:${settings.CEA_API_PORT}/api/namespaces/lab${route}`,{method,
    headers:{Authorization:auth,'Content-Type':'application/json','Idempotency-Key':key},
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
  assert(response.ok,`${method} ${route}: ${response.status}`);return response.json();
}
async function all(route) {const rows=[];for(let offset=0;;offset+=100){const p=await api(`${route}?limit=100&offset=${offset}`);rows.push(...p);if(p.length<100)return rows;}}
const terminal=e=>['SUCCESS','FAILED','KILLED'].includes(e.state);
const read=async name=>JSON.parse(await fs.readFile(path.join(folder,name),'utf8'));
const save=(name,value)=>fs.writeFile(path.join(folder,name),JSON.stringify(value,null,2),{flag:'wx'});
async function optional(name) {try{return await read(name);}catch(e){if(e.code!=='ENOENT')throw e;return null;}}
await fs.mkdir(folder,{recursive:true});
const mode=process.argv[2];
if(mode==='prepare') {
  assert((await all('/executions')).every(terminal),'An execution is active; do not compete for resources');
  const before=await optional('before.json');
  if(!before) await save('before.json',{flows:await Promise.all((await all('/flows')).map(f=>api(`/flows/${f.flowId}`)))});
  const existingFiles=await all('/files');
  if(!existingFiles.some(f=>f.path===filePath)) await api('/files','POST',{path:filePath,expectedRevision:0,content:await fs.readFile(new URL('hsam_entry.py',import.meta.url),'utf8')});
  const flows=await all('/flows');
  for(const dataset of datasets) for(const algorithm of algorithms) {
    const old=algorithm==='gfed-hsam'?null:await api(`/flows/${dataset}-strong-${algorithm}`);
    const flow=definition(dataset,algorithm,old?.source),source=stringify(flow);
    if(flows.some(f=>f.flowId===flow.id)) assert.equal((await api(`/flows/${flow.id}`)).source,source);
    else {await api(`/flows/${flow.id}/validate`,'POST',{source});await api(`/flows/${flow.id}/revisions`,'POST',{source,expectedRevision:0});}
    await fs.writeFile(path.join(folder,`${flow.id}.yaml`),source);
  }
  console.log('Six isolated comparison flows prepared; original flows and application images unchanged.');
} else {
  assert(['run','report'].includes(mode));
  const results=[];
  for(const dataset of datasets) for(const algorithm of algorithms) {
    const name=`${dataset}-${algorithm}`;
    let result=await optional(`${name}.json`);
    if(result){assert.equal(result.execution.state,'SUCCESS','Previous failure retained');results.push(result);continue;}
    let accepted=await optional(`${name}-accepted.json`);
    if(!accepted&&mode==='report') continue;
    if(!accepted) {
      assert((await all('/executions')).every(terminal),'Unexpected active execution');
      let request=await optional(`${name}-request.json`);
      if(!request){request={key:randomUUID(),body:{flowId:`compare40-${dataset}-${algorithm}`,revision:1,inputs:{rounds:40,local_epochs:1,batch_size:128,learning_rate:.1,seed:31}}};await save(`${name}-request.json`,request);}
      accepted=await api('/executions','POST',request.body,request.key);await save(`${name}-accepted.json`,accepted);
    }
    console.log(`${name}: ${accepted.executionId}`);
    let execution,last=-1;
    const deadline=Date.now()+12*3600000;
    while(true) {
      execution=await api(`/executions/${accepted.executionId}`);
      const tasks=await api(`/executions/${accepted.executionId}/tasks`);
      const evaluations=tasks.filter(t=>t.taskId==='evaluate'&&t.state==='SUCCESS').sort((a,b)=>Date.parse(a.endedAt)-Date.parse(b.endedAt));
      if(evaluations.length!==last){last=evaluations.length;const t=evaluations.at(-1);
        console.log(JSON.stringify({dataset,algorithm,state:execution.state,completedRounds:last,
          ...(t?await api(`/executions/${accepted.executionId}/tasks/${t.id}/output-json?port=metrics.json`):{})}));}
      if(terminal(execution)||mode==='report') break;
      assert(Date.now()<deadline,'Deadline exceeded; retain ID, never resubmit');
      await new Promise(r=>setTimeout(r,10000));
    }
    if(!terminal(execution))continue;
    const tasks=await api(`/executions/${accepted.executionId}/tasks`),evaluations=[];
    for(const t of tasks.filter(t=>t.taskId==='evaluate'&&t.state==='SUCCESS')) evaluations.push({
      ...await api(`/executions/${accepted.executionId}/tasks/${t.id}/output-json?port=metrics.json`),taskRunId:t.id,endedAt:t.endedAt,
      elapsedSeconds:(Date.parse(t.endedAt)-Date.parse(execution.startedAt))/1000});
    evaluations.sort((a,b)=>a.round-b.round);
    result={dataset,algorithm,execution,evaluations,seconds:execution.endedAt?(Date.parse(execution.endedAt)-Date.parse(execution.startedAt))/1000:null};
    await save(`${name}.json`,result);results.push(result);
    assert.equal(execution.state,'SUCCESS','Failure retained; stop subsequent trials');
    assert.deepEqual(evaluations.map(e=>e.round),Array.from({length:40},(_,i)=>i+1));
    assert(evaluations.every(e=>e.samples===10000));
    console.log(JSON.stringify({dataset,algorithm,seconds:result.seconds,final:evaluations.at(-1)}));
  }
  const summary=results.map(r=>({dataset:r.dataset,algorithm:r.algorithm,state:r.execution.state,seconds:r.seconds,
    final:r.evaluations.at(-1),best:r.evaluations.reduce((a,b)=>a.accuracy>=b.accuracy?a:b),
    first95:r.evaluations.find(e=>e.accuracy>=.95)??null,first90:r.evaluations.find(e=>e.accuracy>=.90)??null}));
  await fs.writeFile(path.join(folder,'summary.json'),JSON.stringify(summary,null,2));
  if(results.length===6){for(const flow of (await read('before.json')).flows)assert.deepEqual(await api(`/flows/${flow.flowId}`),flow);}
  console.log(JSON.stringify(summary,null,2));
}
