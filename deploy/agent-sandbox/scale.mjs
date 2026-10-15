// Isolated cloud benchmark. Run from backend/: node deploy/agent-sandbox/scale.mjs run|finish
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const folder='.local/cea/agent-sandbox-scale-20261016';
const namespace='cea-warm-scale-20261016';
const mode=process.argv[2];assert(['run','resume-preflight','resume-preparation','finish'].includes(mode));
const image='grafana/grafana@sha256:dbbc38ea21103cefb50396340cd88afec779c7e070b0a7bf5a75b4ce46651d3f';
const python='python@sha256:9d2e5553305c7c7b0097999bb17187c69b921ccd6bc9d40e4bb5ebe652c00285';
const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:32*1024*1024}).trim();
const k=(args,input,cluster='cloud')=>docker(['exec','-i',`cea-${cluster}-1`,'kubectl',...args],input);
const get=(resource,cluster='cloud',extra=[])=>JSON.parse(k(['get',resource,...extra,'-o','json'],undefined,cluster));
const save=(name,value)=>writeFileSync(`${folder}/${name}.json`,JSON.stringify(value,null,2));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const metadata=name=>({name,namespace});
const ext='extensions.agents.x-k8s.io/v1beta1';
function snapshot(){
 const ids=docker(['ps','-q','--filter','name=cea-']).split(/\s+/);
 return {at:new Date().toISOString(),containers:JSON.parse(docker(['inspect',...ids])).map(c=>({id:c.Id,name:c.Name,started:c.State.StartedAt,running:c.State.Running})),
  clusters:Object.fromEntries(['cloud','edge-a','edge-b','edge-c'].map(c=>[c,{
   deployments:get('deployments',c,['-A']).items.map(d=>({uid:d.metadata.uid,name:d.metadata.name,namespace:d.metadata.namespace,spec:d.spec})),
   hpas:get('hpa',c,['-A']).items.map(h=>({uid:h.metadata.uid,spec:h.spec})),
   namespaces:get('namespace',c).items.map(n=>n.metadata.name),
   activeJobs:get('pods',c,['-A','--field-selector=status.phase!=Succeeded,status.phase!=Failed']).items.filter(p=>p.metadata.ownerReferences?.some(o=>o.kind==='Job')).map(p=>p.metadata.name)
  }]))};
}
async function waitFor(label,fn,timeout=180000){const start=Date.now();while(Date.now()-start<timeout){if(fn())return;await pause(1000);}throw Error(label);}

