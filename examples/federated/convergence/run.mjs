import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {parse,stringify} from '../../../frontend/node_modules/yaml/dist/index.js';

const root=path.resolve(import.meta.dirname,'../../..');
const folder=path.join(root,'.local/cea/conv01/cea-1');
const id=algorithm=>`conv01-${algorithm}-mnist`;
const settings=Object.fromEntries((await fs.readFile(path.join(root,'deploy/cea/.env'),'utf8')).split(/\r?\n/)
  .filter(l=>l&&!l.startsWith('#')).map(l=>{const at=l.indexOf('=');return [l.slice(0,at),l.slice(at+1)];}));
const authorization=`Basic ${Buffer.from(`${settings.BACKEND_USER}:${settings.BACKEND_PASSWORD}`).toString('base64')}`;
async function api(route,method='GET',body){
  const response=await fetch(`http://127.0.0.1:${settings.CEA_API_PORT}/api/namespaces/lab${route}`,{
    method,headers:{Authorization:authorization,'Content-Type':'application/json','Idempotency-Key':randomUUID()},
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
  assert(response.ok,`${method} ${route}: ${response.status}`);
  return response.json();
}
const save=(name,value)=>fs.writeFile(path.join(folder,name),JSON.stringify(value,null,2),{flag:'wx'});
const read=async name=>JSON.parse(await fs.readFile(path.join(folder,name),'utf8'));
async function all(route){const rows=[];for(let offset=0;;offset+=100){const page=await api(`${route}?limit=100&offset=${offset}`);rows.push(...page);if(page.length<100)return rows;}}
function services(){const ids=execFileSync('docker',['ps','-q','--filter','label=com.docker.compose.project=cea'],{encoding:'utf8'}).trim().split(/\s+/);
  return JSON.parse(execFileSync('docker',['inspect',...ids],{encoding:'utf8'})).map(c=>({id:c.Id,name:c.Name,image:c.Image,startedAt:c.State.StartedAt})).sort((a,b)=>a.name.localeCompare(b.name));}
const config={targetAccuracy:0.9,improvementTarget:0.25,rounds:12,model:'mlp',batch_size:128,local_epochs:1,learning_rate:0.1,
  alpha:0.001,rho:0.1,seeds:[31,41,51,61,71],training_dataset:'mnist-train/v1',test_dataset:'mnist-test/v1',
  clients:[{id:'edge-a',clusters:['edge-a'],weight:1},{id:'edge-b',clusters:['edge-b'],weight:2},{id:'edge-c',clusters:['edge-c'],weight:3}],
  selection:'Validation-only screen: only lr0.1 reaches90%; rho0.1 stays above90, rho0.5 falls below. No official test tuning.',
  measurement:'Execution.createdAt to first successful evaluate.endedAt reaching90%; all rounds retained; not whole fixed-budget duration.'};

export function hit(rows,target){return rows.find(r=>r.accuracy>=target)??null;}
async function main(){
  await fs.mkdir(folder,{recursive:true});
  const mode=process.argv[2];
  if(mode==='register'){
    const flows=await all('/flows');
    assert(!flows.some(f=>[id('fedavg'),id('fedcads')].includes(f.flowId)),'Preserve existing experimental flows');
    const executions=await all('/executions');
    assert(executions.every(e=>['SUCCESS','FAILED','KILLED'].includes(e.state)),'Active execution; do not overlap');
    const before={flows:await Promise.all(flows.map(f=>api(`/flows/${f.flowId}`))),services:services(),
      applicationConfig:await fs.readFile(path.join(root,'deploy/cea/application.yaml'),'utf8')};
    await save('before.json',before);await save('config.json',config);
    const image=(await api('/applications/fedcads-init/versions/v2')).image;
    const roles={'fl-init':'par08-v1','fedavg-train':'par08-v1','fl-aggregate':'par16-v1','fl-evaluate':'par08-v1',
      'fedcads-init':'v2','fedcads-train':'v2','fedcads-aggregate':'v2','fedcads-evaluate':'v2'};
    for(const [role,version] of Object.entries(roles)){
      const original=await api(`/applications/${role}/versions/${version}`);
      await api(`/applications/${role}/versions/conv01-v1`,'PUT',{...original,version:'conv01-v1',image});
      assert.deepEqual(await api(`/applications/${role}/versions/${version}`),original);
    }
    for(const algorithm of ['fedavg','fedcads']){
      const original=await api(`/flows/${algorithm}`);
      const flow=parse(original.source);flow.id=id(algorithm);flow.description='FL-CONV-01 fixed validation-selected MNIST time-to-90% comparison';
      flow.inputs.seed={type:'INTEGER',defaultValue:31};
      for(const key of ['rounds','model','batch_size','local_epochs','learning_rate'])flow.inputs[key].defaultValue=config[key];
      if(algorithm==='fedcads'){flow.inputs.alpha.defaultValue=config.alpha;flow.inputs.rho.defaultValue=config.rho;}
      const leaves=[flow.tasks[0],flow.tasks[1].tasks[0].tasks[0],...flow.tasks[1].tasks.slice(1)];
      for(const task of leaves){task.container.version='conv01-v1';
        if(['init','train'].includes(task.id))task.container.parameters.SEED={source:'INPUT',name:'seed'};}
      const source=stringify(flow);
      await fs.writeFile(path.join(import.meta.dirname,`${algorithm}.yaml`),source);
      await api(`/flows/${flow.id}/validate`,'POST',{source});
      await api(`/flows/${flow.id}/revisions`,'POST',{source,expectedRevision:0});
    }
    console.log('Two isolated flows, eight versions, same immutable FedCADS-v2 image; no service restart.');
    return;
  }
  assert(['run','continue-planned','report'].includes(mode));
  const before=await read('before.json');assert.deepEqual(services(),before.services);
  assert.deepEqual(await read('config.json'),config);
  const sequence=[{algorithm:'fedavg',seed:13,warmup:true},{algorithm:'fedcads',seed:13,warmup:true},
    ...config.seeds.flatMap((seed,i)=>(i%2?['fedcads','fedavg']:['fedavg','fedcads']).map(algorithm=>({algorithm,seed,warmup:false})))];
  const results=[];
  for(let i=0;i<sequence.length;i++){
    const item=sequence[i],name=`trial-${i}`;
    try{const prior=await read(`${name}.json`);
      if(prior.execution.state!=='SUCCESS'){
        assert(['continue-planned','report'].includes(mode),'Inspect recorded failure before continuing unattempted samples');
        console.log(`Retain failed ${name}; no replacement execution.`);
      }
      results.push(prior);continue;
    }catch(error){if(error.code!=='ENOENT')throw error;}
    if(mode==='report')continue;
    const executions=await all('/executions');
    let accepted;
    try{accepted=await read(`${name}-accepted.json`);}catch(error){if(error.code!=='ENOENT')throw error;
      assert(executions.every(e=>['SUCCESS','FAILED','KILLED'].includes(e.state)),'Unexpected active execution');
      accepted=await api('/executions','POST',{flowId:id(item.algorithm),revision:1,inputs:{seed:item.seed,rounds:item.warmup?2:12}});
      await save(`${name}-accepted.json`,accepted);}
    console.log(`${name} ${item.algorithm} seed=${item.seed} warmup=${item.warmup}: ${accepted.executionId}`);
    const end=Date.now()+1800000;
    let execution,lastCount=-1;
    while(true){
      execution=await api(`/executions/${accepted.executionId}`);
      if(['SUCCESS','FAILED','KILLED'].includes(execution.state))break;
      assert(Date.now()<end,'Still active: retain ID; do not resubmit');
      const tasks=await api(`/executions/${accepted.executionId}/tasks`);
      const count=tasks.filter(t=>t.taskId==='evaluate'&&t.state==='SUCCESS').length;
      if(count!==lastCount){console.log(`${name}: ${count} evaluations completed`);lastCount=count;}
      await new Promise(resolve=>setTimeout(resolve,4000));
    }
    const tasks=await api(`/executions/${accepted.executionId}/tasks`);
    const evaluations=[];
    for(const task of tasks.filter(t=>t.taskId==='evaluate'&&t.state==='SUCCESS')){
      const metrics=await api(`/executions/${accepted.executionId}/tasks/${task.id}/output-json?port=metrics.json`);
      evaluations.push({...metrics,taskRunId:task.id,endedAt:task.endedAt,
        seconds:(Date.parse(task.endedAt)-Date.parse(execution.createdAt))/1000});
    }
    evaluations.sort((a,b)=>a.round-b.round);
    assert(evaluations.every(r=>Number.isFinite(r.seconds)&&r.seconds>0),'Missing evaluation completion timestamps');
    const firstHit=hit(evaluations,config.targetAccuracy);
    const result={...item,execution,tasks,evaluations,firstHit,
      allSubsequentAboveTarget:firstHit?evaluations.filter(r=>r.round>=firstHit.round).every(r=>r.accuracy>=config.targetAccuracy):false};
    await save(`${name}.json`,result);results.push(result);
    console.log(JSON.stringify({algorithm:item.algorithm,seed:item.seed,state:execution.state,firstHit}));
    if(execution.state!=='SUCCESS')throw Error('Failed execution retained; no replacements');
  }
  const pairs=config.seeds.map(seed=>{
    const avg=results.find(r=>!r.warmup&&r.seed===seed&&r.algorithm==='fedavg');
    const cads=results.find(r=>!r.warmup&&r.seed===seed&&r.algorithm==='fedcads');
    const complete=avg?.execution.state==='SUCCESS'&&cads?.execution.state==='SUCCESS';
    return {seed,complete,avgState:avg?.execution.state??'NOT_ATTEMPTED',cadsState:cads?.execution.state??'NOT_ATTEMPTED',
      avg:avg?.firstHit??null,cads:cads?.firstHit??null,
      improvement:complete&&avg.firstHit&&cads.firstHit?avg.firstHit.seconds/cads.firstHit.seconds-1:null,
      avgStable:avg?.allSubsequentAboveTarget??false,cadsStable:cads?.allSubsequentAboveTarget??false};
  });
  const validPairs=pairs.filter(p=>p.improvement!==null);
  const meanAvgSeconds=validPairs.length?validPairs.reduce((s,p)=>s+p.avg.seconds,0)/validPairs.length:null;
  const meanCadsSeconds=validPairs.length?validPairs.reduce((s,p)=>s+p.cads.seconds,0)/validPairs.length:null;
  const summary={config,pairs,validPairCount:validPairs.length,meanAvgSeconds,meanCadsSeconds,
    meanTimeEfficiency:validPairs.length?meanAvgSeconds/meanCadsSeconds-1:null,
    meanTimeReduction:validPairs.length?1-meanCadsSeconds/meanAvgSeconds:null,
    allFiveAtLeast25:pairs.every(p=>p.improvement!==null&&p.improvement>=0.25),
    allFiveCadsRemainAboveTarget:pairs.every(p=>p.complete&&p.cadsStable),servicesAfter:services()};
  assert.deepEqual(summary.servicesAfter,before.services);
  assert.equal(await fs.readFile(path.join(root,'deploy/cea/application.yaml'),'utf8'),before.applicationConfig);
  const after=await all('/flows');
  assert.equal(after.length,before.flows.length+2);
  for(const original of before.flows)assert.deepEqual(await api(`/flows/${original.flowId}`),original);
  await save(mode==='report'?'partial-summary.json':'summary.json',summary);console.log(JSON.stringify(summary.pairs,null,2));
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)await main();
