import {readFileSync,writeFileSync,mkdirSync,unlinkSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {chromium} from '../../frontend/node_modules/playwright-core/index.mjs';
import {parse} from '../../frontend/node_modules/yaml/dist/index.js';
const folder='.local/cea/registry-download';mkdirSync(folder,{recursive:true});
const env=Object.fromEntries(readFileSync('deploy/cea/.env','utf8').split(/\r?\n/).filter(l=>/^[A-Z_0-9]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const authorization='Basic '+Buffer.from(env.BACKEND_USER+':'+env.BACKEND_PASSWORD).toString('base64');
const origin='http://127.0.0.1:'+(env.CEA_HTTP_PORT||18080);
const base=origin+'/api/namespaces/lab';
async function api(path){const response=await fetch(base+path,{headers:{Authorization:authorization}});assert(response.ok,path+': '+response.status);return response.json();}
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true}).trim();
const inventory=()=>JSON.parse(docker('inspect',...docker('ps','-q','--filter','name=cea-').split(/\s+/))).map(c=>({name:c.Name,id:c.Id,started:c.State.StartedAt}));
const save=(name,value)=>writeFileSync(folder+'/'+name,JSON.stringify(value,null,2));
if(process.argv[2]==='before'){
  let rows=[];for(let offset=0;;offset+=100){const page=await api('/executions?limit=100&offset='+offset);rows.push(...page);if(page.length<100)break;}
  assert(rows.every(e=>['SUCCESS','FAILED','CANCELLED','KILLED'].includes(e.state)),'Active ordinary execution');
  save('before.json',inventory());console.log('Release precheck PASS');
}else if(process.argv[2]==='e2e'){
  const result=spawnSync(process.execPath,['node_modules/@playwright/test/cli.js','test','tests/e2e/registry-inventory.spec.js','--reporter=list'],{
    cwd:'frontend',windowsHide:true,stdio:'inherit',env:{...process.env,CEA_E2E_URL:process.env.CEA_E2E_URL||'http://127.0.0.1:18190',CEA_E2E_USER:env.BACKEND_USER,CEA_E2E_PASSWORD:env.BACKEND_PASSWORD}});
  process.exit(result.status??1);
}else if(process.argv[2]==='live'){
  const registries=await api('/registries');assert(registries.length);
  const registry=registries.find(r=>r.id==='center')||registries[0];
  const rows=(await api(`/registries/${registry.id}/inventory?limit=100`)).images;
  let selected;
  const small=rows.filter(r=>r.repository==='lab/met04-small');
  for(const row of small.length?small:rows.slice(0,5)){const detail=await api(`/registries/${registry.id}/image?${new URLSearchParams({repository:row.repository,digest:row.digest})}`);if(detail.layerBytes!=null && (!selected||detail.layerBytes<selected.layerBytes))selected=detail;}
  assert(selected);save('selected.json',{registry:registry.id,...selected});
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1500,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin);await page.getByLabel('账号',{exact:true}).fill(env.BACKEND_USER);await page.getByLabel('密码',{exact:true}).fill(env.BACKEND_PASSWORD);await page.getByRole('button',{name:'连接工作空间 →',exact:true}).click();
    await page.getByRole('navigation').getByRole('button',{name:'镜像仓库',exact:true}).click();await page.getByRole('combobox',{name:'镜像仓库',exact:true}).selectOption(registry.id);
    await page.getByLabel('镜像仓库路径',{exact:true}).fill(selected.repository);await page.getByRole('button',{name:'筛选',exact:true}).click();
    const table=page.getByRole('table',{name:'实际镜像库存'});const matching=(await api(`/registries/${registry.id}/inventory?${new URLSearchParams({limit:'100',repository:selected.repository})}`)).images;
    const index=matching.findIndex(r=>r.repository===selected.repository&&r.digest===selected.digest);assert(index>=0 && index<20);
    const row=table.locator('tbody tr').nth(index);await row.getByRole('button',{name:'镜像详情',exact:true}).click();
    const detail=page.getByRole('region',{name:'镜像详情'});await detail.getByText(selected.digest,{exact:true}).waitFor();
    const pending=page.waitForEvent('download',{timeout:360000});await detail.getByRole('button',{name:'下载镜像',exact:true}).click();const file=await pending;
    assert.equal(await file.failure(),null);const archive=folder+'/'+file.suggestedFilename();await file.saveAs(archive);
    const manifest=JSON.parse(execFileSync('tar',['-xOf',archive,'manifest.json'],{encoding:'utf8'}))[0];
    assert.deepEqual(manifest.RepoTags.map(tag=>tag.replace(/^docker\.io\//,'')),[selected.repository+':sha256-'+selected.digest.slice(7,19)]);
    const config=execFileSync('tar',['-xOf',archive,manifest.Config]);
    const settings=parse(readFileSync('deploy/cea/application.yaml','utf8')).platform.distribution.registries[registry.id];
    const original=JSON.parse(docker('exec','cea-backend-1','skopeo','inspect','--raw','--tls-verify='+settings['tls-verify'],'--authfile',settings['auth-file'],'docker://'+settings.address+'/'+selected.repository+'@'+selected.digest));
    assert.equal('sha256:'+createHash('sha256').update(config).digest('hex'),original.config.digest);
    await page.screenshot({path:folder+'/page.png',fullPage:true});assert.deepEqual(errors,[]);
    const remaining=docker('exec','cea-backend-1','find','/var/lib/cea/uploads/import/downloads','-mindepth','1');assert.equal(remaining,'');
    const before=JSON.parse(readFileSync(folder+'/before.json')).filter(c=>!['/cea-backend-1','/cea-frontend-1'].includes(c.name));const after=inventory();for(const c of before)assert.deepEqual(after.find(a=>a.name===c.name),c);
    assert.deepEqual((await api(`/registries/${registry.id}/inventory?limit=100`)).images,rows);
    save('result.json',{status:'PASS',registry:registry.id,repository:selected.repository,digest:selected.digest,filename:file.suggestedFilename(),unchangedServices:before.length});
    unlinkSync(archive);console.log('Real browser archive + digest + cleanup PASS; unchanged services:',before.length);
  }finally{await browser.close();}
}else throw Error('before, e2e or live');