if(mode==='run'){
 assert(!existsSync(folder),'Evidence exists: inspect original run; never repeat or overwrite');
 assert.equal(k(['get','namespace',namespace,'--ignore-not-found','-o','name']),'');
 mkdirSync(folder,{recursive:true});const before=snapshot();save('before',before);
 for(const [name,c] of Object.entries(before.clusters))assert.equal(c.activeJobs.length,0,`Active Job Pods in ${name}`);
 const controller=get('deployment','cloud',['agent-sandbox-controller','-n','agent-sandbox-system']);assert.equal(controller.status.availableReplicas,1);
 const podTemplate={metadata:{labels:{app:'warm-grafana'}},spec:{
  automountServiceAccountToken:false,securityContext:{runAsNonRoot:true,runAsUser:472,runAsGroup:472,fsGroup:472},
  containers:[{name:'grafana',image,imagePullPolicy:'IfNotPresent',ports:[{name:'http',containerPort:3000}],
   env:[{name:'POD_NAME',valueFrom:{fieldRef:{fieldPath:'metadata.name'}}}],
   resources:{requests:{cpu:'100m',memory:'128Mi'},limits:{cpu:'1',memory:'1Gi'}},
   readinessProbe:{httpGet:{path:'/api/health',port:3000},periodSeconds:1,timeoutSeconds:1,failureThreshold:3,successThreshold:1},
   securityContext:{allowPrivilegeEscalation:false,capabilities:{drop:['ALL']}},
   volumeMounts:[{name:'config',mountPath:'/etc/grafana/grafana.ini',subPath:'grafana.ini',readOnly:true},{name:'data',mountPath:'/var/lib/grafana'}]}],
  volumes:[{name:'config',configMap:{name:'grafana-config'}},{name:'data',emptyDir:{}}]
 }};
 const plan={createdAt:new Date().toISOString(),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),cluster:'cloud',namespace,grafanaVersion:'13.2.4',image,python,podTemplate,
  groups:{DEPLOYMENT:'one serving instance; replicas 1 -> 3',WARM:'one serving instance; two ready reserve sandboxes; claim both'},
  trials:10,ordering:'10 paired blocks, odd DEPLOYMENT/WARM, even WARM/DEPLOYMENT',settleSeconds:10,
  timer:'in-cluster time.monotonic: before first API mutation until all new Pod UIDs Ready, in Service endpoints, direct HTTP valid and each observed serving HTTP through ClusterIP; 100ms polling',
  notes:['Image preparation excluded for both groups','No HPA trigger delay, artificial startup sleep, platform/UI changes or existing application changes','Supplemental EMPTY 1->3 and OVERFLOW 1->5 with only two warm instances','Grafana local empty SQLite and no business writes: service startup capacity test, not shared-state HA validation','Initial/pool preparation, pool refill and reserve metrics separately recorded; all failures retained']};
 save('plan',plan);
 const objects=[
  {apiVersion:'v1',kind:'Namespace',metadata:{name:namespace}},
  {apiVersion:'v1',kind:'ServiceAccount',metadata:metadata('benchmark')},
  {apiVersion:'rbac.authorization.k8s.io/v1',kind:'Role',metadata:metadata('benchmark'),rules:[
   {apiGroups:[''],resources:['pods','endpoints','events'],verbs:['get','list']},
   {apiGroups:['apps'],resources:['deployments'],verbs:['get','list','create','patch','delete']},
   {apiGroups:['extensions.agents.x-k8s.io'],resources:['sandboxclaims'],verbs:['get','list','create','delete']},
   {apiGroups:['extensions.agents.x-k8s.io'],resources:['sandboxwarmpools'],verbs:['get','patch']},
   {apiGroups:['metrics.k8s.io'],resources:['pods'],verbs:['get','list']}
  ]},
  {apiVersion:'rbac.authorization.k8s.io/v1',kind:'RoleBinding',metadata:metadata('benchmark'),roleRef:{apiGroup:'rbac.authorization.k8s.io',kind:'Role',name:'benchmark'},subjects:[{kind:'ServiceAccount',name:'benchmark',namespace}]},
  {apiVersion:'v1',kind:'ConfigMap',metadata:metadata('grafana-config'),data:{'grafana.ini':'[server.custom_response_headers]\nX-Benchmark-Pod = $__env{POD_NAME}\n[analytics]\nreporting_enabled = false\ncheck_for_updates = false\ncheck_for_plugin_updates = false\n'}},
  {apiVersion:'v1',kind:'ConfigMap',metadata:metadata('benchmark-code'),data:{'scale_benchmark.py':readFileSync('deploy/agent-sandbox/scale_benchmark.py','utf8'),'plan.json':JSON.stringify(plan)}},
  {apiVersion:'v1',kind:'Service',metadata:metadata('grafana'),spec:{selector:{app:'warm-grafana','sandbox.users.io/online':'true'},ports:[{name:'http',port:3000,targetPort:3000}]}},
  {apiVersion:ext,kind:'SandboxTemplate',metadata:metadata('grafana-template'),spec:{podTemplate,service:false,networkPolicyManagement:'Unmanaged'}},
  {apiVersion:ext,kind:'SandboxWarmPool',metadata:metadata('grafana-pool'),spec:{replicas:0,sandboxTemplateRef:{name:'grafana-template'},updateStrategy:{type:'Recreate'}}},
  {apiVersion:'v1',kind:'Pod',metadata:metadata('benchmark'),spec:{serviceAccountName:'benchmark',restartPolicy:'Never',
   containers:[{name:'benchmark',image:python,imagePullPolicy:'IfNotPresent',command:['python','-u','/benchmark/scale_benchmark.py'],
    env:[{name:'POD_NAMESPACE',value:namespace},{name:'PYTHONDONTWRITEBYTECODE',value:'1'}],
    resources:{requests:{cpu:'50m',memory:'64Mi'},limits:{cpu:'250m',memory:'128Mi'}},
    securityContext:{runAsNonRoot:true,runAsUser:1000,allowPrivilegeEscalation:false,capabilities:{drop:['ALL']}},volumeMounts:[{name:'code',mountPath:'/benchmark',readOnly:true}]}],volumes:[{name:'code',configMap:{name:'benchmark-code'}}]}}
 ];
 save('manifest',{apiVersion:'v1',kind:'List',items:objects});
 console.log(k(['create','-f','-'],JSON.stringify({apiVersion:'v1',kind:'List',items:objects})));
}

