// Cloud-only smoke test. Run from backend/: node deploy/agent-sandbox/verify.mjs run|cleanup|audit
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';

const folder='.local/cea/agent-sandbox-cloud-20261016';
const namespace='cea-warm-verify';
const image='nginxinc/nginx-unprivileged@sha256:7377697a821c131a924a7105fafbe7414db4e9fcc77a6f08f776f33f141ec3f8';
const apiVersion='extensions.agents.x-k8s.io/v1beta1';
const mode=process.argv[2];
assert(['run','cleanup','audit'].includes(mode));
const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:32*1024*1024}).trim();
const k=(args,input,cluster='cloud')=>docker(['exec','-i',`cea-${cluster}-1`,'kubectl',...args],input);
const get=(resource,name)=>JSON.parse(k(['get',resource,...(name?[name]:[]),'-n',namespace,'-o','json']));
const save=(name,value)=>writeFileSync(`${folder}/${name}.json`,JSON.stringify(value,null,2));
const create=items=>k(['create','-f','-'],JSON.stringify({apiVersion:'v1',kind:'List',items}));
const metadata=name=>({name,namespace});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(label,check,timeout=180000){
 const start=performance.now();
 while(performance.now()-start<timeout){const result=check();if(result){console.log(label);return result;}await pause(1000);}
 throw Error(`Timed out: ${label}`);
}
const ready=o=>o.status?.conditions?.some(c=>c.type==='Ready'&&c.status==='True');
const appPods=()=>get('pods').items.filter(p=>p.metadata.labels?.app==='cea-warm-http');
const endpoints=()=>get('endpoints','claimed-http').subsets?.flatMap(s=>s.addresses??[]).map(a=>a.ip)??[];
const probe=address=>k(['exec','-n',namespace,'probe','--','wget','-T','3','-qO-',`http://${address}:8080/`]);
const pool=(name,replicas)=>({apiVersion,kind:'SandboxWarmPool',metadata:metadata(name),spec:{replicas,sandboxTemplateRef:{name:'nginx-http'},updateStrategy:{type:'Recreate'}}});
const claim=(name,poolName)=>({apiVersion,kind:'SandboxClaim',metadata:metadata(name),spec:{warmPoolRef:{name:poolName},additionalPodMetadata:{labels:{'sandbox.users.io/online':'true'}},lifecycle:{shutdownPolicy:'Delete'}}});

