// Measure stock public services through the existing CEA application/deployment API.
// Run from backend/: node examples/deployment-benchmark/public-services.mjs <new-run-id>
import {readFileSync,writeFileSync,mkdirSync,existsSync,openAsBlob} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const run=process.argv[2];assert.match(run||'',/^[a-z][a-z0-9-]{0,25}$/);
const folder=`.local/cea/public-services/${run}`;assert(!existsSync(folder),'Use a new explicitly chosen run ID; never overwrite results');mkdirSync(folder,{recursive:true});
const settings=Object.fromEntries(readFileSync('deploy/cea/.env','utf8').split(/\r?\n/).filter(l=>/^[A-Z_0-9]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const base=`http://127.0.0.1:${settings.CEA_API_PORT||18085}/api/namespaces/lab`;
const authorization='Basic '+Buffer.from(settings.BACKEND_USER+':'+settings.BACKEND_PASSWORD).toString('base64');
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024,timeout:180000}).trim();
const kube=(cluster,...args)=>JSON.parse(docker('exec',`cea-${cluster}-1`,'kubectl',...args,'-o','json'));
const save=(name,value)=>writeFileSync(`${folder}/${name}.json`,JSON.stringify(value,null,2));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function api(path,method='GET',body){
 const r=await fetch(base+path,{method,headers:{Authorization:authorization,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body?(body instanceof FormData?body:JSON.stringify(body)):undefined,signal:AbortSignal.timeout(360000)});
 const text=await r.text();if(!r.ok)throw Error(`${method} ${path}: ${r.status} ${text.slice(0,500)}`);return text?JSON.parse(text):null;
}
const services=[
 {size:'small',id:'nginx',image:'nginxinc/nginx-unprivileged:1.28-alpine',readiness:{path:'/',port:8080},check:'Welcome to nginx!'},
 {size:'medium',id:'prometheus',image:'prom/prometheus:v3.5.0',readiness:{path:'/-/ready',port:9090},check:'Prometheus Server is Ready.'},
 {size:'large',id:'jenkins',image:'jenkins/jenkins:lts-jdk21',readiness:{path:'/login',port:8080},check:'Jenkins'}
];
const resources={cpuRequest:'100m',cpuLimit:'1',memoryRequest:'128Mi',memoryLimit:'1Gi'};
const clusters=['cloud','edge-a','edge-b','edge-c'];
function snapshot(){
 const ids=docker('ps','-q','--filter','name=cea-').split(/\s+/);
 return {services:JSON.parse(docker('inspect',...ids)).map(c=>({name:c.Name,id:c.Id,started:c.State.StartedAt})),deployments:Object.fromEntries(clusters.map(c=>[c,kube(c,'get','deployments','-A').items.map(d=>({namespace:d.metadata.namespace,name:d.metadata.name,uid:d.metadata.uid,spec:d.spec}))]))};
}
const before=snapshot();save('before',before);
const plan={run,createdAt:new Date().toISOString(),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),cluster:'edge-a',namespace:'cea-lab',replicas:1,resources,services:services.map(s=>{const i=JSON.parse(docker('image','inspect',s.image))[0];return {...s,repoDigests:i.RepoDigests,imageId:i.Id,dockerSize:i.Size,user:i.Config.User,entrypoint:i.Config.Entrypoint,cmd:i.Config.Cmd};}),trials:['first','warm-1','warm-2'],rules:['No artificial delay or cache deletion','Default upstream command and configuration; no PVC, plugins or external integrations','All results retained, including failures or >30s','Retain final deployment of each service; no public ports','Only platform timing determines reported duration; Docker Hub downloads/import precede it']};save('plan',plan);
for(let offset=0;;offset+=100){const executions=await api('/executions?limit=100&offset='+offset);assert(executions.every(e=>['SUCCESS','FAILED','KILLED','CANCELLED','SKIPPED'].includes(e.state)),'Active Flow; stop before measurements');if(executions.length<100)break;}
const rows=[],images={};save('results',rows);
for(const service of services){
 const applicationId=`public-${service.id}`,name=`public-${service.id}-${run}`,path=`/clusters/edge-a/kubernetes/namespaces/cea-lab/deployments/${name}`;
 assert(!(await api('/clusters/edge-a/kubernetes/namespaces/cea-lab/deployments')).some(d=>d.name===name),'Name collision');
 const archive=`${folder}/${service.id}.tar`;docker('image','save','--platform','linux/amd64','-o',archive,service.image);
 const form=new FormData();form.append('file',await openAsBlob(archive),service.id+'.tar');form.append('contract',new Blob([JSON.stringify({parameters:{}})],{type:'application/json'}));
 const app=await api(`/applications/${applicationId}/versions/${run}/upload`,'POST',form);
 const manifest=JSON.parse(docker('exec','cea-backend-1','skopeo','inspect','--raw','--tls-verify=false','--authfile','/run/secrets/registry-auth.json','docker://'+app.image));
 images[service.id]={application:app,manifest};save('images',images);console.log('Imported',service.id,'layer bytes',manifest.layers.reduce((n,l)=>n+l.size,0));
 for(const trial of plan.trials){
  const content=new Set(docker('exec','cea-edge-a-1','ctr','-n','k8s.io','content','ls','-q').split(/\s+/));
  const row={service:service.id,size:service.size,name,trial,layerBytes:manifest.layers.reduce((n,l)=>n+l.size,0),cachedLayerBytes:manifest.layers.filter(l=>content.has(l.digest)).reduce((n,l)=>n+l.size,0)};
  rows.push(row);save('results',rows);console.log('Starting',service.id,trial,'cachedLayerBytes',row.cachedLayerBytes);
  let view=await api(path,'PUT',{applicationId,version:run,replicas:1,parameters:{},command:[],readiness:service.readiness,resources});
  const operationId=view.latestOperation.id;row.operation=view.latestOperation;save('results',rows);
  const end=Date.now()+660000;let lastLog=Date.now();
  while(['PREPARING','OBSERVING'].includes(view.latestOperation.state)&&Date.now()<end){await sleep(1000);view=await api(path);if(Date.now()-lastLog>15000){console.log(service.id,trial,view.latestOperation.state,'ready',view.readyReplicas);lastLog=Date.now();}}
  assert.equal(view.latestOperation.id,operationId);row.operation=view.latestOperation;
  row.deployment=kube('edge-a','get','deployment',name,'-n','cea-lab');
  row.pods=kube('edge-a','get','pods','-n','cea-lab','-l','cea-system/deployment='+name).items;
  row.events=kube('edge-a','get','events','-n','cea-lab').items.filter(e=>row.pods.some(p=>p.metadata.uid===e.involvedObject.uid));save('results',rows);
  assert.equal(row.operation.state,'SUCCEEDED','Preserve failed record; do not rerun');assert(row.operation.durationMs!=null,'No valid platform timing');
  const pod=row.pods.find(p=>p.status.conditions.some(c=>c.type==='Ready'&&c.status==='True'));assert(pod);
  const url=`http://${pod.status.podIP}:${service.readiness.port}${service.readiness.path}`;
  const html=docker('exec','cea-edge-a-1','wget','-qO-',url);assert(html.includes(service.check),'Real service response mismatch');row.businessPassed=true;
  if(service.id==='prometheus'){const q=JSON.parse(docker('exec','cea-edge-a-1','wget','-qO-',`http://${pod.status.podIP}:9090/api/v1/query?query=1%2B1`));assert.equal(q.data.result[1],'2');row.queryPassed=true;}
  save('results',rows);console.log(service.id,trial,'SUCCEEDED',row.operation.durationMs,'ms; service response verified');
  if(trial!==plan.trials.at(-1)){
   view=await api(path);await api(path+'?resourceVersion='+view.resourceVersion,'DELETE');
   const cleanupEnd=Date.now()+90000;while(Date.now()<cleanupEnd){if(kube('edge-a','get','pods','-n','cea-lab','-l','cea-system/deployment='+name).items.length===0)break;await sleep(1000);}
   assert.equal(kube('edge-a','get','pods','-n','cea-lab','-l','cea-system/deployment='+name).items.length,0);
  }
 }
}
const after=snapshot();save('after',after);assert.deepEqual(after.services,before.services);
for(const cluster of clusters)for(const old of before.deployments[cluster])assert.deepEqual(after.deployments[cluster].find(d=>d.uid===old.uid),old);
const summary={status:'PASS',sourceCommit:plan.sourceCommit,unchangedServices:before.services.length,results:rows.map(r=>({service:r.service,trial:r.trial,durationMs:r.operation.durationMs,layerBytes:r.layerBytes,cachedLayerBytes:r.cachedLayerBytes,pullEvents:r.events.filter(e=>e.reason==='Pulled').map(e=>e.message),businessPassed:r.businessPassed})),retainedDeployments:services.map(s=>`public-${s.id}-${run}`)};save('summary',summary);console.log(JSON.stringify(summary));
