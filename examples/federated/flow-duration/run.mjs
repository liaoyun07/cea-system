import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {parse,stringify} from '../../../frontend/node_modules/yaml/dist/index.js';
const root=path.resolve(import.meta.dirname,'../../..');
const nextBatch=process.argv.includes('--next');
const folder=path.join(root,`.local/cea/conv02/${nextBatch?'cea-2':'cea-1'}`);
const settings=Object.fromEntries((await fs.readFile(path.join(root,'deploy/cea/.env'),'utf8')).split(/\r?\n/)
  .filter(l=>l&&!l.startsWith('#')).map(l=>{const n=l.indexOf('=');return[l.slice(0,n),l.slice(n+1)];}));
const auth=`Basic ${Buffer.from(`${settings.BACKEND_USER}:${settings.BACKEND_PASSWORD}`).toString('base64')}`;
async function api(route,method='GET',body){
  const r=await fetch(`http://127.0.0.1:${settings.CEA_API_PORT}/api/namespaces/lab${route}`,{method,
    headers:{Authorization:auth,'Content-Type':'application/json','Idempotency-Key':randomUUID()},
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
  assert(r.ok,`${method} ${route}: ${r.status}`);return r.json();
}
async function all(route){const rows=[];for(let offset=0;;offset+=100){const p=await api(`${route}?limit=100&offset=${offset}`);rows.push(...p);if(p.length<100)return rows;}}
const read=async name=>JSON.parse(await fs.readFile(path.join(folder,name),'utf8'));
const save=(name,value)=>fs.writeFile(path.join(folder,name),JSON.stringify(value,null,2),{flag:'wx'});
function services(){const ids=execFileSync('docker',['ps','-q','--filter','label=com.docker.compose.project=cea'],{encoding:'utf8'}).trim().split(/\s+/);
  return JSON.parse(execFileSync('docker',['inspect',...ids],{encoding:'utf8'})).map(c=>({id:c.Id,name:c.Name,image:c.Image,startedAt:c.State.StartedAt})).sort((a,b)=>a.name.localeCompare(b.name));}
const config={target:0.9,efficiencyTarget:0.25,budgets:nextBatch?{fedavg:11,fedcads:8}:{fedavg:10,fedcads:7},seeds:nextBatch?[81,91,101,111,121]:[31,41,51,61,71],
  learning_rate:0.1,batch_size:128,local_epochs:1,alpha:0.001,rho:0.1,cadsScheduleRounds:12,
  metric:'Execution.startedAt -> Execution.endedAt; only successful flows with final accuracy >=90% qualify',
  selection:nextBatch?'Exploratory second budgets Avg11/CADS8 after first group CADS seed51 final89.70%; five new seeds but same official test dataset, not untouched final data validation':
    'Exploratory fixed budgets from prior validation screen (Avg10/CADS7), not adaptive early stopping or unbiased final holdout claim'};
export function duration(execution){assert.equal(execution.state,'SUCCESS');const n=(Date.parse(execution.endedAt)-Date.parse(execution.startedAt))/1000;
  assert(Number.isFinite(n)&&n>0,'Missing actual flow start/end');return n;}
export function pair(a,c,target=.9){const valid=a?.execution.state==='SUCCESS'&&c?.execution.state==='SUCCESS'&&a.final.accuracy>=target&&c.final.accuracy>=target;
  return {valid:Boolean(valid),avg:a?{state:a.execution.state,accuracy:a.final?.accuracy,seconds:a.seconds}:null,
    cads:c?{state:c.execution.state,accuracy:c.final?.accuracy,seconds:c.seconds}:null,
    efficiency:valid?a.seconds/c.seconds-1:null,timeReduction:valid?1-c.seconds/a.seconds:null};}
export function transform(flow,algorithm){flow=structuredClone(flow);flow.id=`conv02-${algorithm}-mnist`;
  flow.description='FL-CONV-02 exploratory fixed-round complete-flow duration comparison';flow.inputs.rounds.defaultValue=config.budgets[algorithm];
  for(const task of [flow.tasks[0],flow.tasks[1].tasks[0].tasks[0],...flow.tasks[1].tasks.slice(1)]){
    const c=task.container;c.command[1]='/cea-work/in/flow_entry.py';
    c.namespaceFiles={'flow_entry.py':{path:'experiments/conv02/flow_entry.py',revision:1}};
    c.outputFiles=c.outputFiles.filter(p=>p!=='cea-measurement.json');
    if(c.parameters?.ROUNDS)c.parameters.ROUNDS={source:'LITERAL',value:config.cadsScheduleRounds};
  }
  return flow;
}
async function main(){await fs.mkdir(folder,{recursive:true});const mode=process.argv[2];
  if(mode==='register'){
    assert(!nextBatch,'Second batch reuses existing Flow revisions; use prepare --next');
    const flows=await all('/flows');assert(!flows.some(f=>f.flowId.startsWith('conv02-')));
    assert((await all('/executions')).every(e=>['SUCCESS','FAILED','KILLED'].includes(e.state)));
    await save('before.json',{flows:await Promise.all(flows.map(f=>api(`/flows/${f.flowId}`))),services:services(),
      applicationConfig:await fs.readFile(path.join(root,'deploy/cea/application.yaml'),'utf8')});await save('config.json',config);
    await api('/files','POST',{path:'experiments/conv02/flow_entry.py',expectedRevision:0,content:await fs.readFile(path.join(import.meta.dirname,'flow_entry.py'),'utf8')});
    for(const algorithm of ['fedavg','fedcads']){
      const flow=transform(parse((await api(`/flows/conv01-${algorithm}-mnist`)).source),algorithm),source=stringify(flow);
      await fs.writeFile(path.join(import.meta.dirname,`${algorithm}.yaml`),source);
      await api(`/flows/${flow.id}/validate`,'POST',{source});await api(`/flows/${flow.id}/revisions`,'POST',{source,expectedRevision:0});
    }
    console.log('Published two isolated flows with existing immutable image; no engine/SDK/restart changes.');return;
  }
  if(mode==='prepare'){
    assert(nextBatch);assert((await all('/executions')).every(e=>['SUCCESS','FAILED','KILLED'].includes(e.state)));
    const prior=JSON.parse(await fs.readFile(path.join(root,'.local/cea/conv02/cea-1/summary.json'),'utf8'));
    assert.deepEqual(services(),prior.servicesAfter);
    await save('before.json',{flows:await Promise.all((await all('/flows')).map(f=>api(`/flows/${f.flowId}`))),services:services(),
      applicationConfig:await fs.readFile(path.join(root,'deploy/cea/application.yaml'),'utf8')});
    await save('config.json',config);console.log('Frozen separate second batch Avg11/CADS8; no republish or old evidence overwrite.');return;
  }
  assert(['run','report'].includes(mode));const before=await read('before.json');assert.deepEqual(services(),before.services);
  const sequence=[...['fedavg','fedcads'].map(algorithm=>({algorithm,seed:13,rounds:2,warmup:true})),
    ...config.seeds.flatMap((seed,i)=>(i%2?['fedcads','fedavg']:['fedavg','fedcads']).map(algorithm=>({algorithm,seed,rounds:config.budgets[algorithm],warmup:false})))];
  const results=[];
  for(let i=0;i<sequence.length;i++){
    const item=sequence[i],name=`trial-${i}`;
    try{results.push(await read(`${name}.json`));continue;}catch(e){if(e.code!=='ENOENT')throw e;}
    if(mode==='report')continue;
    let accepted;try{accepted=await read(`${name}-accepted.json`);}catch(e){if(e.code!=='ENOENT')throw e;
      assert((await all('/executions')).every(e=>['SUCCESS','FAILED','KILLED'].includes(e.state)));
      accepted=await api('/executions','POST',{flowId:`conv02-${item.algorithm}-mnist`,revision:1,inputs:{seed:item.seed,rounds:item.rounds}});
      await save(`${name}-accepted.json`,accepted);}
    console.log(`${name} ${item.algorithm} seed=${item.seed} rounds=${item.rounds}: ${accepted.executionId}`);
    const deadline=Date.now()+1800000;let execution,last=-1;
    while(true){execution=await api(`/executions/${accepted.executionId}`);if(['SUCCESS','FAILED','KILLED'].includes(execution.state))break;
      assert(Date.now()<deadline,'Timeout; retain accepted ID and inspect, never resubmit');
      const count=(await api(`/executions/${accepted.executionId}/tasks`)).filter(t=>t.taskId==='evaluate'&&t.state==='SUCCESS').length;
      if(count!==last){console.log(`${name}: ${count} evaluations`);last=count;}await new Promise(r=>setTimeout(r,4000));}
    const tasks=await api(`/executions/${accepted.executionId}/tasks`),evaluations=[];
    for(const t of tasks.filter(t=>t.taskId==='evaluate'&&t.state==='SUCCESS'))evaluations.push({...await api(`/executions/${accepted.executionId}/tasks/${t.id}/output-json?port=metrics.json`),taskRunId:t.id});
    evaluations.sort((a,b)=>a.round-b.round);
    if(execution.state==='SUCCESS')assert.deepEqual(evaluations.map(e=>e.round),Array.from({length:item.rounds},(_,j)=>j+1));
    const result={...item,execution,tasks,evaluations,final:evaluations.at(-1)??null,seconds:execution.state==='SUCCESS'?duration(execution):null};
    await save(`${name}.json`,result);results.push(result);console.log(JSON.stringify({algorithm:item.algorithm,seed:item.seed,state:execution.state,seconds:result.seconds,final:result.final}));
    if(execution.state!=='SUCCESS')throw Error('Failure retained; diagnose before unattempted samples');
  }
  const pairs=config.seeds.map(seed=>({seed,...pair(results.find(r=>!r.warmup&&r.seed===seed&&r.algorithm==='fedavg'),results.find(r=>!r.warmup&&r.seed===seed&&r.algorithm==='fedcads'),config.target)}));
  const valid=pairs.filter(p=>p.valid),sum=k=>valid.reduce((s,p)=>s+p[k].seconds,0);
  const summary={config,pairs,validPairs:valid.length,meanEfficiency:valid.length?sum('avg')/sum('cads')-1:null,
    allFiveAtLeast25:pairs.every(p=>p.valid&&p.efficiency>=config.efficiencyTarget),servicesAfter:services()};
  assert.deepEqual(summary.servicesAfter,before.services);assert.equal(await fs.readFile(path.join(root,'deploy/cea/application.yaml'),'utf8'),before.applicationConfig);
  for(const old of before.flows)assert.deepEqual(await api(`/flows/${old.flowId}`),old);
  assert.equal((await all('/flows')).length,before.flows.length+(nextBatch?0:2));
  await save(mode==='report'?'partial-summary.json':'summary.json',summary);console.log(JSON.stringify({pairs,validPairs:summary.validPairs,meanEfficiency:summary.meanEfficiency,allFiveAtLeast25:summary.allFiveAtLeast25},null,2));
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)await main();
