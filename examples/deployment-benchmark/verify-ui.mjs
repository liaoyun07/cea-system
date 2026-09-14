// Read-only 18080 verification of retained deployments and their measured history.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../',import.meta.url));
const folder=path.resolve(process.argv[2]||'');
assert.ok(folder.startsWith(path.join(root,'.local','cea','met04')+path.sep));
const require=createRequire(path.join(root,'frontend/package.json'));
const {chromium,expect}=require('@playwright/test');
const settings=Object.fromEntries((await readFile(path.join(root,'deploy/cea/.env'),'utf8')).split(/\r?\n/).filter(x=>/^[A-Z_0-9]+=/.test(x)).map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
const display=JSON.parse(await readFile(path.join(folder,'display.json'),'utf8'));
const browser=await chromium.launch();
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto(`http://127.0.0.1:${settings.CEA_HTTP_PORT}/`);
  await page.getByLabel('账号',{exact:true}).fill(settings.BACKEND_USER);
  await page.getByLabel('密码',{exact:true}).fill(settings.BACKEND_PASSWORD);
  await page.getByRole('button',{name:'连接工作空间 →',exact:true}).click();
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'应用部署',exact:true}).click();
  await page.getByLabel('执行集群',{exact:true}).selectOption('edge-a');
  for(const item of display) {
    const row=page.locator('tbody tr').filter({has:page.getByText(item.name,{exact:true})});
    await expect(row).toContainText('成功');
    await expect(row).toContainText((item.operation.durationMs/1000).toFixed(2)+' s');
  }
  await page.screenshot({path:path.join(folder,'deployments-desktop.png'),fullPage:true});
  for(const item of display) {
    await page.locator('tbody tr').filter({has:page.getByText(item.name,{exact:true})}).getByRole('button',{name:'详情 →',exact:true}).click();
    await expect(page.getByText('部署操作历史',{exact:true})).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(5);
    await page.getByRole('button',{name:'← 返回列表',exact:true}).click();
  }
  await page.setViewportSize({width:650,height:900});
  for(const item of display)await expect(page.getByText(item.name,{exact:true})).toBeVisible();
  await page.screenshot({path:path.join(folder,'deployments-narrow.png'),fullPage:true});
  await writeFile(path.join(folder,'browser.json'),JSON.stringify({result:'PASS',checkedAt:new Date().toISOString(),deployments:display.map(x=>x.name),histories:5,readOnly:true},null,2));
  console.log('PASS: 18080 shows three live services, original API duration and five history entries each');
}finally{await browser.close();}