if(mode==='resume-preflight'){
 const pod=get('pod','cloud',['benchmark','-n',namespace]);assert.equal(pod.status.phase,'Failed');
 const previousLog=k(['logs','benchmark','-n',namespace]);
 assert(!previousLog.includes('"event": "trial-start"'),'Never resubmit a measured trial');
 assert.equal(get('pods','cloud',['-n',namespace,'-l','app=warm-grafana']).items.length,0);
 assert(!existsSync(`${folder}/preflight-failed.log`),'Preflight was already resumed');
 writeFileSync(`${folder}/preflight-failed.log`,previousLog);save('preflight-failed-pod',pod);
 const manifest=JSON.parse(readFileSync(`${folder}/manifest.json`));
 const config=manifest.items.find(o=>o.kind==='ConfigMap'&&o.metadata.name==='benchmark-code');
 config.data['scale_benchmark.py']=readFileSync('deploy/agent-sandbox/scale_benchmark.py','utf8');save('manifest-resumed',manifest);
 console.log(k(['patch','configmap','benchmark-code','-n',namespace,'--type=merge','--patch-file','/dev/stdin'],JSON.stringify({data:config.data})));
 console.log(k(['delete','pod','benchmark','-n',namespace,'--wait=false']));
 await waitFor('Failed preflight Pod removed',()=>k(['get','pod','benchmark','-n',namespace,'--ignore-not-found','-o','name'])==='');
 console.log(k(['create','-f','-'],JSON.stringify(manifest.items.find(o=>o.kind==='Pod'))));
}

if(mode==='resume-preparation'){
 const pod=get('pod','cloud',['benchmark','-n',namespace]);assert.equal(pod.status.phase,'Failed');
 const log=k(['logs','benchmark','-n',namespace]);
 const results=log.split('\n').filter(l=>l.startsWith('{')).map(l=>JSON.parse(l)).filter(e=>e.event==='trial-result').map(e=>e.row);
 const failed=results.at(-1);assert.equal(failed.status,'FAILED');assert(!failed.requestAt,'Never repeat a timed trial');
 const rows=results.slice(0,-1);assert(rows.every(r=>r.status==='PASS'));assert.equal(rows.length,2);
 if(existsSync(`${folder}/preparation-failed.log`)){
  assert.equal(JSON.parse(readFileSync(`${folder}/preparation-failed-pod.json`)).metadata.uid,pod.metadata.uid);
  assert.equal(readFileSync(`${folder}/preparation-failed.log`,'utf8'),log);
 }else{writeFileSync(`${folder}/preparation-failed.log`,log);save('preparation-failed-row',failed);save('preparation-failed-pod',pod);}
 const checkpoint={rows,failedPreparation:failed};save('checkpoint',checkpoint);
 const manifest=JSON.parse(readFileSync(`${folder}/manifest-resumed.json`));
 const config=manifest.items.find(o=>o.kind==='ConfigMap'&&o.metadata.name==='benchmark-code');
 config.data['scale_benchmark.py']=readFileSync('deploy/agent-sandbox/scale_benchmark.py','utf8');config.data['checkpoint.json']=JSON.stringify(checkpoint);save('manifest-continued',manifest);
 console.log(k(['patch','configmap','benchmark-code','-n',namespace,'--type=merge','--patch-file','/dev/stdin'],JSON.stringify({data:config.data})));
 console.log(k(['delete','pod','benchmark','-n',namespace,'--wait=false']));
 await waitFor('Failed preparation runner removed',()=>k(['get','pod','benchmark','-n',namespace,'--ignore-not-found','-o','name'])==='');
 console.log(k(['create','-f','-'],JSON.stringify(manifest.items.find(o=>o.kind==='Pod'))));
}

