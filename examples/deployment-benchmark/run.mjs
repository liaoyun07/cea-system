// Real CEA deployment requests; private evidence only, never rewrites timing records.
import { openAsBlob } from 'node:fs';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../../', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '');
const version = process.argv[2] || 'met04-v1';
assert.match(version,/^[a-z0-9][a-z0-9.-]{0,39}$/);
const settings = Object.fromEntries((await readFile(`${root}/deploy/cea/.env`, 'utf8')).split(/\r?\n/).filter(v => /^[A-Z_0-9]+=/.test(v)).map(v => [v.slice(0,v.indexOf('=')), v.slice(v.indexOf('=')+1)]));
const cluster = 'edge-a', node = 'cea-edge-a-1', ns = 'cea-lab';
const base = `http://127.0.0.1:${settings.CEA_API_PORT}/api/namespaces/lab`;
const headers = {Authorization: 'Basic ' + Buffer.from(settings.BACKEND_USER+':'+settings.BACKEND_PASSWORD).toString('base64')};
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0,14);
const folder = `${root}/.local/cea/met04/${version}/cea-${stamp}`;
await mkdir(folder, {recursive:true});
const save = (name, value) => writeFile(`${folder}/${name}.json`, JSON.stringify(value,null,2));
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
const docker = args => execFileSync('docker', args, {encoding:'utf8', windowsHide:true, maxBuffer:32*1024*1024, timeout:120000});
const kubectl = args => JSON.parse(docker(['exec',node,'kubectl',...args,'-o','json']));
async function api(path, options={}) {
  const response = await fetch(base+path,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(600000)});
  if(!response.ok) throw new Error(`${options.method||'GET'} ${path}: ${response.status} ${(await response.text()).slice(0,500)}`);
  const text=await response.text();return text?JSON.parse(text):null;
}
const json = (method, body) => ({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function all(path) {
  const rows=[];for(let offset=0;;offset+=100){const page=await api(`${path}?limit=100&offset=${offset}`);rows.push(...page);if(page.length<100)return rows;}
}
async function snapshot() {
  const ids=docker(['ps','--filter','label=com.docker.compose.project=cea','--format','{{.ID}}']).trim().split(/\s+/);
  const containers=JSON.parse(docker(['inspect',...ids])).map(x=>({id:x.Id,name:x.Name,image:x.Image,startedAt:x.State.StartedAt})).sort((a,b)=>a.name.localeCompare(b.name));
  const executions=await all('/executions');
  assert.ok(executions.every(x=>['SUCCESS','FAILED','KILLED','SKIPPED'].includes(x.state)), 'Active Flow workload; stop before testing');
  return {containers,executions,flows:await all('/flows'),datasets:await all('/resources/datasets'),policies:await all('/edge/policies'),samples:await all('/offloading/samples')};
}
const before=await snapshot();await save('before',before);
const cases=[['small','signal','/analyze','application/json'],['medium','bearing','/predict','application/octet-stream'],['large','surface','/inspect','image/png']];
const plan={createdAt:new Date().toISOString(),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim(),cluster,replicas:1,readiness:{path:'/healthz',port:8080},host:'Single Docker Desktop host; not a physical WAN',order:cases.map(x=>x[0]),measuredCreatesPerService:4,conditions:['first service deployment; shared layers may already be cached','three warm-cache recreations'],thresholdMs:30000,successRule:'Each CREATE must SUCCEED with valid duration <=30000 and correct business output; all trials retained',cleanup:'Only this run-created Deployments; preserve images, histories and original objects',display:'Three extra warm deployments retained for the UI after the measured trials; not mixed into statistics'};
await save('plan',plan); // Freeze before upload/deployment, do not tune conditions from results.
const images={}, rows=[], displays=[];
for(const [size,kind] of cases) {
  const id=`met04-${size}`;
  const existing=await all('/applications');
  assert.ok(!existing.some(x=>x.applicationId===id&&x.version===version),'Application version already exists; preserve previous run and use an explicitly new version');
  const file=`${root}/.local/cea/met04/${version}/${size}.tar`;
  const form=new FormData();form.append('file',await openAsBlob(file),`${size}.tar`);form.append('contract',new Blob([JSON.stringify({parameters:{}})],{type:'application/json'}));
  const app=await api(`/applications/${id}/versions/${version}/upload`,{method:'POST',body:form});
  const manifest=JSON.parse(docker(['exec','cea-backend-1','skopeo','inspect','--raw','--tls-verify=false','--authfile','/run/secrets/registry-auth.json',`docker://${app.image}`]));
  assert.ok(manifest.layers?.length,'Expected one architecture manifest');
  images[size]={applicationId:id,kind,image:app.image,archiveBytes:(await stat(file)).size,layers:manifest.layers,layerBytes:manifest.layers.reduce((n,l)=>n+l.size,0)};
  await save('images',images);console.log(`Registered ${size}: ${images[size].layerBytes} registry layer bytes`);
}
const probeCode=`import sys,json,base64,urllib.request
p=json.load(sys.stdin)
q=urllib.request.Request('http://127.0.0.1:8080'+p['path'],base64.b64decode(p['body']),{'Content-Type':p['contentType']})
with urllib.request.urlopen(q,timeout=30) as r: print(r.read().decode())`;
async function create(size,kind,path,contentType,name,purpose,trial) {
  assert.ok(!(await api(`/clusters/${cluster}/deployments`)).some(x=>x.name===name),'Deployment name collision');
  const present=new Set(docker(['exec',node,'ctr','-n','k8s.io','content','ls','-q']).trim().split(/\s+/));
  const image=images[size];
  const row={size,kind,name,purpose,trial,startedAt:new Date().toISOString(),cachedLayerBytesBefore:image.layers.filter(x=>present.has(x.digest)).reduce((n,x)=>n+x.size,0),layerBytes:image.layerBytes};
  const target=`/clusters/${cluster}/deployments/${name}`;
  let view=await api(target,json('PUT',{applicationId:image.applicationId,version,replicas:1,parameters:{},command:[],readiness:plan.readiness}));
  const operationId=view.latestOperation.id;
  const deployment=kubectl(['get','deployment',name,'-n',ns]);row.uid=deployment.metadata.uid;
  const deadline=Date.now()+660000;
  while(['PREPARING','OBSERVING'].includes(view.latestOperation.state)&&Date.now()<deadline){await pause(500);view=await api(target);}
  assert.equal(view.latestOperation.id,operationId,'Concurrent replacement');
  row.operation=view.latestOperation;
  const selector=Object.entries(deployment.spec.selector.matchLabels).map(([k,v])=>`${k}=${v}`).join(',');
  const pods=kubectl(['get','pods','-n',ns,'-l',selector]);row.pods=pods.items.map(x=>({name:x.metadata.name,uid:x.metadata.uid,status:x.status}));
  const uids=new Set([row.uid,...row.pods.map(x=>x.uid)]);
  row.events=kubectl(['get','events','-n',ns]).items.filter(x=>uids.has(x.involvedObject.uid));
  if(row.operation.state==='SUCCEEDED') {
    try {
      const fixture=JSON.parse(await readFile(`${root}/.local/cea/met04/${version}/fixtures/${kind}.json`,'utf8'));
      const request={path,contentType,body:fixture.body};
      const output=execFileSync('docker',['exec','-i',node,'kubectl','exec','-i','-n',ns,row.pods[0].name,'--','python','-c',probeCode],{input:JSON.stringify(request),encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024,timeout:45000});
      const actual=JSON.parse(output);const expected=fixture.expected;
      if(kind==='signal')for(const [key,value] of Object.entries(expected))assert.ok(Math.abs(actual[key]-value)<1e-12,`scalar mismatch ${key}`);
      if(kind==='bearing'){assert.deepEqual(actual.counts,expected.counts);assert.deepEqual(actual.windows,expected.windows);}
      if(kind==='surface'){assert.ok(Math.abs(actual.score-expected.score)<1e-5);assert.equal(actual.defect,expected.defect);assert.equal(actual.heatmap.length,32);}
      row.businessPassed=true;row.businessResult=actual;
    }catch(error){row.businessPassed=false;row.businessError=String(error.message).slice(0,500);}
  }
  row.passed=row.operation.state==='SUCCEEDED'&&row.operation.durationMs!=null&&row.operation.durationMs<=plan.thresholdMs&&row.businessPassed===true;
  console.log(`${purpose} ${size} #${trial}: ${row.operation.state}, ${row.operation.durationMs} ms, business=${row.businessPassed}`);
  return row;
}
async function remove(row) {
  const target=`/clusters/${cluster}/deployments/${row.name}`;
  const live=kubectl(['get','deployment',row.name,'-n',ns]);assert.equal(live.metadata.uid,row.uid,'Cleanup UID mismatch');
  const view=await api(target);assert.equal(view.latestOperation.id,row.operation.id);
  await api(`${target}?resourceVersion=${encodeURIComponent(view.resourceVersion)}`,{method:'DELETE'});
  for(let n=0;n<90;n++) {
    const remaining=kubectl(['get','pods','-n',ns]);
    if(!remaining.items.some(x=>row.pods.some(p=>p.uid===x.metadata.uid)))return;
    await pause(500);
  }
  throw new Error('Test pod did not stop; preserve state and stop sampling');
}
for(const [size,kind,path,contentType] of cases) {
  for(let trial=1;trial<=4;trial++) {
    const row=await create(size,kind,path,contentType,`met04-${size}-${stamp}`,'measured',trial);
    rows.push(row);await save('trials',rows);await remove(row);
  }
}
for(const [size,kind,path,contentType] of cases) {
  displays.push(await create(size,kind,path,contentType,`met04-${size}-${stamp}`,'display',1));await save('display',displays);
}
const summary=cases.map(([size])=>{
  const samples=rows.filter(x=>x.size===size),warm=samples.slice(1),times=warm.map(x=>x.operation.durationMs);
  return {size,layerBytes:images[size].layerBytes,first:samples[0].operation.durationMs,firstCachedLayerBytes:samples[0].cachedLayerBytesBefore,warmMs:times,warmMeanMs:times.every(x=>x!=null)?times.reduce((a,b)=>a+b,0)/times.length:null,warmMaxMs:times.every(x=>x!=null)?Math.max(...times):null,passed:samples.filter(x=>x.passed).length,total:samples.length};
});
await save('summary',summary);
const after=await snapshot();await save('after',after);assert.deepEqual(after,before,'Original CEA services or business records changed');
console.log(JSON.stringify({folder,summary,originalObjectsPreserved:true,retainedDeployments:displays.map(x=>x.name)},null,2));
assert.ok(rows.every(x=>x.passed)&&displays.every(x=>x.passed),'Some deployments failed the frozen test criteria; all evidence retained');
