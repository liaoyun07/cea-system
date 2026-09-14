// Read-only deployed API/UI check. Creates screenshots only; never submits a workload.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../../', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '');
const require = createRequire(`${root}/frontend/package.json`);
const { chromium, expect } = require('@playwright/test');
const folder = `${root}/.local/cea/off04`;
const settings = Object.fromEntries((await readFile(`${root}/deploy/cea/.env`, 'utf8')).split(/\r?\n/).filter(v => /^[A-Z_0-9]+=/.test(v)).map(v => [v.slice(0,v.indexOf('=')), v.slice(v.indexOf('=')+1)]));
const headers = { Authorization: 'Basic ' + Buffer.from(settings.BACKEND_USER+':'+settings.BACKEND_PASSWORD).toString('base64') };
const all = [];
for (let offset=0; ; offset+=100) {
  const response = await fetch(`http://127.0.0.1:${settings.CEA_API_PORT}/api/namespaces/lab/offloading/samples?limit=100&offset=${offset}`, { headers });
  assert.equal(response.status, 200);
  const rows = await response.json(); all.push(...rows);
  if(rows.length<100) break;
}
const index = all.findIndex(s => s.strategy === 'DQN' && s.modelVersion?.startsWith('off04-trained-') && s.outcome === 'SUCCESS');
assert.ok(index>=0, 'No successful trained OFF-04 evaluation exists');
const sample = all[index];
assert.equal(sample.state.length, 6);
assert.ok(sample.measurement.elapsedSeconds>0);
const evaluated = all.filter(s=>s.strategy==='DQN' && s.modelVersion===sample.modelVersion);
const response = await fetch(`http://127.0.0.1:${settings.CEA_API_PORT}/api/namespaces/lab/offloading/models/${sample.modelVersion}`, {headers});
assert.equal(response.status,200);
const model = await response.json();
assert.equal(model.stateSchema,'measured-offload-log1p-v1');
const remaining = execFileSync('docker',['exec','cea-mysql-1','sh','-c',
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N -B "$MYSQL_DATABASE" -e "SELECT COUNT(*) FROM res_offload_workload WHERE namespace=\'lab\' AND released=FALSE"'],
  {encoding:'utf8',windowsHide:true}).trim();
assert.equal(remaining,'0','unfinished workload remains; run final verification after draining');
// Independently re-evaluate persisted states in JavaScript, not the gateway or trainer implementation.
for(const record of evaluated) {
  const hidden=model.weights1.map((row,i)=>Math.max(0,model.bias1[i]+row.reduce((sum,w,j)=>sum+w*record.state[j],0)));
  const q=model.weights2.map((row,i)=>model.bias2[i]+row.reduce((sum,w,j)=>sum+w*hidden[j],0));
  assert.ok(q.every(Number.isFinite));
  const expected=[...record.measurement.legalActions].sort((a,b)=>a-b).reduce((best,a)=>q[a]>q[best]?a:best);
  assert.equal(record.action,expected,'actual edge action differs from pinned greedy model');
  assert.equal(record.target.kind,['TERMINAL','EDGE','CLOUD'][expected]);
}
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: {width:1440,height:1000} });
  await page.goto(`http://127.0.0.1:${settings.CEA_HTTP_PORT}/`);
  await page.getByLabel('账号', {exact:true}).fill(settings.BACKEND_USER);
  await page.getByLabel('密码', {exact:true}).fill(settings.BACKEND_PASSWORD);
  await page.getByRole('button', {name:'连接工作空间 →', exact:true}).click();
  await page.getByRole('navigation', {name:'主导航'}).getByRole('button', {name:'卸载观测',exact:true}).click();
  await page.locator('tbody tr').first().waitFor();
  for(let i=0;i<Math.floor(index/20);i++) {
    const received = page.waitForResponse(r=>r.url().includes(`/offloading/samples?limit=20&offset=${(i+1)*20}`) && r.status()===200);
    await page.getByRole('button',{name:'下一页',exact:true}).click(); await received;
    await expect(page.locator('tbody tr').first().getByRole('button',{name:'详情 →',exact:true})).toBeEnabled();
  }
  await page.locator('tbody tr').nth(index%20).getByRole('button',{name:'详情 →',exact:true}).click();
  await page.getByText(sample.modelVersion,{exact:true}).waitFor();
  const table = page.getByRole('table',{name:'卸载六维状态'});
  await expect(table.locator('tbody tr')).toHaveCount(6);
  for(let i=0;i<6;i++) await expect(table.locator('tbody tr').nth(i).locator('td').nth(1)).toHaveText(sample.measurement.inputs[i].toFixed(4));
  await page.getByText(sample.measurement.elapsedSeconds.toFixed(3)+' 秒',{exact:true}).waitFor();
  await page.getByText(`${sample.target.kind} / ${sample.target.id}`,{exact:true}).waitFor();
  await page.screenshot({path:`${folder}/dqn-desktop.png`,fullPage:true});
  await page.setViewportSize({width:650,height:900});
  await page.getByText(sample.modelVersion,{exact:true}).waitFor();
  await page.screenshot({path:`${folder}/dqn-narrow.png`,fullPage:true});
  await writeFile(`${folder}/browser.json`, JSON.stringify({result:'PASS',sampleKey:sample.key,modelVersion:sample.modelVersion,layer:sample.target.kind,inputs:6,independentlyVerifiedActions:evaluated.length,elapsedSeconds:sample.measurement.elapsedSeconds,checkedAt:new Date().toISOString()},null,2));
  console.log('PASS: deployed DQN model, layer, six-state and terminal duration visible on desktop/narrow screens');
} finally { await browser.close(); }
