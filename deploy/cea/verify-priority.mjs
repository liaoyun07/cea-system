// PRIO-01 release evidence. Does not edit existing Flows or resource settings.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = fileURLToPath(new URL('../../', import.meta.url));
const folder = `${root}/.local/cea/prio01`;
const env = Object.fromEntries((await readFile(new URL('.env', import.meta.url), 'utf8')).split(/\r?\n/)
  .filter(l => /^[A-Z_0-9]+=/.test(l)).map(l => { const n=l.indexOf('='); return [l.slice(0,n),l.slice(n+1)]; }));
const base = `http://127.0.0.1:${env.CEA_API_PORT}/api/namespaces/lab`;
const headers = {Authorization: `Basic ${Buffer.from(`${env.BACKEND_USER}:${env.BACKEND_PASSWORD}`).toString('base64')}`};
const save = (name, value) => writeFile(`${folder}/${name}.json`, JSON.stringify(value,null,2), {flag:'wx'});
async function api(path) { const reply=await fetch(base+path,{headers}); assert(reply.ok,`GET ${path}: ${reply.status}`); return reply.json(); }
async function all(path) {const items=[]; for(let offset=0;;offset+=100) {const page=await api(`${path}?limit=100&offset=${offset}`);items.push(...page);if(page.length<100)return items;} }
function services() {
  const ids=execFileSync('docker',['ps','-q','--filter','label=com.docker.compose.project=cea'],{encoding:'utf8'}).trim().split(/\s+/);
  return JSON.parse(execFileSync('docker',['inspect',...ids],{encoding:'utf8'})).map(c=>({id:c.Id,name:c.Name,image:c.Image,started:c.State.StartedAt})).sort((a,b)=>a.name.localeCompare(b.name));
}
async function snapshot() {
  const executions=await all('/executions');
  assert(executions.every(e=>['SUCCESS','FAILED','KILLED','SKIPPED'].includes(e.state)),'Active executions; do not publish');
  return {executions,services:services(),flows:await Promise.all((await all('/flows')).map(f=>api(`/flows/${f.flowId}`))),datasets:await all('/resources/datasets'),policies:await all('/edge/policies'),samples:await all('/offloading/samples')};
}
await mkdir(folder,{recursive:true});
const mode=process.argv[2];
if(mode==='capture') {
  const before=await snapshot();await save('before',before);
  for(const service of ['backend','frontend'])execFileSync('docker',['tag',before.services.find(c=>c.name===`/cea-${service}-1`).image,`cea/${service}:before-prio01`]);
  // Credentials stay inside the existing CEA MySQL container; dump is private local evidence.
  const dump=execFileSync('docker',['exec','cea-mysql-1','sh','-c','MYSQL_PWD="$MYSQL_PASSWORD" exec mysqldump -u"$MYSQL_USER" --single-transaction --no-tablespaces cea'],{maxBuffer:256*1024*1024});
  assert(dump.length>1000);await writeFile(`${folder}/database-before.sql`,dump,{flag:'wx'});
  console.log(`Captured ${before.executions.length} executions, ${before.flows.length} Flows, ${before.services.length} services; DB backup ${dump.length} bytes.`);
} else if(mode==='verify') {
  const before=JSON.parse(await readFile(`${folder}/before.json`,'utf8')),after=await snapshot();
  // API now exposes the added optional record field; persisted source/revision are compared verbatim.
  for(const flow of before.flows) {
    const visit=tasks=>{for(const task of tasks??[]) {task.priority??=null;for(const group of ['tasks','then','else'])visit(task[group]);}};
    for(const group of ['tasks','errors','finally','afterExecution'])visit(flow.definition[group]);
  }
  for(const old of before.executions)assert.deepEqual(after.executions.find(e=>e.id===old.id),old);
  for(const field of ['flows','datasets','policies','samples'])assert.deepEqual(after[field],before[field]);
  assert.equal(after.services.length,before.services.length);
  for(const old of before.services) {
    const now=after.services.find(c=>c.name===old.name);assert(now);
    if(['/cea-backend-1','/cea-frontend-1'].includes(old.name))assert.notEqual(now.id,old.id);
    else assert.deepEqual(now,old);
  }
  const schema=await api('/flows/editor/schema');
  const priority=schema.$defs.Task.properties.priority;
  assert(JSON.stringify(priority).includes('100'));assert(JSON.stringify(priority).includes('integer'));
  const migration=execFileSync('docker',['exec','cea-mysql-1','sh','-c',`MYSQL_PWD="$MYSQL_PASSWORD" exec mysql -u"$MYSQL_USER" cea -N -e "SELECT COUNT(*) FROM flyway_schema_history WHERE version='28' AND success=1"`],{encoding:'utf8'}).trim();
  assert.equal(migration,'1');await save('after',{...after,result:'PASS',migration:28});console.log('V28, priority schema, existing history/definitions and 17 unaffected services verified.');
} else if(mode==='browser') {
  const require=createRequire(new URL('../../frontend/package.json',import.meta.url));const {chromium,expect}=require('@playwright/test');
  const browser=await chromium.launch({headless:true});const errors=[];
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${env.CEA_HTTP_PORT}`);
    await page.getByLabel('账号',{exact:true}).fill(env.BACKEND_USER);await page.getByLabel('密码',{exact:true}).fill(env.BACKEND_PASSWORD);
    await page.getByRole('button',{name:'连接工作空间 →',exact:true}).click();
    await page.getByLabel('搜索流程',{exact:true}).fill('fedavg');
    await page.getByRole('button',{name:'搜索',exact:true}).click();
    await page.getByRole('button',{name:'fedavg',exact:true}).click();
    await page.getByRole('tab',{name:'可视化编排',exact:true}).click();
    await page.locator('[data-task="init"] > .task-card-header .task-select').click();
    const field=page.locator('[data-field="tasks.0.priority"]');await expect(field).toBeVisible();
    await field.getByRole('button').click();await field.locator('input').fill('80');await field.locator('input').blur();
    await page.getByRole('tab',{name:'并排编辑',exact:true}).click();await expect(page.getByLabel('Flow YAML')).toHaveValue(/priority: 80/);
    await page.screenshot({path:`${folder}/priority-desktop.png`,fullPage:true});
    await page.setViewportSize({width:390,height:1000});await page.getByRole('tab',{name:'可视化编排',exact:true}).click();
    await expect(field.locator('input')).toHaveValue('80');await page.screenshot({path:`${folder}/priority-narrow.png`,fullPage:true});
    assert.deepEqual(errors,[]);await save('browser',{result:'PASS',editedDraftOnly:true,errors});
  } finally {await browser.close();}
  console.log('Actual 18080 priority field/YAML draft verified; no Flow revision saved.');
} else throw new Error('capture | verify | browser');
