import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {chromium} from '../../frontend/node_modules/playwright-core/index.mjs';
const folder='.local/cea/job-resources';mkdirSync(folder,{recursive:true});
const env=Object.fromEntries(readFileSync('deploy/cea/.env','utf8').split(/\r?\n/).filter(l=>/^[A-Z_0-9]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const headers={Authorization:'Basic '+Buffer.from(env.BACKEND_USER+':'+env.BACKEND_PASSWORD).toString('base64'),'Content-Type':'application/json'};
const base='http://127.0.0.1:'+(env.CEA_API_PORT||18085)+'/api/namespaces/lab';
async function api(path,body,extra={}) {const r=await fetch(base+path,{headers:{...headers,...extra},method:body?'POST':'GET',body:body?JSON.stringify(body):undefined});assert(r.ok,`${path}: ${r.status} ${r.ok?'':await r.text()}`);return r.json();}
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true}).trim();
const inventory=()=>JSON.parse(docker('inspect',...docker('ps','-q','--filter','name=cea-').split(/\s+/))).map(c=>({name:c.Name,id:c.Id,started:c.State.StartedAt}));
const save=(name,v)=>writeFileSync(folder+'/'+name,JSON.stringify(v,null,2));
if(process.argv[2]==='before') {
  let executions=[];for(let offset=0;;offset+=100){const rows=await api('/executions?limit=100&offset='+offset);executions.push(...rows);if(rows.length<100)break;}
  assert(executions.every(e=>['SUCCESS','FAILED','CANCELLED','KILLED'].includes(e.state)), 'Wait for active flows before release');
  save('before.json',inventory());console.log('No active ordinary executions; saved service inventory');
} else if(process.argv[2]==='run') {
  const flowId='verify-job-resources-20261015';
  const cases=[['both',{limits:{cpu:'250m',memory:'128Mi'}}],['cpu',{limits:{cpu:'0.5'}}],['memory',{limits:{memory:'128Mi'}}],['blank',{limits:{cpu:'',memory:''}}],['legacy',null]];
  const flow={schemaVersion:1,namespace:'lab',id:flowId,tasks:cases.map(([id,resources])=>({id,type:'platform.Application',timeout:'PT3M',container:{applicationId:'edge-bearing',version:'ep01-v1',candidateClusters:['cloud'],command:['sh','-c','cat /sys/fs/cgroup/cpu.max; cat /sys/fs/cgroup/memory.max'],...(resources?{resources}:{})}}))};
  const receipt=folder+'/run.json';let state=existsSync(receipt)?JSON.parse(readFileSync(receipt)):null;
  if(!state){const revision=await api('/flows/'+flowId+'/revisions',{expectedRevision:0,source:JSON.stringify(flow)});state={flowId,revision:revision.revision,id:null};save('run.json',state);state.id=(await api('/executions',{flowId,revision:revision.revision,inputs:{}},{'Idempotency-Key':flowId})).executionId;save('run.json',state);}
  assert(state.id,'Inspect accepted execution; do not resubmit');
  for(let i=0;i<120;i++){const v=await api('/executions/'+state.id);console.log(v.state);if(['SUCCESS','FAILED','CANCELLED'].includes(v.state)){assert.equal(v.state,'SUCCESS',v.error);break;}assert(i<119,'Execution did not finish');await new Promise(r=>setTimeout(r,3000));}
  const tasks=await api('/executions/'+state.id+'/tasks');const evidence=[];
  for(const t of tasks){
    const name='cea-'+t.id+'-a1';const job=JSON.parse(docker('exec','cea-cloud-1','kubectl','-n','cea-lab','get','job',name,'-o','json'));
    const pods=JSON.parse(docker('exec','cea-cloud-1','kubectl','-n','cea-lab','get','pods','-l','job-name='+name,'-o','json')).items;assert.equal(pods.length,1);
    const main=pods[0].spec.containers.find(c=>c.name==='task'),res=main.resources||{};
    const expected={both:{cpu:'250m',memory:'128Mi'},cpu:{cpu:'500m'},memory:{memory:'128Mi'},blank:{},legacy:{}}[t.taskId];
    assert(expected,'Unexpected TaskRun identity: '+JSON.stringify(t));assert.deepEqual(res.limits||{},expected);assert.deepEqual(res.requests||{},expected);
    assert.deepEqual(job.spec.template.spec.containers.find(c=>c.name==='task').resources?.limits||{},expected);
    for(const c of [...pods[0].spec.initContainers,...pods[0].spec.containers.filter(c=>c.name!=='task')])assert.deepEqual(c.resources||{},{});
    const logs=docker('exec','cea-cloud-1','kubectl','-n','cea-lab','logs',pods[0].metadata.name,'-c','task');
    const [cpu,memory]=logs.split(/\r?\n/);if(expected.cpu){const [quota,period]=cpu.split(' ').map(Number);assert.equal(quota/period,t.taskId==='both'?.25:.5);}if(expected.memory)assert.equal(Number(memory),128*1048576);
    evidence.push({task:t.taskId,job:name,resources:res,cgroup:logs});
  }
  assert.equal(evidence.length,5);save('jobs.json',evidence);console.log(JSON.stringify(evidence));
} else if(process.argv[2]==='page') {
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1600,height:1050}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:'+(env.CEA_HTTP_PORT||18080));await page.getByLabel('账号',{exact:true}).fill(env.BACKEND_USER);await page.getByLabel('密码',{exact:true}).fill(env.BACKEND_PASSWORD);await page.getByRole('button',{name:'连接工作空间 →',exact:true}).click();
    await page.getByRole('button',{name:'＋ 新建流程',exact:true}).click();const id='verify-job-resources-ui-20261015';await page.getByLabel('流程 ID',{exact:true}).fill(id);
    await page.getByRole('tab',{name:'源代码',exact:true}).click();await page.getByLabel('Flow YAML').fill(`schemaVersion: 1\nnamespace: lab\nid: ${id}\ntasks:\n  - id: probe\n    type: platform.Application\n    timeout: PT1M\n    container:\n      applicationId: edge-bearing\n      version: ep01-v1\n      candidateClusters: [cloud]\n      command: [sh, -c, 'true']\n`);
    await page.getByRole('tab',{name:'可视化编排',exact:true}).click();await page.locator('[data-task="probe"] > .task-card-header .task-select').click();
    for(const name of ['资源限制','上限','CPU 上限','内存上限'])await page.getByRole('button',{name:'＋ 设置 '+name,exact:true}).click();
    await page.getByLabel('CPU 上限',{exact:true}).fill('500m');await page.getByLabel('CPU 上限',{exact:true}).blur();await page.getByLabel('内存上限',{exact:true}).fill('512Mi');await page.getByLabel('内存上限',{exact:true}).blur();
    await page.getByRole('button',{name:'保存修订',exact:true}).click();await page.getByRole('status').filter({hasText:'已保存修订 r1'}).waitFor();await page.getByRole('button',{name:'重新读取',exact:true}).click();await page.getByRole('status').filter({hasText:'已读取最新修订 r1'}).waitFor();
    assert.equal(await page.getByLabel('CPU 上限',{exact:true}).inputValue(),'500m');assert.equal(await page.getByLabel('内存上限',{exact:true}).inputValue(),'512Mi');
    await page.locator('.task-inspector').screenshot({path:folder+'/editor.png'});
    const saved=await api('/flows/'+id);assert.deepEqual(saved.definition.tasks[0].container.resources.limits,{cpu:'500m',memory:'512Mi'});
    await page.getByLabel('CPU 上限',{exact:true}).fill('');await page.getByLabel('CPU 上限',{exact:true}).blur();await page.getByRole('button',{name:'保存修订',exact:true}).click();await page.getByRole('status').filter({hasText:'已保存修订 r2'}).waitFor();assert.equal((await api('/flows/'+id)).definition.tasks[0].container.resources.limits.cpu,null);
    await page.getByRole('button',{name:'移除 resources',exact:true}).click();await page.getByRole('button',{name:'保存修订',exact:true}).click();await page.getByRole('status').filter({hasText:'已保存修订 r3'}).waitFor();assert.equal((await api('/flows/'+id)).definition.tasks[0].container.resources,null);
    assert.deepEqual(errors,[]);const before=JSON.parse(readFileSync(folder+'/before.json')).filter(c=>!['/cea-backend-1','/cea-frontend-1'].includes(c.name));const after=inventory();for(const c of before)assert.deepEqual(after.find(a=>a.name===c.name),c);save('page.json',{status:'PASS',unchangedServices:before.length});console.log('Page PASS; unchanged services:',before.length);
  } finally {await browser.close();}
} else throw Error('Use before, run, or page');