if(['run','resume-preflight','resume-preparation'].includes(mode)){
 let seen=0,last=0;
 const deadline=Date.now()+2400000;
 while(Date.now()<deadline){
  const pod=get('pod','cloud',['benchmark','-n',namespace]);
  if(pod.status.containerStatuses?.[0]?.state.running||pod.status.containerStatuses?.[0]?.state.terminated){
   const log=k(['logs','benchmark','-n',namespace]);writeFileSync(`${folder}/runner.log`,log);
   const events=log.split('\n').filter(l=>l.startsWith('{')).map(l=>JSON.parse(l));
   for(const e of events.slice(seen)){
    if(e.event==='trial-result'){save(e.row.trial,e.row);console.log(e.row.trial,e.row.status,'duration',e.row.durationSeconds,'refill',e.row.poolRestoredFromRequestSeconds);}
    else if(e.event==='complete'){save('results',e);console.log('All trials completed',JSON.stringify(e.summary));}
    else if(e.event==='failure')console.log(e);
    else console.log(e.event,e.trial??'',e.seconds??'');
   }seen=events.length;
  }
  if(['Succeeded','Failed'].includes(pod.status.phase)){save('runner-pod',pod);break;}
  if(Date.now()-last>25000){console.log('Benchmark Pod',pod.status.phase);last=Date.now();}
  await pause(2000);
 }
 assert.equal(get('pod','cloud',['benchmark','-n',namespace]).status.phase,'Succeeded','Benchmark failed or timed out; evidence retained, inspect before cleanup');
}

if(existsSync(`${folder}/results.json`)){
 const before=JSON.parse(readFileSync(`${folder}/before.json`));
 if(k(['get','namespace',namespace,'--ignore-not-found','-o','name'])){
  save('final-pods',get('pods','cloud',['-n',namespace]));save('events',get('events','cloud',['-n',namespace]));
  assert.equal(get('pods','cloud',['-n',namespace,'-l','app=warm-grafana']).items.length,0);
  console.log(k(['delete','namespace',namespace,'--wait=false']));
  await waitFor('Test namespace removed',()=>k(['get','namespace',namespace,'--ignore-not-found','-o','name'])==='');
 }
 const after=snapshot();save('after',after);
 assert.deepEqual(after.containers,before.containers,'Old Docker services changed');
 assert.deepEqual(after.clusters,before.clusters,'Old cluster deployments/HPAs/namespaces/active jobs changed');
 const controllerMetrics=k(['top','pods','-n','agent-sandbox-system']);
 save('audit',{status:'PASS',at:new Date().toISOString(),oldContainers:before.containers.length,oldDeployments:Object.values(before.clusters).reduce((n,c)=>n+c.deployments.length,0),testNamespaceDeleted:true,controllerMetrics});
 console.log('Cleanup and environment audit PASS',controllerMetrics);
}
