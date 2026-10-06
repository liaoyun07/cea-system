// Bounded two-round acceptance, not a convergence experiment or retry-until-pass.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const root = path.resolve(import.meta.dirname, '../../..');
const folder = path.join(root, '.local/cea/gfed-hsam');
const settings = Object.fromEntries((await fs.readFile(path.join(root, 'deploy/cea/.env'), 'utf8'))
  .split(/\r?\n/).filter(l => l && !l.startsWith('#')).map(l => {const p=l.indexOf('='); return [l.slice(0,p),l.slice(p+1)];}));
const headers = {Authorization: `Basic ${Buffer.from(`${settings.BACKEND_USER}:${settings.BACKEND_PASSWORD}`).toString('base64')}`,
  'Content-Type': 'application/json'};
async function api(route, method='GET', body) {
  const response = await fetch(`http://127.0.0.1:${settings.CEA_API_PORT}/api/namespaces/lab${route}`, {
    method, headers: {...headers, 'Idempotency-Key': randomUUID()},
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000)});
  assert(response.ok, `${route}: ${response.status}`); return response.json();
}
async function all(route) {
  const result=[];
  for(let offset=0;;offset+=100) {const page=await api(`${route}?limit=100&offset=${offset}`);
    result.push(...page); if(page.length<100) return result;}
}
function services() {
  const ids=execFileSync('docker',['ps','-q','--filter','label=com.docker.compose.project=cea'],{encoding:'utf8'}).trim().split(/\s+/);
  return JSON.parse(execFileSync('docker',['inspect',...ids],{encoding:'utf8'}))
    .map(c=>({id:c.Id,name:c.Name,image:c.Image,startedAt:c.State.StartedAt})).sort((a,b)=>a.name.localeCompare(b.name));
}
const save=(name,value)=>fs.writeFile(path.join(folder,name),JSON.stringify(value,null,2),{flag:'wx'});
await fs.mkdir(folder,{recursive:true});
const mode=process.argv[2];
if(mode==='before') {
  const active=(await all('/executions')).filter(e=>!['SUCCESS','FAILED','KILLED'].includes(e.state));
  assert.equal(active.length,0,'Existing active executions; do not contend with experiments');
  const flows=await all('/flows');
  await save('before.json',{services:services(),flows:await Promise.all(flows.map(f=>api(`/flows/${f.flowId}`))),
    applications:await all('/applications'),datasets:await all('/resources/datasets')});
  console.log(`Saved ${flows.length} existing flows and ${services().length} services; no active executions.`);
} else if(mode==='run') {
  let accepted;
  try {accepted=JSON.parse(await fs.readFile(path.join(folder,'accepted.json'),'utf8'));}
  catch(error) {if(error.code!=='ENOENT')throw error;
    assert((await all('/executions')).every(e=>['SUCCESS','FAILED','KILLED'].includes(e.state)),'Unexpected active execution');
    accepted=await api('/executions','POST',{flowId:'gfed-hsam',revision:1,inputs:{rounds:2,seed:31}});
    await save('accepted.json',accepted);
  }
  console.log(`GFed-HSAM two-round acceptance: ${accepted.executionId}`);
  let execution,last=-1;const deadline=Date.now()+1800000;
  while(true) {
    execution=await api(`/executions/${accepted.executionId}`);
    if(['SUCCESS','FAILED','KILLED'].includes(execution.state))break;
    assert(Date.now()<deadline,'Still active; retain execution id, do not resubmit');
    const tasks=await api(`/executions/${accepted.executionId}/tasks`);
    const done=tasks.filter(t=>t.taskId==='evaluate'&&t.state==='SUCCESS');
    if(done.length!==last) {last=done.length; console.log(`Completed evaluations: ${last}`);}
    await new Promise(r=>setTimeout(r,4000));
  }
  const tasks=await api(`/executions/${accepted.executionId}/tasks`),evaluations=[];
  for(const t of tasks.filter(t=>t.taskId==='evaluate'&&t.state==='SUCCESS')) {
    evaluations.push(await api(`/executions/${accepted.executionId}/tasks/${t.id}/output-json?port=metrics.json`));
  }
  evaluations.sort((a,b)=>a.round-b.round);
  await save('result.json',{execution,tasks,evaluations});
  assert.equal(execution.state,'SUCCESS','Failure retained; do not replace test run');
  assert.deepEqual(evaluations.map(e=>e.round),[1,2]);
  assert(evaluations.every(e=>e.samples===10000&&e.algorithm==='gfed-hsam'));
  assert.equal(tasks.filter(t=>t.taskId==='train'&&t.state==='SUCCESS').length,6);
  console.log(JSON.stringify({executionId:accepted.executionId,state:execution.state,evaluations},null,2));
} else {
  assert.equal(mode,'after');
  const before=JSON.parse(await fs.readFile(path.join(folder,'before.json'),'utf8'));
  for(const flow of before.flows)assert.deepEqual(await api(`/flows/${flow.flowId}`),flow);
  const applications=await all('/applications');
  for(const app of before.applications) assert.deepEqual(applications.find(a=>a.applicationId===app.applicationId&&a.version===app.version),app);
  assert.deepEqual(await all('/resources/datasets'),before.datasets);
  assert.deepEqual(services(),before.services);
  const result={passed:true,originalFlows:before.flows.length,originalApplications:before.applications.length,
    originalDatasets:before.datasets.length,services:before.services.length};
  await save('preservation.json',result); console.log(JSON.stringify(result));
}
