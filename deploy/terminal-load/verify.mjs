// TERM-LOAD-01: only its own load run and simulator resources are exercised.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const folder = `${root}/.local/cea/terminal-load`;
const env = Object.fromEntries((await readFile(`${root}/deploy/cea/.env`, 'utf8')).split(/\r?\n/).filter(l=>/^[A-Z_0-9]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const base = `http://127.0.0.1:${env.CEA_API_PORT}/api/namespaces/lab`;
const headers = {Authorization:`Basic ${Buffer.from(`${env.BACKEND_USER}:${env.BACKEND_PASSWORD}`).toString('base64')}`, 'Content-Type':'application/json'};
const command = args=>execFileSync('docker',args,{encoding:'utf8',maxBuffer:64*1024*1024,windowsHide:true});
const save = (name,value)=>writeFile(`${folder}/${name}.json`,JSON.stringify(value,null,2));
const wait = ms=>new Promise(r=>setTimeout(r,ms));
async function api(path,body) {const r=await fetch(base+path,{headers,method:body===undefined?'GET':'POST',body:body===undefined?undefined:JSON.stringify(body)});assert(r.ok,`${path}: ${r.status} ${r.ok?'':await r.text()}`);return r.status===204?null:r.json();}
async function all(path) {const rows=[];for(let offset=0;;offset+=100){const page=await api(`${path}?limit=100&offset=${offset}`);rows.push(...page);if(page.length<100)return rows;}}
function services() {const ids=command(['ps','-q','--filter','label=com.docker.compose.project=cea']).trim().split(/\s+/);return JSON.parse(command(['inspect',...ids])).map(c=>({id:c.Id,name:c.Name,image:c.Image,started:c.State.StartedAt}));}
async function snapshot() {return {services:services(),flows:await Promise.all((await all('/flows')).map(f=>api(`/flows/${f.flowId}`))),policies:await all('/edge/policies'),datasets:await all('/resources/datasets')};}
await mkdir(folder,{recursive:true});
const mode=process.argv[2];
if(mode==='ready') {
  const active=(await all('/executions')).filter(e=>!['SUCCESS','FAILED','KILLED','SKIPPED'].includes(e.state));
  assert.equal(active.length,0,'Existing executions still active; defer deployment');
  console.log('No active CEA executions.');
} else if(mode==='capture') {
  const before=await snapshot();
  await writeFile(`${folder}/before.json`,JSON.stringify(before,null,2),{flag:'wx'});
  for(const service of ['backend','frontend'])command(['tag',before.services.find(c=>c.name===`/cea-${service}-1`).image,`cea/${service}:before-terminal-load`]);
  const dump=execFileSync('docker',['exec','cea-mysql-1','sh','-c','MYSQL_PWD="$MYSQL_PASSWORD" exec mysqldump -u"$MYSQL_USER" --single-transaction --no-tablespaces cea'],{maxBuffer:512*1024*1024,windowsHide:true});
  assert(dump.length>1000);await writeFile(`${folder}/database-before.sql`,dump,{flag:'wx'});
  console.log(`Captured ${before.flows.length} Flows, ${before.services.length} services; DB backup ${dump.length} bytes.`);
} else if(mode==='preserved') {
  const before=JSON.parse(await readFile(`${folder}/before.json`)),after=await snapshot();
  for(const old of before.services)if(!['/cea-backend-1','/cea-frontend-1'].includes(old.name))assert.deepEqual(after.services.find(c=>c.name===old.name),old);
  for(const field of ['flows','policies','datasets'])for(const old of before[field])assert(after[field].some(row=>JSON.stringify(row)===JSON.stringify(old)),`Old ${field} changed`);
  await save('preserved',{checkedAt:new Date().toISOString(),oldServices:before.services.length-2,oldFlows:before.flows.length,result:'PASS'});
  console.log('Old services, Flows, policies and datasets preserved.');
} else if(mode==='browser' || mode==='screenshot') {
  const require=createRequire(new URL('../../frontend/package.json',import.meta.url));const {chromium,expect}=require('@playwright/test');
  const browser=await chromium.launch({headless:true});const errors=[];let runId;
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1050}});page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${env.CEA_HTTP_PORT}`);
    await page.getByLabel('账号',{exact:true}).fill(env.BACKEND_USER);await page.getByLabel('密码',{exact:true}).fill(env.BACKEND_PASSWORD);
    await page.getByRole('button',{name:'连接工作空间 →',exact:true}).click();
    await page.getByRole('button',{name:'终端设备接入',exact:true}).click();
    await expect(page.getByRole('cell',{name:'sim-terminal-001',exact:true})).toBeVisible();
    await page.screenshot({path:`${folder}/devices.png`,fullPage:true});
    await page.getByRole('button',{name:'负载与调度',exact:true}).click();
    if(mode==='screenshot') {
      await page.getByLabel('展示区间').selectOption('0');await wait(2200);
      await page.screenshot({path:`${folder}/load-desktop.png`,fullPage:true});
      await page.setViewportSize({width:740,height:1050});await page.screenshot({path:`${folder}/load-narrow.png`,fullPage:true});
      assert.deepEqual(errors,[]);console.log('Actual page screenshots verified.');
    } else {
    for(const id of ['sim-terminal-001','sim-terminal-002','sim-terminal-003','sim-terminal-004'])await page.getByRole('checkbox',{name:new RegExp(id)}).check();
    await page.getByLabel('每台平均请求间隔（秒）').fill('8');await page.getByLabel('输入规模').selectOption('mixed');
    const response=page.waitForResponse(r=>r.url().endsWith('/edge/load/runs')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'开始发送',exact:true}).click();runId=(await(await response).json()).id;assert(runId);
    await save('test-run',{id:runId});
    await wait(25000);await page.getByRole('button',{name:'DQN 智能卸载',exact:true}).click();
    await wait(25000);await page.getByRole('button',{name:'停止发送',exact:true}).click();
    let view;
    for(let i=0;i<180;i++) {
      view=await api(`/edge/load/runs/${runId}`);
      if(!(await api('/edge/load/devices')).some(d=>d.loadRunId===runId))break;
      await wait(2000);
    }
    await save('test-result',view);
    await save(`run-${runId}`,view);
    assert(view.data.requests.length>0);assert.equal(view.data.phases.length,2);
    const accepted=view.data.requests.filter(r=>r.executionId);
    assert(accepted.every(r=>r.outcome==='SUCCESS'),JSON.stringify(accepted.filter(r=>r.outcome!=='SUCCESS')));
    assert.equal(view.targets.length,accepted.length);
    const byPhase=Object.fromEntries(view.data.phases.map(p=>[p.number,p.strategy]));
    for(const t of view.targets)if(byPhase[view.data.requests.find(r=>r.executionId===t.executionId).phase]==='LOCAL')assert.equal(t.target.kind,'TERMINAL');
    await page.getByLabel('展示区间').selectOption('0');await wait(2200);
    await expect(page.getByRole('heading',{name:'任务执行位置',exact:true})).toBeVisible();
    await page.screenshot({path:`${folder}/load-desktop.png`,fullPage:true});
    await page.setViewportSize({width:740,height:1050});await page.screenshot({path:`${folder}/load-narrow.png`,fullPage:true});
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({runId,completed:accepted.length,rejected:view.data.requests.length-accepted.length,samples:view.data.samples.length,targets:view.targets.map(t=>t.target.kind)}));
    }
  } finally {
    if(runId)await api(`/edge/load/runs/${runId}/stop`,{});
    await browser.close();
  }
} else throw new Error('Use capture, preserved or browser');
