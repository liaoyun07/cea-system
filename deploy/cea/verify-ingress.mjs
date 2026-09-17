// ING-01: scoped CEA evidence and four explicit HTTP demos. Credentials never leave local config.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { get as httpGet } from 'node:http';
const root = fileURLToPath(new URL('../../', import.meta.url));
const folder = `${root}/.local/cea/ing01`;
const env = Object.fromEntries((await readFile(new URL('.env', import.meta.url), 'utf8')).split(/\r?\n/).filter(l => /^[A-Z_0-9]+=/.test(l)).map(l => { const i=l.indexOf('='); return [l.slice(0,i),l.slice(i+1)]; }));
const base = `http://127.0.0.1:${env.CEA_API_PORT}/api/namespaces/lab`;
const headers = {Authorization:`Basic ${Buffer.from(`${env.BACKEND_USER}:${env.BACKEND_PASSWORD}`).toString('base64')}`};
const targets = [['cloud',env.CEA_INGRESS_CLOUD_PORT||18090],['edge-a',env.CEA_INGRESS_EDGE_A_PORT||18091],['edge-b',env.CEA_INGRESS_EDGE_B_PORT||18092],['edge-c',env.CEA_INGRESS_EDGE_C_PORT||18093]];
const name = 'ing01-http-demo';
const docker = (...args) => execFileSync('docker',args,{encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024}).trim();
const pause = ms => new Promise(r=>setTimeout(r,ms));
async function api(path,method='GET',body) {const r=await fetch(base+path,{method,headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const s=await r.text();assert(r.ok,`${method} ${path}: ${r.status} ${s}`);return s?JSON.parse(s):null;}
async function all(path) {const out=[];for(let offset=0;;offset+=100){const rows=await api(`${path}?offset=${offset}&limit=100`);out.push(...rows);if(rows.length<100)return out;}}
const identity = row => `uid=${encodeURIComponent(row.uid)}&resourceVersion=${encodeURIComponent(row.resourceVersion)}`;
// Unlike this Node version's fetch, node:http sends the explicitly supplied Host unchanged.
function routeRequest(url, host) {return new Promise((resolve,reject)=>{const request=httpGet(url,{headers:{Host:host}},response=>{let body='';response.setEncoding('utf8');response.on('data',part=>body+=part);response.on('error',reject);response.on('end',()=>resolve({status:response.statusCode,json:async()=>JSON.parse(body)}));});request.on('error',reject);request.setTimeout(10000,()=>request.destroy(new Error('Ingress request timed out')));});}
const save = (name,value) => writeFile(`${folder}/${name}.json`,JSON.stringify(value,null,2),{flag:'wx'});
async function until(work,expected,milliseconds=60000) {const end=Date.now()+milliseconds;let actual;do{actual=await work();if(actual===expected)return;await pause(750);}while(Date.now()<end);assert.equal(actual,expected);}
function containers() {const ids=docker('ps','-q','--filter','label=com.docker.compose.project=cea').split(/\s+/);return JSON.parse(docker('inspect',...ids)).map(c=>({name:c.Name,id:c.Id,image:c.Image,started:c.State.StartedAt})).sort((a,b)=>a.name.localeCompare(b.name));}
function workloads(cluster) {return JSON.parse(docker('exec',`cea-${cluster}-1`,'kubectl','get','deployments,services,namespaces','-A','-o','json')).items.map(r=>({kind:r.kind,name:r.metadata.name,namespace:r.metadata.namespace,uid:r.metadata.uid,spec:r.spec,labels:r.metadata.labels,annotations:r.metadata.annotations}));}
async function snapshot() {const executions=await all('/executions');assert(executions.every(e=>['SUCCESS','FAILED','KILLED','SKIPPED'].includes(e.state)),'Active Flow; postpone release');return {executions,flows:await Promise.all((await all('/flows')).map(f=>api(`/flows/${f.flowId}`))),datasets:await all('/resources/datasets'),policies:await all('/edge/policies'),samples:await all('/offloading/samples'),containers:containers(),workloads:Object.fromEntries(targets.map(([c])=>[c,workloads(c)]))};}
await mkdir(folder,{recursive:true});
const mode=process.argv[2];
if(mode==='capture') {
  const before=await snapshot();await save('before',before);
  for(const role of ['backend','frontend'])docker('tag',before.containers.find(c=>c.name===`/cea-${role}-1`).image,`cea/${role}:before-ing01`);
  console.log(`Captured ${before.executions.length} executions/${before.flows.length} Flows/${before.containers.length} CEA containers; rollback images retained.`);
} else if(mode==='probe') {
  const results=[];
  for(const [cluster,port] of targets) {
    const k=`/clusters/${cluster}/kubernetes/namespaces/cea-lab`, deployment=`/clusters/${cluster}/deployments/${name}`;
    // Refuse to overwrite an existing demo: a repeated probe must explicitly inspect the previous evidence.
    assert(!(await api(`${k}/services`)).some(s=>s.name===name),`${cluster} demo already exists`);
    assert(!workloads(cluster).some(r=>r.kind==='Deployment' && r.namespace==='cea-lab' && r.name===name),`${cluster} demo Deployment already exists`);
    const code=`import json,os\nfrom http.server import BaseHTTPRequestHandler,HTTPServer\nclass H(BaseHTTPRequestHandler):\n def do_GET(self):\n  body=json.dumps({'demo':'ing01','cluster':'${cluster}','pod':os.environ.get('HOSTNAME'),'path':self.path}).encode()\n  self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)\nHTTPServer(('0.0.0.0',8080),H).serve_forever()`;
    await api(deployment,'PUT',{applicationId:'httpserver',version:'v1',replicas:1,parameters:{},command:['python','-u','-c',code],readiness:{path:'/health',port:8080}});
    await until(async()=>(await api(deployment)).readyReplicas,1,120000);
    const service=await api(`${k}/services`,'POST',{name,type:'ClusterIP',selector:{'cea-system/deployment':name},ports:[{name:'http',port:80,targetPort:'8080',protocol:'TCP',nodePort:null}]});
    const routes=[{host:'demo.example.test',path:'/api',pathType:'Prefix',service:name,port:80},{host:'',path:'/health',pathType:'Exact',service:name,port:80}];
    let rule=await api(`${k}/ingresses`,'POST',{name,ingressClassName:'cea-traefik',routes});
    const request=(path,host='demo.example.test')=>routeRequest(`http://127.0.0.1:${port}${path}`,host);
    await until(async()=>(await request('/api/child')).status,200);
    const response=await(await request('/api/child')).json();assert.equal(response.cluster,cluster);assert.equal(response.path,'/api/child');
    assert.equal((await request('/api/child','wrong.example.test')).status,404);
    assert.equal((await request('/api-other')).status,404);
    assert.equal((await request('/health','wrong.example.test')).status,200);
    assert.equal((await request('/health/extra')).status,404);
    rule=await api(`${k}/ingresses/${name}?${identity(rule)}`,'PUT',{name,ingressClassName:'cea-traefik',routes:[{host:'',path:'/updated',pathType:'Exact',service:name,port:80}]});
    await until(async()=>(await request('/updated')).status,200);
    assert.equal((await request('/api/child')).status,404);
    await api(`${k}/ingresses/${name}?${identity(rule)}`,'DELETE');
    await until(async()=>(await request('/updated')).status,404);
    assert.equal((await api(`${k}/services/${name}`)).uid,service.uid);
    assert.equal((await api(deployment)).readyReplicas,1);
    rule=await api(`${k}/ingresses`,'POST',{name,ingressClassName:'cea-traefik',routes:[{host:'',path:'/',pathType:'Prefix',service:name,port:80}]});
    await until(async()=>(await request('/')).status,200);
    results.push({cluster,url:`http://127.0.0.1:${port}/`,response,checks:['host','prefix','exact','update','delete','backend-preserved','demo-restored'],ingressUid:rule.uid});
    console.log(`${cluster}: Host/Prefix/Exact/update/delete PASS; demo retained at http://127.0.0.1:${port}/`);
  }
  await save('probes',{result:'PASS',results});
} else if(mode==='verify') {
  const before=JSON.parse(await readFile(`${folder}/before.json`,'utf8')),after=JSON.parse(JSON.stringify(await snapshot()));
  for(const field of ['executions','flows','datasets','policies','samples'])assert.deepEqual(after[field],before[field]);
  for(const old of before.containers) {
    const now=after.containers.find(c=>c.name===old.name);assert(now);
    if(['/cea-backend-1','/cea-frontend-1'].includes(old.name))assert.notEqual(now.id,old.id);else assert.deepEqual(now,old);
  }
  assert.equal(after.containers.length,before.containers.length+1);
  for(const [cluster] of targets)for(const old of before.workloads[cluster])assert.deepEqual(after.workloads[cluster].find(r=>r.uid===old.uid),old);
  await save('after',{...after,result:'PASS'});console.log('Original definitions/executions/data and 17 unaffected containers/workloads preserved; only ingress-access added.');
} else if(mode==='browser') {
  const require=createRequire(new URL('../../frontend/package.json',import.meta.url));const {chromium,expect}=require('@playwright/test');
  const browser=await chromium.launch({headless:true});const errors=[];
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${env.CEA_HTTP_PORT}`);
    await page.getByLabel('账号',{exact:true}).fill(env.BACKEND_USER);await page.getByLabel('密码',{exact:true}).fill(env.BACKEND_PASSWORD);
    await page.getByRole('button',{name:'连接工作空间 →',exact:true}).click();
    await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'服务与访问入口',exact:true}).click();
    await page.getByRole('tab',{name:'Ingress',exact:true}).click();
    for(const [cluster,port] of targets) {
      await page.getByLabel('资源集群').selectOption(cluster);
      const row=page.getByRole('table',{name:'Ingress',exact:true}).getByRole('row').filter({hasText:name});await expect(row).toBeVisible();
      await expect(row).toContainText(String(port));await row.getByRole('button',{name:'详情',exact:true}).click();
      const link=page.getByRole('region',{name:'Ingress 详情'}).getByRole('link',{name:'访问 ↗'});await expect(link).toHaveAttribute('href',`http://127.0.0.1:${port}/`);
      const popupPromise=page.waitForEvent('popup');await link.click();const popup=await popupPromise;await popup.waitForLoadState();await expect(popup.locator('body')).toContainText(cluster);await popup.close();
    }
    await page.screenshot({path:`${folder}/ingress-desktop.png`,fullPage:true});
    await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:`${folder}/ingress-narrow.png`,fullPage:true});assert.deepEqual(errors,[]);
    await save('browser',{result:'PASS',errors,clusters:4});
  } finally {await browser.close();}
  console.log('18080 Ingress tab and all four actual browser links verified, desktop/390px PASS.');
} else throw new Error('capture | probe | verify | browser');
