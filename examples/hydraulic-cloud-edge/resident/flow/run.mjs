import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync,copyFileSync,openAsBlob} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {sampleHost,hostStopReasons,hostSummary} from '../host-monitor.mjs';
import {verifyAccounting} from '../metrics.mjs';

const root=path.resolve('.local/cea/flow-dep-01-20261018');
const namespace='cea-lab-flow-dep01',name='hydraulic',flowId='hydraulic-resident-services',port=31101;
const image='cea/hydraulic-resident:flow-dep01',app='hydraulic-resident',version='flow-v1';
const clusters=['cloud','edge-a','edge-b','edge-c'],remote='/tmp/cea-lab-flow-dep01';
const env=Object.fromEntries(readFileSync('deploy/cea/.env','utf8').split(/\r?\n/).filter(l=>/^[A-Z_0-9]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const auth='Basic '+Buffer.from(env.BACKEND_USER+':'+env.BACKEND_PASSWORD).toString('base64');
const base='http://127.0.0.1:'+(env.CEA_API_PORT||18085)+'/api/namespaces/lab';
export async function api(route,body,method=body?'POST':'GET',headers={}) {
  const r=await fetch(base+route,{method,headers:{Authorization:auth,...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
  assert(r.ok,`${route}: ${r.status} ${r.ok?'':await r.text()}`);return r.status===204?null:r.json();
}
const docker=(args,input,timeout=30000)=>execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,timeout,maxBuffer:32*1024*1024}).trim();
const kube=(c,args,input,timeout)=>docker(['exec','-i',`cea-${c}-1`,'kubectl',...args],input,timeout);
const get=(c,resource,args=[])=>JSON.parse(kube(c,['get',resource,...args,'-o','json']));
const save=(file,value)=>{mkdirSync(path.dirname(path.join(root,file)),{recursive:true});writeFileSync(path.join(root,file),typeof value==='string'?value:JSON.stringify(value,null,2));};
const load=file=>JSON.parse(readFileSync(path.join(root,file),'utf8'));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const route=c=>`/clusters/${c}/kubernetes/namespaces/${namespace}`;
const pods=()=>Object.fromEntries(clusters.map(c=>[c,get(c,'pods',['-n',namespace]).items]));
function inventory(){return JSON.parse(docker(['inspect',...docker(['ps','-aq','--filter','name=cea-']).split(/\s+/)])).map(v=>({name:v.Name,id:v.Id,image:v.Image,running:v.State.Running,startedAt:v.State.StartedAt}));}
async function before(){
  assert(!existsSync(path.join(root,'before.json')),'Existing release evidence');
  for(let offset=0;;offset+=100){const rows=await api('/executions?limit=100&offset='+offset);assert(rows.every(e=>['SUCCESS','FAILED','CANCELLED','KILLED'].includes(e.state)),'Active flow: postpone release');if(rows.length<100)break;}
  save('before.json',inventory());
  save('old-kubernetes.json',Object.fromEntries(clusters.map(c=>[c,get(c,'deployments,services,hpa',['-A']).items.map(v=>({kind:v.kind,namespace:v.metadata.namespace,name:v.metadata.name,uid:v.metadata.uid,spec:v.spec}))])));
  console.log('No active flows; saved release and workload inventory');
}
async function prepare(){
  assert(!existsSync(path.join(root,'plan.json')),'Existing experiment: do not overwrite');
  const host=sampleHost();save('preparation-host.json',host);
  assert(host.linux.MemAvailable>=5632*2**20,'Insufficient WSL RAM for this experiment');
  const cpuCores=Number(docker(['exec','cea-cloud-1','nproc']));assert(cpuCores>=16,'Existing 15-core test budget requires 16 WSL CPUs');
  const endpoints={};
  for(const c of clusters){
    assert(!get(c,'namespaces').items.some(v=>v.metadata.name===namespace),'Namespace already exists');
    assert(!get(c,'services',['-A']).items.some(v=>v.spec.ports?.some(p=>p.nodePort===port)),'NodePort occupied');
    endpoints[c]='http://'+JSON.parse(docker(['inspect',`cea-${c}-1`]))[0].NetworkSettings.Networks.cea_default.IPAddress+':'+port;
  }
  save('plan.json',{namespace,flowId,image,app,version,endpoints,cpuCores,rate:140,cyclesPerBatch:128,sourceImage:docker(['image','inspect','cea/hydraulic-resident:hc20-batch128','--format','{{.Id}}'])});
  mkdirSync(path.join(root,'build'));
  copyFileSync('examples/hydraulic-cloud-edge/resident/flow/Dockerfile',path.join(root,'build/Dockerfile'));
  copyFileSync('.local/cea/hc01/full/reference.npz',path.join(root,'build/reference.npz'));
  save('build.log',docker(['build','-t',image,path.join(root,'build')],undefined,120000));
  docker(['image','save','-o',path.join(root,'image.tar'),image],undefined,120000);
  const parameters={ROLE:{type:'STRING',required:true,choices:clusters},CLOUD_URL:{type:'STRING',required:false,defaultValue:'http://127.0.0.1:8080'}};
  const form=new FormData();form.append('contract',new Blob([JSON.stringify({parameters})],{type:'application/json'}));form.append('file',await openAsBlob(path.join(root,'image.tar')),'resident.tar');
  const uploaded=await fetch(base+`/applications/${app}/versions/${version}/upload`,{method:'POST',headers:{Authorization:auth},body:form});
  assert(uploaded.ok,`Image upload ${uploaded.status}: ${uploaded.ok?'':await uploaded.text()}`);save('application.json',await uploaded.json());
  const prepareName=namespace+'-prepare';
  docker(['create','--name',prepareName,'--network','none','--cpus','1','--memory','1g',image,'python','/app/fixtures.py','prepare','/source','/fixtures','arrays','128']);
  docker(['cp',path.resolve('.local/cea/hc01/full'),prepareName+':/source'],undefined,120000);
  save('prepare.log',docker(['start','--attach',prepareName],undefined,180000));
  const state=JSON.parse(docker(['inspect',prepareName]))[0];save('prepare-state.json',state.State);assert.equal(state.State.ExitCode,0);
  docker(['cp',prepareName+':/fixtures',path.join(root,'fixtures')],undefined,120000);docker(['rm',prepareName]);
  const manifest=JSON.parse(readFileSync(path.join(root,'fixtures/manifest.json'),'utf8'));assert.equal(manifest.length,18);assert.equal(manifest.reduce((s,v)=>s+v.expected.inputBytes,0),385257600);save('manifest.json',manifest);
  for(const c of clusters)await api(`/clusters/${c}/kubernetes/namespaces`,{name:namespace});
  docker(['exec','cea-cloud-1','mkdir',remote]);docker(['cp',path.join(root,'fixtures'),`cea-cloud-1:${remote}/fixtures`],undefined,120000);
  for(const f of ['load.js','metrics.mjs'])docker(['cp','examples/hydraulic-cloud-edge/resident/rate/'+f,`cea-cloud-1:${remote}/${f}`]);
  console.log('Image registered; fixtures ready; managed namespaces created');
}
function definition(){
  const {endpoints}=load('plan.json');
  const task=c=>({id:'deploy_'+c.replace('-','_'),type:'platform.Deployment',timeout:'PT5M',container:{applicationId:app,version,candidateClusters:[c],
    parameters:{ROLE:{source:'LITERAL',value:c},...(c==='cloud'?{}:{CLOUD_URL:{source:'TASK_OUTPUT',taskId:'deploy_cloud',port:'endpoint'}})},
    resources:{limits:{cpu:'2',memory:c==='cloud'?'1Gi':'2Gi'}}},deployment:{name,kubeNamespace:namespace,replicas:1,
      readiness:{path:'/health',port:8080},service:{port:8080,targetPort:8080,nodePort:port,endpoint:endpoints[c]}}});
  return {schemaVersion:1,namespace:'lab',id:flowId,description:'液压数据流常驻服务：先部署中心聚合，再部署三个边缘处理服务',tasks:[task('cloud'),{id:'edges',type:'core.Parallel',tasks:clusters.slice(1).map(task)}],
    outputs:Object.fromEntries(clusters.map(c=>[c.replace('-','_'),{source:'TASK_OUTPUT',taskId:'deploy_'+c.replace('-','_'),port:'endpoint'}]))};
}
async function deploy(mode='execution'){
  const repeat=mode==='repeat',label=mode;assert(!existsSync(path.join(root,label+'.json')),'Execution exists: inspect, do not resubmit');
  let revision;
  if(repeat){revision=load('revision.json').revision;save('before-repeat-pods.json',pods());}
  else if(mode==='update-fixed'){revision=load('revision.json').revision;save('before-update-fixed.json',get('cloud','deployments,services',['-n',namespace]).items);}
  else if(mode==='update') {
    const flow=definition();flow.tasks[0].container.command=['python','/app/service.py'];flow.tasks[0].deployment.service.port=8081;
    save('before-update.json',get('cloud','deployments,services',['-n',namespace]).items);
    const value=await api('/flows/'+flowId+'/revisions',{expectedRevision:load('revision.json').revision,source:JSON.stringify(flow)});save('revision.json',value);save('updated-flow.json',flow);revision=value.revision;
  }
  else {const flow=definition();save('flow.json',flow);const value=await api('/flows/'+flowId+'/revisions',{expectedRevision:0,source:JSON.stringify(flow)});save('revision.json',value);revision=value.revision;}
  const accepted=await api('/executions',{flowId,revision,inputs:{}},'POST',{'Idempotency-Key':'flow-dep01-'+label});save(label+'.json',accepted);
  for(let i=0;i<180;i++){
    const execution=await api('/executions/'+accepted.executionId);
    if(['SUCCESS','FAILED','CANCELLED'].includes(execution.state)){
      save(label+'-result.json',execution);save(label+'-tasks.json',await api('/executions/'+accepted.executionId+'/tasks'));save(label+'-pods.json',pods());
      assert.equal(execution.state,'SUCCESS',execution.error);assert.deepEqual(execution.outputs, Object.fromEntries(Object.entries(load('plan.json').endpoints).map(([k,v])=>[k.replace('-','_'),v])));
      for(const c of clusters){const configuration=await api(route(c)+'/deployments/'+name+'/configuration');save(label+'-'+c+'-configuration.json',configuration);assert.equal(configuration.parameters.ROLE,c);if(c!=='cloud')assert.equal(configuration.parameters.CLOUD_URL,execution.outputs.cloud);}
      if(repeat)for(const c of clusters)assert.deepEqual(load('before-repeat-pods.json')[c].map(p=>p.metadata.uid),pods()[c].map(p=>p.metadata.uid),'Repeated deployment replaced Pods');
      if(mode==='update'||mode==='update-fixed') {
        const current=get('cloud','deployments,services',['-n',namespace]).items;save('after-'+mode+'.json',current);
        for(const old of load('before-update.json'))assert.equal(current.find(v=>v.kind===old.kind&&v.metadata.name===old.metadata.name).metadata.uid,old.metadata.uid);
        assert.equal(current.find(v=>v.kind==='Service').spec.ports[0].port,8081);
      }
      console.log(JSON.stringify({executionId:accepted.executionId,state:execution.state,outputs:execution.outputs}));return;
    }
    await pause(2000);
  }
  throw Error('Execution still active; inspect without resubmitting');
}
async function verify(){
  const label=namespace+'-verify';assert(!existsSync(path.join(root,'correctness.json')),'Verification exists');
  docker(['create','--name',label,'--network','cea_default','--cpus','1','--memory','512m',image,'python','/app/fixtures.py','verify','/fixtures',JSON.stringify(load('plan.json').endpoints)]);
  docker(['cp',path.join(root,'fixtures'),label+':/fixtures'],undefined,120000);
  const output=docker(['start','--attach',label],undefined,120000);save('verify.log',output);assert.equal(JSON.parse(docker(['inspect',label]))[0].State.ExitCode,0);
  const result=JSON.parse(output);save('correctness.json',result);assert.equal(result.status,'PASS');assert.equal(result.arraysCompared,90);
  for(const c of clusters){assert.equal(result.stats[c].cpuMax,'200000 100000');assert.equal(Number(result.stats[c].memoryMax),(c==='cloud'?1:2)*2**30);}
  docker(['rm',label]);console.log(JSON.stringify({status:result.status,arrays:result.arraysCompared,cycles:result.cycles}));
}
async function trial(label,duration){
  assert(['probe','measure','measure-01'].includes(label));assert.equal(duration,label==='probe'?'10s':'60s');assert(!existsSync(path.join(root,'failed.json')),'Previous trial failed; no retry');
  assert(!existsSync(path.join(root,label)),'Label exists; no retry');assert.equal(load('correctness.json').status,'PASS');
  if(label.startsWith('measure'))assert.equal(load('probe/validation.json').status,'PASS');
  assert(!get('cloud','pods',['-n',namespace,'-l','role=load']).items.length,'Load already exists');
  const samples=[sampleHost()];save(label+'/preflight.json',samples[0]);
  assert(samples[0].linux.MemAvailable>=5632*2**20,'Insufficient WSL RAM for k6 plus reserve');assert(!hostStopReasons(samples,'capacity').length);
  const loadName='load-'+label;
  const spec={apiVersion:'v1',kind:'Pod',metadata:{name:loadName,namespace,labels:{role:'load'}},spec:{restartPolicy:'Never',automountServiceAccountToken:false,
    volumes:[{name:'input',hostPath:{path:remote,type:'Directory'}},{name:'output',emptyDir:{}}],containers:[{name:'k6',image:'grafana/k6:1.3.0',imagePullPolicy:'Never',
    command:['sh','-c','k6 run /input/load.js > /output/k6.log 2>&1; echo $? > /output/exit; sleep 3600'],
    env:Object.entries({RUN:'flow-dep01-'+label,EXPERIMENT:'HC-20',RATE:'140',DURATION:duration,PRE_ALLOCATED_VUS:'32',MAX_VUS:'32',ENDPOINTS:JSON.stringify(load('plan.json').endpoints),GOMEMLIMIT:'4096MiB',GOGC:'50'}).map(([name,value])=>({name,value})),
    resources:{requests:{cpu:'1',memory:'512Mi'},limits:{cpu:'7',memory:'5Gi'}},volumeMounts:[{name:'input',mountPath:'/input',readOnly:true},{name:'input',mountPath:'/fixtures',subPath:'fixtures',readOnly:true},{name:'output',mountPath:'/output'}]}]}};
  save(label+'/pod.json',spec);save(label+'/business-before.json',pods());kube('cloud',['create','-f','-'],JSON.stringify(spec));
  try{
    let code=null,stopped=false;
    for(let i=0;i<100;i++){
      const p=get('cloud','pod',[loadName,'-n',namespace]);save(label+'/pod-latest.json',p);
      if(p.status.phase==='Running') {const text=kube('cloud',['exec',loadName,'-n',namespace,'--','sh','-c','if [ -f /output/exit ]; then cat /output/exit; fi']);if(text){code=Number(text);break;}}
      assert(!p.status.containerStatuses?.[0]?.state?.terminated,'Load container terminated');
      samples.push(sampleHost(samples.at(-1)));save(label+'/host.json',samples);
      if(hostStopReasons(samples,'capacity').length&&!stopped){stopped=true;kube('cloud',['exec',loadName,'-n',namespace,'--','sh','-c','kill -INT $(pidof k6)']);}
      await pause(2000);
    }
    assert.notEqual(code,null,'Load timeout; preserve evidence');
    const log=kube('cloud',['exec',loadName,'-n',namespace,'--','cat','/output/k6.log']);save(label+'/k6.log',log);
    const result=JSON.parse(kube('cloud',['exec',loadName,'-n',namespace,'--','cat','/output/summary.json']));save(label+'/summary.json',result);
    samples.push(sampleHost(samples.at(-1)));save(label+'/host-summary.json',hostSummary(samples,'capacity'));save(label+'/business-after.json',pods());
    const stats={};for(const line of log.split('\n')){const match=line.match(/msg=("(?:[^"\\]|\\.)*") source=console/);if(!match)continue;const row=JSON.parse(match[1]).match(/^HC20_STATS (edge-[abc]|cloud) (\{.*\})\s*$/);if(row)stats[row[1]]=JSON.parse(row[2]);}save(label+'/stats.json',stats);
    assert.equal(code,0);assert(!stopped);assert(!hostStopReasons(samples,'capacity').length);verifyAccounting(result.report,stats,load('manifest.json'));
    assert.equal(result.report.GBps,result.report.signalBytes/result.report.seconds/1e9);
    save(label+'/validation.json',{status:'PASS'});kube('cloud',['delete','pod',loadName,'-n',namespace,'--wait=true','--timeout=45s'],undefined,55000);console.log(JSON.stringify(result.report));
  }catch(error){save('failed.json',{label,error:String(error)});throw error;}
}
function audit(){
  const beforeState=load('before.json'),after=inventory();
  for(const c of beforeState.filter(v=>!['/cea-backend-1','/cea-frontend-1'].includes(v.name)))assert.deepEqual(after.find(v=>v.name===c.name),c,'Unrelated container changed');
  const old=load('old-kubernetes.json');for(const c of clusters){const current=get(c,'deployments,services,hpa',['-A']).items;for(const row of old[c]){const now=current.find(v=>v.kind===row.kind&&v.metadata.namespace===row.namespace&&v.metadata.name===row.name);assert(now);assert.equal(now.metadata.uid,row.uid);assert.deepEqual(now.spec,row.spec);}}
  save('audit.json',{status:'PASS',oldContainers:beforeState.length,servicesRetained:4,loadPods:get('cloud','pods',['-n',namespace,'-l','role=load']).items.length});console.log('AUDIT_PASS; four flow-deployed services retained');
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'))){
  const command=process.argv[2];
  if(command==='before')await before();else if(command==='prepare')await prepare();else if(command==='deploy')await deploy();else if(command==='repeat')await deploy('repeat');else if(command==='update')await deploy('update');else if(command==='update-fixed')await deploy('update-fixed');
  else if(command==='verify')await verify();else if(command==='trial')await trial(process.argv[3],process.argv[4]);else if(command==='audit')audit();
  else throw Error('Use before|prepare|deploy|repeat|update|update-fixed|verify|trial probe 10s|trial measure 60s|audit');
}
