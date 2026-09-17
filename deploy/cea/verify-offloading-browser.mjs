// Read-only checks of the deployed OFF-03 page against actual backend records.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const settings=Object.fromEntries((await readFile(new URL('.env',import.meta.url),'utf8')).split(/\r?\n/).filter(v=>/^[A-Z_0-9]+=/.test(v)).map(v=>[v.slice(0,v.indexOf('=')),v.slice(v.indexOf('=')+1)]));
const evidence=new URL('../../.local/cea/off03/browser/',import.meta.url);await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({headless:true});const page=await browser.newPage({baseURL:`http://127.0.0.1:${settings.CEA_HTTP_PORT}`,viewport:{width:1440,height:1000}});const errors=[];
page.on('pageerror',e=>errors.push(e.message));
try {
  await page.goto(`http://127.0.0.1:${settings.CEA_HTTP_PORT}`);
  await page.getByLabel('账号',{exact:true}).fill(settings.BACKEND_USER);await page.getByLabel('密码',{exact:true}).fill(settings.BACKEND_PASSWORD);
  await page.getByRole('button',{name:'连接工作空间 →',exact:true}).click();
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'任务卸载决策记录',exact:true}).click();
  const response=await page.request.get(`/api/namespaces/lab/offloading/samples?limit=20&offset=0`,{headers:{Authorization:'Basic '+Buffer.from(settings.BACKEND_USER+':'+settings.BACKEND_PASSWORD).toString('base64')}});
  expect(response.status()).toBe(200);const rows=await response.json();const index=rows.findIndex(r=>r.measurement?.trainable);expect(index).toBeGreaterThanOrEqual(0);
  await expect(page.locator('.table-wrap tbody tr')).toHaveCount(rows.length);
  await page.locator('.table-wrap tbody tr').nth(index).getByRole('button',{name:'详情 →',exact:true}).click();
  await expect(page.getByRole('heading',{name:'样本完整',exact:true})).toBeVisible();
  const table=page.getByRole('table',{name:'卸载六维状态'});await expect(table.locator('tbody tr')).toHaveCount(6);
  for(let i=0;i<6;i++)await expect(table.locator('tbody tr').nth(i).locator('td').nth(1)).toHaveText(rows[index].measurement.inputs[i].toFixed(4));
  await expect(page.getByText(rows[index].measurement.elapsedSeconds.toFixed(3)+' 秒',{exact:true})).toBeVisible();
  await page.screenshot({path:fileURLToPath(new URL('measurement.png',evidence)),fullPage:true});
  await page.setViewportSize({width:390,height:1000});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:fileURLToPath(new URL('measurement-narrow.png',evidence)),fullPage:true});
  expect(errors).toEqual([]);
  await writeFile(new URL('result.json',evidence),JSON.stringify({result:'PASS',sample:rows[index].key,checkedAt:new Date().toISOString(),errors},null,2));
  console.log('PASS: deployed six-dimensional values, terminal elapsed, complete sample and 390px page.');
} finally {await browser.close();}