if(mode==='run'){
 assert(existsSync(`${folder}/installed.json`),'Install the controller first');
 assert(!existsSync(`${folder}/test-started.json`),'Test evidence exists; inspect it instead of silently repeating');
 assert.equal(k(['get','namespace',namespace,'--ignore-not-found','-o','name']),'','Test namespace must be new');
 save('test-started',{at:new Date().toISOString(),namespace,image});
 const controller=JSON.parse(k(['get','pods','-n','agent-sandbox-system','-o','json'])).items[0];
 assert(ready(controller));
 const health=docker(['exec','cea-cloud-1','wget','-qO-',`http://${controller.status.podIP}:8081/healthz`]);
 assert.equal(health,'ok');save('controller-health',{pod:controller,health});
 const objects=[
  {apiVersion:'v1',kind:'Namespace',metadata:{name:namespace}},
  {apiVersion:'v1',kind:'ConfigMap',metadata:metadata('http-config'),data:{'default.conf':'server { listen 8080; location / { default_type text/plain; return 200 "$hostname\n"; } }\n'}},
  {apiVersion,kind:'SandboxTemplate',metadata:metadata('nginx-http'),spec:{
   networkPolicyManagement:'Managed',networkPolicy:{ingress:[{from:[{podSelector:{matchLabels:{app:'warm-probe'}}}],ports:[{protocol:'TCP',port:8080}]}],egress:[]},
   service:true,podTemplate:{metadata:{labels:{app:'cea-warm-http'}},spec:{
    automountServiceAccountToken:false,securityContext:{runAsUser:101,runAsGroup:101,runAsNonRoot:true},
    containers:[{name:'nginx',image,imagePullPolicy:'IfNotPresent',ports:[{name:'http',containerPort:8080}],
     resources:{requests:{cpu:'50m',memory:'32Mi'},limits:{cpu:'500m',memory:'128Mi'}},
     securityContext:{allowPrivilegeEscalation:false,capabilities:{drop:['ALL']}},
     readinessProbe:{httpGet:{path:'/',port:8080},initialDelaySeconds:0,periodSeconds:1},
     volumeMounts:[{name:'config',mountPath:'/etc/nginx/conf.d/default.conf',subPath:'default.conf',readOnly:true}]}],
    volumes:[{name:'config',configMap:{name:'http-config'}}]
   }}
  }},
  {apiVersion:'v1',kind:'Service',metadata:metadata('claimed-http'),spec:{selector:{app:'cea-warm-http','sandbox.users.io/online':'true'},ports:[{port:8080,targetPort:8080}]}},
  {apiVersion:'v1',kind:'Pod',metadata:{...metadata('probe'),labels:{app:'warm-probe'}},spec:{automountServiceAccountToken:false,containers:[{name:'probe',image,command:['sleep','3600'],resources:{requests:{cpu:'10m',memory:'8Mi'},limits:{cpu:'100m',memory:'32Mi'}},securityContext:{runAsNonRoot:true,runAsUser:101,allowPrivilegeEscalation:false,capabilities:{drop:['ALL']}}}]}},
  pool('warm-http',2),pool('cold-http',0)
 ];
 save('test-manifest',{apiVersion:'v1',kind:'List',items:objects});console.log(create(objects));
 await until('Two warm instances and probe ready',()=>get('sandboxwarmpools','warm-http').status?.readyReplicas===2&&ready(get('pods','probe')));
 const initial=appPods();assert.equal(initial.length,2);assert(initial.every(ready));
 assert.deepEqual(endpoints(),[],'Unclaimed warm instances must not serve production traffic');
 save('warm-before',{pool:get('sandboxwarmpools','warm-http'),pods:initial,endpoints:endpoints()});
 const submitted=performance.now();
 console.log(create([claim('application-one','warm-http'),claim('application-two','warm-http')]));
 const claims=await until('Both claims ready',()=>{const cs=get('sandboxclaims').items;return cs.length===2&&cs.every(ready)?cs:null;});
 const allocated=claims.map(c=>get('pods',c.status.sandbox.name));
 for(const pod of allocated){
  const previous=initial.find(p=>p.metadata.uid===pod.metadata.uid);assert(previous,'Claim must reuse a pre-existing Pod');
  assert.equal(pod.status.containerStatuses[0].containerID,previous.status.containerStatuses[0].containerID);
  assert.equal(pod.status.containerStatuses[0].state.running.startedAt,previous.status.containerStatuses[0].state.running.startedAt);
  assert.equal(probe(pod.status.podIP),pod.metadata.name);
 }
 assert.equal(new Set(allocated.map(p=>p.metadata.uid)).size,2);
 await until('Service has exactly the two claimed endpoints',()=>endpoints().length===2);
 const serviceIp=get('service','claimed-http').spec.clusterIP;
 const response=probe(serviceIp);assert(allocated.some(p=>p.metadata.name===response));
 const warmObservedSeconds=(performance.now()-submitted)/1000;
 save('warm-claimed',{claims,pods:allocated,endpoints:endpoints(),response,warmObservedSeconds});
 await until('Pool automatically refilled to two ready reserves',()=>get('sandboxwarmpools','warm-http').status?.readyReplicas===2&&appPods().length===4&&appPods().every(ready));
 const refilled=appPods();assert.equal(refilled.filter(p=>!initial.some(a=>a.metadata.uid===p.metadata.uid)).length,2);
 save('warm-refilled',{pool:get('sandboxwarmpools','warm-http'),pods:refilled});
 console.log('Warm reuse, service isolation/access, and automatic refill passed');
 const coldStart=performance.now();console.log(create([claim('cold-application','cold-http')]));
 const cold=await until('Cold fallback claim ready',()=>{const c=get('sandboxclaims','cold-application');return ready(c)?c:null;});
 const coldPod=get('pods',cold.status.sandbox.name);assert(!refilled.some(p=>p.metadata.uid===coldPod.metadata.uid));
 assert.equal(probe(coldPod.status.podIP),coldPod.metadata.name);
 const coldObservedSeconds=(performance.now()-coldStart)/1000;
 save('cold-claimed',{claim:cold,pod:coldPod,coldObservedSeconds});
 console.log(k(['delete','sandboxclaims','application-one','application-two','cold-application','-n',namespace,'--wait=false']));
 await until('Released claim Pods removed; two reserve Pods remain',()=>appPods().length===2&&appPods().every(p=>!allocated.some(a=>a.metadata.uid===p.metadata.uid)&&p.metadata.uid!==coldPod.metadata.uid));
 await until('Released instances no longer receive Service traffic',()=>endpoints().length===0);
 assert.equal(get('pvc').items.length,0);
 save('test-result',{status:'PASS',at:new Date().toISOString(),checks:['controller-health','warm-ready-2','unclaimed-service-isolation','two-claims-reused-existing-pod-uid-container-id-start-time','http-via-pods-and-shared-service','automatic-refill-2','cold-fallback-new-pod','claim-deletion-cleans-allocated-pods','no-pvc'],warmObservedSeconds,coldObservedSeconds,timingScope:'CLI submission through Ready observation, verification queries and successful HTTP; smoke timings only, not a performance benchmark'});
 console.log(JSON.stringify(JSON.parse(readFileSync(`${folder}/test-result.json`)),null,2));
}

