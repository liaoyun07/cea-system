import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {chromium} from '../../frontend/node_modules/playwright-core/index.mjs';
const folder='.local/cea/hpa';mkdirSync(folder,{recursive:true});
const env=Object.fromEntries(readFileSync('deploy/cea/.env','utf8').split(/\r?\n/).filter(l=>/^[A-Z_0-9]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const authorization='Basic '+Buffer.from(env.BACKEND_USER+':'+env.BACKEND_PASSWORD).toString('base64');
const origin=process.env.CEA_E2E_URL||'http://127.0.0.1:'+(env.CEA_HTTP_PORT||18080);
const base=origin+'/api/namespaces/lab';
const clusters=['cloud','edge-a','edge-b','edge-c'];
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true}).trim();
const kube=(cluster,...args)=>JSON.parse(docker('exec',`cea-${cluster}-1`,'kubectl',...args,'-o','json'));
const save=(name,value)=>writeFileSync(folder+'/'+name,JSON.stringify(value,null,2));
const load=name=>JSON.parse(readFileSync(folder+'/'+name));
const inventory=()=>JSON.parse(docker('inspect',...docker('ps','-q','--filter','name=cea-').split(/\s+/))).map(c=>({name:c.Name,id:c.Id,started:c.State.StartedAt}));
async function api(path,method='GET',body,status=200){const r=await fetch(base+path,{method,headers:{Authorization:authorization,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const t=await r.text();assert.equal(r.status,status,path+': '+t);return t?JSON.parse(t):null;}
const rule={apiGroups:['autoscaling'],resources:['horizontalpodautoscalers'],verbs:['get','list','create','update','delete']};
const name='verify-hpa-20261015';const path='/clusters/edge-a/kubernetes/namespaces/cea-lab/deployments/'+name;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(work,seconds){const deadline=Date.now()+seconds*1000;while(Date.now()<deadline){if(await work())return;await sleep(3000);}throw Error('Timed out');}
if(process.argv[2]==='preflight'){
  for(let offset=0;;offset+=100){const rows=await api('/executions?limit=100&offset='+offset);assert(rows.every(e=>['SUCCESS','FAILED','CANCELLED','KILLED'].includes(e.state)),'Active execution; do not restart');if(rows.length<100)break;}
  console.log('No active ordinary executions');
}else if(process.argv[2]==='inspect'){
  const apps=await api('/applications?limit=100&offset=0');console.log(JSON.stringify(apps.filter(a=>['edge-bearing','ing01-http-demo','met04-small'].includes(a.applicationId)).map(a=>({applicationId:a.applicationId,version:a.version,parameters:a.parameters}))));
}else if(process.argv[2]==='e2e'){
  const result=spawnSync(process.execPath,['node_modules/@playwright/test/cli.js','test','tests/e2e/deployment-hpa.spec.js','--reporter=list'],{cwd:'frontend',windowsHide:true,stdio:'inherit',env:{...process.env,CEA_E2E_URL:origin,CEA_E2E_USER:env.BACKEND_USER,CEA_E2E_PASSWORD:env.BACKEND_PASSWORD}});process.exit(result.status??1);
}else if(process.argv[2]==='before'){
  let executions=[];for(let offset=0;;offset+=100){const rows=await api('/executions?limit=100&offset='+offset);executions.push(...rows);if(rows.length<100)break;}
  assert(executions.every(e=>['SUCCESS','FAILED','CANCELLED','KILLED'].includes(e.state)),'Active execution');
  const data={services:inventory(),clusters:{}};
  for(const c of clusters)data.clusters[c]={role:kube(c,'get','clusterrole','cea-observe-nodes'),deployments:kube(c,'get','deployments','-A').items.map(d=>({namespace:d.metadata.namespace,name:d.metadata.name,uid:d.metadata.uid,spec:d.spec})),hpas:kube(c,'get','hpa','-A').items};
  save('before.json',data);console.log('Snapshot PASS; existing HPA:',Object.values(data.clusters).map(c=>c.hpas.length));
}else if(process.argv[2]==='permissions'){
  const before=load('before.json');
  for(const c of clusters){
    const current=kube(c,'get','clusterrole','cea-observe-nodes');assert.deepEqual(current.rules,before.clusters[c].role.rules);
    current.rules.push(rule);
    execFileSync('docker',['exec','-i',`cea-${c}-1`,'kubectl','replace','-f','-'],{input:JSON.stringify(current),encoding:'utf8',windowsHide:true});
    const actual=kube(c,'get','clusterrole','cea-observe-nodes');assert.deepEqual(actual.rules,[...before.clusters[c].role.rules,rule]);
    for(const verb of rule.verbs)assert.equal(docker('exec',`cea-${c}-1`,'kubectl','auth','can-i',verb,'horizontalpodautoscalers.autoscaling','--as=system:serviceaccount:cea-lab:cea-backend','-n','cea-lab'),'yes');
  }console.log('Four clusters: HPA-only RBAC addition PASS');
}else if(process.argv[2]==='start'){
  assert(!kube('edge-a','get','deployments','-n','cea-lab').items.some(d=>d.metadata.name===name),'Do not overwrite an existing probe');
  const app=(await api('/applications?limit=100&offset=0')).find(a=>a.applicationId==='edge-bearing');assert(app);
  const cutoff=Math.floor(Date.now()/1000)+150;
  const request={applicationId:app.applicationId,version:app.version,replicas:1,parameters:{},command:['sh','-c',`while [ "$(date +%s)" -lt ${cutoff} ]; do :; done; exec sleep 1200`],resources:{cpuRequest:'100m',memoryRequest:'16Mi',cpuLimit:'100m',memoryLimit:'64Mi'}};
  save('probe.json',{name,path,request,cutoff});await api(path,'PUT',request);
  await until(async()=> (await api(path)).readyReplicas===1,120);
  const h=await api(path+'/autoscaling','PUT',{minReplicas:1,maxReplicas:2,cpuUtilization:25,memoryUtilization:null});assert(h.enabled);assert(h.editable);
  const current=await api(path);await api(path+'/scale','PATCH',{replicas:0,resourceVersion:current.resourceVersion},409);
  console.log('Probe started; native HPA target 25%, replicas 1..2; no old workload changed');
}else if(process.argv[2]==='edit'){
  const probe=load('probe.json');const current=await api(path);assert.equal(current.replicas,2);
  const updated=await api(path,'PUT',{...probe.request,command:['sh','-c','exec sleep 1200'],replicas:0,resourceVersion:current.resourceVersion});
  assert.equal(updated.replicas,2);save('edit.json',{requestedReplicas:0,actualBefore:current.replicas,actualAfter:updated.replicas});
  console.log('Deployment configuration changed; HPA-owned replicas preserved at 2 despite request replicas=0');
}else if(process.argv[2]==='ownership'){
  const before=await api(path+'/autoscaling');assert(before.enabled && before.editable);
  const originalSpec=kube('edge-a','get','hpa',name,'-n','cea-lab').spec;
  docker('exec','cea-edge-a-1','kubectl','-n','cea-lab','label','hpa',name,'cea-system/owner=external-probe','--overwrite');
  try{
    const external=await api(path+'/autoscaling');assert(external.enabled && !external.editable);
    await api(path+'/autoscaling','PUT',{minReplicas:1,maxReplicas:2,cpuUtilization:30,resourceVersion:external.resourceVersion},409);
    await api(path+'/autoscaling?resourceVersion='+external.resourceVersion,'DELETE',null,409);
  }finally{docker('exec','cea-edge-a-1','kubectl','-n','cea-lab','label','hpa',name,'cea-system/owner=cea-system','--overwrite');}
  const current=await api(path+'/autoscaling');await api(path+'/autoscaling','PUT',{minReplicas:2,maxReplicas:1,cpuUtilization:30,resourceVersion:current.resourceVersion},422);
  assert.deepEqual(kube('edge-a','get','hpa',name,'-n','cea-lab').spec,originalSpec);
  console.log('External HPA is read-only; update/delete denied; invalid bounds rejected');
}else if(process.argv[2]==='observe'){
  const d=await api(path);const h=await api(path+'/autoscaling');const point={at:new Date().toISOString(),replicas:d.replicas,ready:d.readyReplicas,hpa:h};
  let points=[];try{points=load('observations.json');}catch{}points.push(point);save('observations.json',points);console.log(JSON.stringify(point));
}else if(process.argv[2]==='ui'){
  const browser=await chromium.launch({headless:true});try{
    const page=await browser.newPage({viewport:{width:1500,height:1050}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin);await page.getByLabel('账号',{exact:true}).fill(env.BACKEND_USER);await page.getByLabel('密码',{exact:true}).fill(env.BACKEND_PASSWORD);await page.getByRole('button',{name:'连接工作空间 →',exact:true}).click();
    await page.getByRole('navigation').getByRole('button',{name:'边缘服务部署',exact:true}).click();await page.getByLabel('执行集群',{exact:true}).selectOption('edge-a');
    await page.getByRole('row').filter({has:page.getByRole('cell',{name,exact:true})}).getByRole('button',{name:'详情 →',exact:true}).click();
    const section=page.getByRole('region',{name:'自动扩缩容',exact:true});await section.getByText('已启用',{exact:true}).waitFor();assert.equal(await page.getByLabel('调整副本数',{exact:true}).count(),0);
    await page.getByRole('button',{name:'编辑配置',exact:true}).click();assert(await page.getByLabel('副本数',{exact:true}).isDisabled());
    await page.getByRole('button',{name:'← 返回列表',exact:true}).click();await page.getByRole('row').filter({has:page.getByRole('cell',{name,exact:true})}).getByRole('button',{name:'详情 →',exact:true}).click();
    await section.getByRole('button',{name:'编辑自动扩缩容',exact:true}).click();await page.getByLabel('CPU 目标利用率（%）',{exact:true}).fill('30');await page.getByRole('button',{name:'保存自动扩缩容',exact:true}).click();await page.getByRole('status').filter({hasText:'自动扩缩容配置已保存'}).waitFor();
    assert.equal((await api(path+'/autoscaling')).metrics[0].targetUtilization,30);
    await section.scrollIntoViewIfNeeded();await page.screenshot({path:folder+'/hpa-desktop.png',fullPage:true});await page.setViewportSize({width:420,height:900});await page.screenshot({path:folder+'/hpa-mobile.png',fullPage:true});assert.deepEqual(errors,[]);
    console.log('Live browser editing, replica ownership and responsive screenshots PASS');
  }finally{await browser.close();}
}else if(process.argv[2]==='finish'){
  const observations=load('observations.json');assert(observations.some(p=>p.ready===2),'No observed scale-up');assert(observations.at(-1).ready===1 && observations.at(-1).replicas===1,'No final scale-down');
  const probe=load('probe.json');const current=await api(path);const edited=await api(path,'PUT',{...probe.request,command:['sh','-c','exec sleep 600'],replicas:0,resourceVersion:current.resourceVersion});assert.equal(edited.replicas,current.replicas);
  const h=await api(path+'/autoscaling');await api(path+'/autoscaling?resourceVersion='+h.resourceVersion,'DELETE',null,204);assert(!(await api(path+'/autoscaling')).enabled);assert.equal((await api(path)).replicas,current.replicas);
  const d=await api(path);await api(path+'?resourceVersion='+d.resourceVersion,'DELETE',null,202);
  await until(async()=>!kube('edge-a','get','deployments','-n','cea-lab').items.some(d=>d.metadata.name===name)
    && kube('edge-a','get','pods','-n','cea-lab','-l','cea-system/deployment='+name).items.length===0,90);
  const before=load('before.json');for(const c of clusters){const actual=kube(c,'get','deployments','-A').items;for(const old of before.clusters[c].deployments){const found=actual.find(x=>x.metadata.namespace===old.namespace&&x.metadata.name===old.name);assert(found);assert.equal(found.metadata.uid,old.uid);assert.deepEqual(found.spec,old.spec);}assert.deepEqual(kube(c,'get','hpa','-A').items,before.clusters[c].hpas);}
  const after=inventory();const others=before.services.filter(s=>!['/cea-backend-1','/cea-frontend-1'].includes(s.name));for(const c of others)assert.deepEqual(after.find(x=>x.name===c.name),c);
  save('result.json',{status:'PASS',nativeScaleUp:true,nativeScaleDown:true,oldDeploymentsUnchanged:true,unchangedServices:others.length});console.log('Native HPA scale-up/down, edits, cleanup, old workload and service preservation PASS');
}else throw Error('before | permissions | preflight | inspect | e2e | start | observe | ownership | edit | ui | finish');