if(mode==='cleanup'){
 const started=JSON.parse(readFileSync(`${folder}/test-started.json`));assert.equal(started.namespace,namespace);
 assert.equal(namespace,'cea-warm-verify');
 save('test-events',get('events').items);
 save('test-final-objects',{pods:get('pods').items,sandboxes:get('sandboxes').items,pools:get('sandboxwarmpools').items,networkPolicies:get('networkpolicies').items});
 console.log(k(['delete','namespace',namespace,'--wait=false']));
 await until('Dedicated verification namespace removed',()=>k(['get','namespace',namespace,'--ignore-not-found','-o','name'])==='');
 save('test-cleanup',{at:new Date().toISOString(),deletedNamespace:namespace,controllerRetained:true});
}

if(mode==='audit'){
 const before=JSON.parse(readFileSync(`${folder}/before.json`));
 for(const [cluster,snapshot] of Object.entries(before.clusters)){
  const deployments=JSON.parse(k(['get','deployments','-A','-o','json'],undefined,cluster)).items;
  for(const previous of snapshot.deployments){
   const now=deployments.find(d=>d.metadata.uid===previous.uid);assert(now,`Missing old Deployment ${cluster}/${previous.name}`);
   assert.deepEqual(now.spec,previous.spec,`Changed old Deployment ${cluster}/${previous.name}`);
  }
  const extraDeployments=deployments.filter(d=>!snapshot.deployments.some(p=>p.uid===d.metadata.uid));
  assert.deepEqual(extraDeployments.map(d=>`${d.metadata.namespace}/${d.metadata.name}`),cluster==='cloud'?['agent-sandbox-system/agent-sandbox-controller']:[],`${cluster} unexpected Deployments`);
  const hpas=JSON.parse(k(['get','hpa','-A','-o','json'],undefined,cluster)).items;
  assert.deepEqual(hpas.map(h=>({uid:h.metadata.uid,spec:h.spec})),snapshot.hpas.map(h=>({uid:h.metadata.uid,spec:h.spec})),`${cluster} HPA changed`);
  const crds=JSON.parse(k(['get','crd','-o','json'],undefined,cluster)).items.map(d=>({name:d.metadata.name,uid:d.metadata.uid}));
  const allowed=['sandboxclaims.extensions.agents.x-k8s.io','sandboxes.agents.x-k8s.io','sandboxtemplates.extensions.agents.x-k8s.io','sandboxwarmpools.extensions.agents.x-k8s.io'];
  assert.deepEqual(crds.filter(c=>cluster!=='cloud'||!allowed.includes(c.name)),snapshot.crds,`${cluster} unrelated CRDs changed`);
  const namespaces=JSON.parse(k(['get','namespace','-o','json'],undefined,cluster)).items.map(n=>n.metadata.name);
  assert.deepEqual(namespaces.filter(n=>cluster!=='cloud'||n!=='agent-sandbox-system'),snapshot.namespaces,`${cluster} unrelated namespaces changed`);
 }
 const containers=JSON.parse(docker(['inspect',...before.containers.map(c=>c.id)]));
 for(const previous of before.containers){const now=containers.find(c=>c.Id===previous.id);assert(now);assert.equal(now.State.StartedAt,previous.started,`Container restarted: ${previous.name}`);assert(now.State.Running);}
 assert.equal(k(['get','namespace',namespace,'--ignore-not-found','-o','name']),'');
 const controller=JSON.parse(k(['get','pods','-n','agent-sandbox-system','-o','json'])).items[0];assert(ready(controller));assert.equal(controller.status.containerStatuses[0].restartCount,0);
 const logs=k(['logs','-n','agent-sandbox-system','deployment/agent-sandbox-controller']);
 writeFileSync(`${folder}/controller.log`,logs);
 const metrics=k(['top','pods','-n','agent-sandbox-system']);writeFileSync(`${folder}/controller-metrics.txt`,metrics);
 const logErrors=logs.split('\n').filter(l=>l.includes('"level":"error"'));
 const result={status:'PASS',at:new Date().toISOString(),oldContainers:before.containers.length,oldDeployments:Object.values(before.clusters).reduce((n,c)=>n+c.deployments.length,0),otherClustersUnchanged:true,controller,metrics,logErrors};save('audit',result);console.log(JSON.stringify({status:result.status,oldContainers:result.oldContainers,oldDeployments:result.oldDeployments,metrics,errorLogLines:logErrors.length},null,2));
}
