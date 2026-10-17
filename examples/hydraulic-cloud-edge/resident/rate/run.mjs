import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync,rmSync,readdirSync,appendFileSync,copyFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {verifyAccounting,resourceSummary} from '../metrics.mjs';
import {sampleHost,hostStopReasons,hostSummary} from '../host-monitor.mjs';
import {arrivalBoundaryAllowance} from './metrics.mjs';

// Distinct revisions own distinct evidence/failed markers. Never reset an old run.
export function experimentConfig(experiment='HC-14',revision){
  assert(['HC-14','HC-15','HC-16','HC-17','HC-18','HC-19'].includes(experiment),'Unknown experiment');
  if(experiment==='HC-19'){
    assert(revision===undefined||revision==='no-limit','HC-19 only tests the changed image; no baseline/return');
    return {experiment,revision:'no-limit',batch:'hc19-no-limit-20261018',namespace:'cea-hc19-no-limit-20261018',nodePort:31099,image:'cea/hydraulic-resident:hc19-no-limit',logPrefix:'HC19'};
  }
  if(experiment==='HC-18'){
    assert(['baseline','short-lock','return'].includes(revision),'HC-18 requires explicit HC_REVISION=baseline|short-lock|return');
    const batch='hc18-'+revision+'-20261018';
    return {experiment,revision,batch,namespace:'cea-'+batch,nodePort:31098,image:'cea/hydraulic-resident:'+(revision==='short-lock'?'hc18-short-lock':'hc17-views'),logPrefix:'HC18'};
  }
  if(experiment==='HC-14')return {experiment,revision:null,batch:'hc14-20261017',namespace:'cea-hc14-20261017',nodePort:31094,image:'cea/hydraulic-resident:hc05-v1',logPrefix:'HC14'};
  if(experiment==='HC-16'){
    assert(revision===undefined||revision==='fixed','HC-16 only uses the existing HC-15 fixed image');
    return {experiment,revision:'fixed',batch:'hc16-20261017',namespace:'cea-hc16-20261017',nodePort:31096,image:'cea/hydraulic-resident:hc15-fixed',logPrefix:'HC16'};
  }
  if(experiment==='HC-17'){
    assert(['baseline','views','return'].includes(revision),'HC-17 requires explicit HC_REVISION=baseline|views|return');
    const batch='hc17-'+revision+'-20261017';
    return {experiment,revision,batch,namespace:'cea-'+batch,nodePort:31097,image:'cea/hydraulic-resident:'+(revision==='views'?'hc17-views':'hc15-fixed'),logPrefix:'HC17'};
  }
  assert(['diagnostic','fixed'].includes(revision),'HC-15 requires explicit HC_REVISION=diagnostic|fixed');
  const batch='hc15-'+revision+'-20261017';
  return {experiment,revision,batch,namespace:'cea-'+batch,nodePort:31095,image:'cea/hydraulic-resident:hc15-'+revision,logPrefix:'HC15'};
}
const {experiment,revision,batch,namespace,nodePort,image,logPrefix}=experimentConfig(process.env.HC_EXPERIMENT||'HC-14',process.env.HC_REVISION),rate=273;
const folder=path.resolve('.local/cea/'+batch),remote='/tmp/'+namespace;
const source='examples/hydraulic-cloud-edge/resident/rate',clusters=['edge-a','edge-b','edge-c','cloud'];
export const initialAllocation=Object.fromEntries([...clusters.map(c=>[c,{cpu:2,memoryMiB:c==='cloud'?1024:2048}]),['load',{cpu:7,memoryMiB:5120}]]);
export const hc16Sequence=[
  {label:'warmup-32',duration:'10s',preVUs:32,maxVUs:32},
  {label:'baseline-32',duration:'30s',preVUs:32,maxVUs:32},
  {label:'probe-48',duration:'10s',preVUs:48,maxVUs:48},
  {label:'candidate-48',duration:'30s',preVUs:48,maxVUs:48},
  {label:'return-32',duration:'30s',preVUs:32,maxVUs:32}
];
export function hc17Sequence(runRevision){
  assert(['baseline','views','return'].includes(runRevision));
  const sequence=[{label:'probe-10s',duration:'10s',preVUs:32,maxVUs:32},{label:'compare-30s',duration:'30s',preVUs:32,maxVUs:32}];
  if(runRevision==='views')for(let i=1;i<=3;i++)sequence.push({label:'confirm-'+i,duration:'60s',preVUs:32,maxVUs:32});
  return sequence;
}
export function fixturePrepareArgs(experimentName=experiment,runRevision=revision){
  return ['prepare','/source','/fixtures',...(['HC-18','HC-19'].includes(experimentName)||experimentName==='HC-17'&&runRevision==='views'?['arrays']:[])];
}
export function validateFixtureFormat(manifest,experimentName=experiment,runRevision=revision){
  if(!['HC-17','HC-18','HC-19'].includes(experimentName))return;
  const expected=['HC-18','HC-19'].includes(experimentName)||runRevision==='views'?'application/vnd.cea.hydraulic-arrays':'application/octet-stream';
  for(const item of manifest)for(const file of item.files)assert.equal(file.contentType||'application/octet-stream',expected,'Input format differs from the frozen phase');
}
export function assertConfirmationGate(baseline,candidate,approval,experimentName='HC-17'){
  assert(['HC-17','HC-18'].includes(experimentName));
  assert.equal(approval,'1','Confirmations require explicit review approval: '+experimentName.replace('-','')+'_CONFIRM_APPROVED=1');
  for(const row of [baseline,candidate]){
    assert(row.processingValid&&row.failed===0&&row.started===row.batches&&row.exitCode===0,'Comparison must be complete and zero-error');
    assert.equal(row.run,experimentName==='HC-18'?'compare-60s':'compare-30s');assert.equal(row.durationSeconds,experimentName==='HC-18'?60:30);assert.equal(row.preAllocatedVUs,32);assert.equal(row.maxVUs,32);assert.equal(row.rate,273);
    assert.deepEqual(row.allocation,initialAllocation,'Compare quotas must remain frozen');
  }
  assert(candidate.GBps>baseline.GBps,'Candidate has no throughput gain over this batch baseline');
}
export function hc18Sequence(runRevision){
  assert(['baseline','short-lock','return'].includes(runRevision));
  const sequence=[{label:'probe-10s',duration:'10s',preVUs:32,maxVUs:32},{label:'compare-60s',duration:'60s',preVUs:32,maxVUs:32}];
  if(runRevision==='short-lock')for(let i=2;i<=3;i++)sequence.push({label:'confirm-'+i,duration:'60s',preVUs:32,maxVUs:32});
  return sequence;
}
export const hc19Sequence=[{label:'probe-10s',duration:'10s',preVUs:32,maxVUs:32},
  ...[1,2,3].map(n=>({label:'measure-'+n,duration:'60s',preVUs:32,maxVUs:32}))];
export function experimentProtocol(experimentName=experiment,runRevision=revision){
  if(experimentName==='HC-19')return {rate,revision:'no-limit',sequence:hc19Sequence,defaultPreAllocatedVUs:32,defaultMaxVUs:32,
    freeze:'Remove only cloud fusion semaphore; keep short state locks and single edge compute slot, algorithm/precision/35 batches/64 cycles/array-view input/NPZ features/32 VUs/273 batches per second/quotas/full HTTP chain',
    adjustment:'candidate only as requested; no baseline/return or quota changes; review each run health before next; no retry on failure',
    acceptance:'175 full arrays, concurrent unit tests and 10s probe then three equal 60s runs; report all drops, errors, resources and 2.5GB/s attainment; HC18 reference is historical, not a contemporaneous controlled gain'};
  if(experimentName==='HC-18')return {rate,revision:runRevision,sequence:hc18Sequence(runRevision),optionalConfirmations:runRevision==='short-lock',defaultPreAllocatedVUs:32,defaultMaxVUs:32,
    freeze:'HC17 views baseline/return versus HC18 short state lock; all phases array-view input, NPZ features, identical algorithm/precision/single compute slot/35 batches/64 cycles/32 VUs/273 batches per second/quotas/full HTTP chain',
    adjustment:'only center shared-state lock scope changes; no reconfiguration or retries; clean/audit each phase; two additional candidate 60s runs only after reviewed zero-error gain over the current baseline',
    acceptance:'175 arrays per phase, 10s probe and 60s comparison; candidate comparison plus two confirmations form three equal 60s measurements; report drops, return drift and actual 2.5GB/s attainment'};
  if(experimentName==='HC-17')return {rate,revision:runRevision,sequence:hc17Sequence(runRevision),optionalConfirmations:runRevision==='views',defaultPreAllocatedVUs:32,defaultMaxVUs:32,
    freeze:'HC-15 fixed image/NPZ for baseline and return; HC-17 views image/array-view input for candidate; same algorithm/35 batches/64 cycles/HTTP result verification, 32 VUs, 273 batches/s, CPU/memory quotas and raw-byte complete-chain measurement',
    adjustment:'no resource reconfiguration; clean and audit each isolated phase before the next; no automatic retry or confirmation; views confirmations require zero errors and explicitly reviewed clear gain over the HC-17 baseline comparison',
    acceptance:'each phase probe 10s then compare 30s; report short comparisons separately from optional views 3x60s confirmations; report drops and return-baseline drift, not nominal 3GB/s as accepted throughput'};
  if(experimentName==='HC-16')return {rate,sequence:hc16Sequence,defaultPreAllocatedVUs:32,defaultMaxVUs:32,
    freeze:'existing hc15-fixed image; same original algorithm/35 batches/64 cycles/HTTP result verification, buffer reuse, 273 batches/s and CPU/memory quotas; only k6 VU concurrency changes; preserve TCP evidence',
    adjustment:'no resource reconfiguration, no 64 VUs or extra 60-second confirmation; review health and memory after each trial before continuing',
    acceptance:'zero request/accounting failures; compare baseline-32/candidate-48/return-32 throughput, latency, drops and resources; warmup/probe excluded from comparison; return-32 identifies ordering/cache drift; no automatic retry or stable-performance claim'};
  return {rate,probeSeconds:10,sweepSeconds:30,confirmSeconds:60,confirmRepetitions:3,defaultPreAllocatedVUs:32,defaultMaxVUs:32,
    freeze:experimentName==='HC-14'?'same hc05-v1 business image, original 35 batches/64 cycles, HTTP/result verification and reused k6 buffers; no algorithm, connection-recovery, WSL or old-service change':
      'HC-15 '+runRevision+' image fixed per revision; original algorithm/35 batches/64 cycles/HTTP result verification, resources and arrival schedule unchanged; collect TCP evidence; no automatic request retry or old-service/WSL change',
    adjustment:'only CPU/memory quota changes after measured saturation; single business 2 to 3/4 cores, load 7 to 5/6 only if measured spare; total quotas <= WSL cores minus 1; reverify after changes',
    acceptance:'zero request/accounting failures; record drops and late starts separately; observed throughput with drops is not sustained 3GB/s offered load; healthy >=2GB/s then three 60-second confirmations; no retries'};
}
export function validateTrialParameters(label,duration,preVUs,maxVUs,experimentName=experiment,runRevision=revision){
  assert(/^[a-z0-9-]+$/.test(label));assert(['10s','30s','60s'].includes(duration));assert([12,24,32,48].includes(preVUs)&&[32,48].includes(maxVUs)&&preVUs<=maxVUs);
  if(experimentName==='HC-16')assert.deepEqual({label,duration,preVUs,maxVUs},hc16Sequence.find(row=>row.label===label),'HC-16 trial must match frozen concurrency comparison');
  if(experimentName==='HC-17')assert.deepEqual({label,duration,preVUs,maxVUs},hc17Sequence(runRevision).find(row=>row.label===label),'HC-17 trial must match the frozen phase');
  if(experimentName==='HC-18')assert.deepEqual({label,duration,preVUs,maxVUs},hc18Sequence(runRevision).find(row=>row.label===label),'HC-18 trial must match the frozen phase');
  if(experimentName==='HC-19')assert.deepEqual({label,duration,preVUs,maxVUs},hc19Sequence.find(row=>row.label===label),'HC-19 only permits candidate probe and three measurements');
}
const docker=(args,input,timeout=30000)=>execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,timeout,maxBuffer:64*1024*1024}).trim();
const kube=(cluster,args,input)=>docker(['exec','-i',`cea-${cluster}-1`,'kubectl',...args],input);
const get=(cluster,resource,args=[])=>JSON.parse(kube(cluster,['get',resource,...args,'-o','json']));
const save=(name,value)=>writeFileSync(path.join(folder,name),JSON.stringify(value,null,2));
const load=name=>JSON.parse(readFileSync(path.join(folder,name),'utf8'));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const create=(cluster,items)=>kube(cluster,['create','-f','-'],JSON.stringify({apiVersion:'v1',kind:'List',items}));
const pod=cluster=>get(cluster,'pods',['-n',namespace,'-l','app=hydraulic']).items[0];
const write=(target,file,value)=>writeFileSync(path.join(target,file),typeof value==='string'?value:JSON.stringify(value,null,2));
function podCgroups(){
  const program="import json,time; from pathlib import Path; p=Path('/sys/fs/cgroup'); text=lambda f:(p/f).read_text().strip(); pairs=lambda f:dict((k,int(v)) for k,v in (line.split() for line in text(f).splitlines())); print(json.dumps(dict(at=time.time(),cpuMax=text('cpu.max'),cpuStat=pairs('cpu.stat'),memoryCurrent=int(text('memory.current')),memoryMax=int(text('memory.max')),memoryEvents=pairs('memory.events'))))";
  return Object.fromEntries(clusters.map(c=>{
    const current=pod(c),values=JSON.parse(kube(c,['exec',current.metadata.name,'-n',namespace,'--','python','-c',program]));
    return [c,{pod:current.metadata.name,uid:current.metadata.uid,...values}];
  }));
}
export function parseNetworkCounters(raw){
  const result={},lines=raw.trim().split(/\r?\n/);
  assert.equal(lines.length%2,0,'Network header/value line mismatch');
  for(let i=0;i<lines.length;i+=2){
    const keys=lines[i].trim().split(/\s+/),values=lines[i+1].trim().split(/\s+/);
    assert.equal(keys[0],values[0]);assert.equal(keys.length,values.length);
    for(let j=1;j<keys.length;j++){const value=Number(values[j]);assert(Number.isFinite(value));result[keys[0].slice(0,-1)+'.'+keys[j]]=value;}
  }
  return result;
}
function podNetwork(){
  const program="import json,time; from pathlib import Path; print(json.dumps(dict(at=time.time(),netstat=Path('/proc/net/netstat').read_text(),snmp=Path('/proc/net/snmp').read_text())))";
  return Object.fromEntries(clusters.map(c=>{
    const p=pod(c),raw=JSON.parse(kube(c,['exec',p.metadata.name,'-n',namespace,'--','python','-c',program]));
    return [c,{pod:p.metadata.name,uid:p.metadata.uid,containerId:p.status.containerStatuses?.[0]?.containerID,...raw,
      counters:{...parseNetworkCounters(raw.netstat),...parseNetworkCounters(raw.snmp)}}];
  }));
}
export function networkDelta(before,after){
  const keys=['TcpExt.ListenOverflows','TcpExt.ListenDrops','TcpExt.TCPBacklogDrop','TcpExt.TCPReqQFullDrop','TcpExt.TCPAbortOnData',
    'TcpExt.TCPAbortOnClose','TcpExt.TCPAbortOnMemory','TcpExt.TCPAbortOnTimeout','TcpExt.TCPAbortOnLinger','TcpExt.TCPAbortFailed',
    'Tcp.OutRsts','Tcp.EstabResets','Tcp.AttemptFails','Tcp.RetransSegs','TcpExt.TCPSynRetrans'];
  return Object.fromEntries(clusters.filter(c=>before?.[c]&&after?.[c]).map(c=>{
    const samePod=before[c].uid===after[c].uid;
    return [c,{samePod,sameContainer:before[c].containerId===after[c].containerId,
      counters:samePod?Object.fromEntries(keys.filter(k=>Number.isFinite(before[c].counters[k])&&Number.isFinite(after[c].counters[k]))
        .map(k=>[k,after[c].counters[k]-before[c].counters[k]])):null}];
  }));
}

function snapshot(){
  const ids=docker(['ps','-aq','--filter','name=cea-']).split(/\s+/);
  const containers=JSON.parse(docker(['inspect',...ids])).map(c=>({id:c.Id,name:c.Name,image:c.Image,started:c.State.StartedAt,running:c.State.Running,
    memory:c.HostConfig.Memory,memorySwap:c.HostConfig.MemorySwap,nanoCpus:c.HostConfig.NanoCpus}));
  const objects=Object.fromEntries(clusters.map(c=>[c,get(c,'deployments,services,hpa',['-A']).items.filter(v=>v.metadata.namespace!==namespace)
    .map(v=>({kind:v.kind,name:v.metadata.namespace+'/'+v.metadata.name,uid:v.metadata.uid,spec:v.spec}))]));
  const active=Object.fromEntries(clusters.map(c=>[c,get(c,'jobs',['-A','--field-selector=status.successful=0']).items.filter(v=>v.status.active>0).map(v=>v.metadata.name)]));
  const items=get('cloud','sandboxes,sandboxclaims,sandboxwarmpools,sandboxtemplates,warmservices',['-n','cea-hpa-warm-20261016']).items;
  const sandboxes=items.filter(v=>v.kind==='Sandbox');assert.equal(sandboxes.length,3);assert(sandboxes.every(v=>v.spec.operatingMode==='Suspended'));
  const warm=items.map(v=>({name:v.kind+'/'+v.metadata.name,uid:v.metadata.uid,spec:v.spec})).sort((a,b)=>a.name.localeCompare(b.name));
  const log=JSON.parse(docker(['inspect','harbor-log']))[0];assert.equal(log.State.Running,false);
  return {containers,objects,active,warm,harborLog:{id:log.Id,running:log.State.Running,started:log.State.StartedAt}};
}
function businessResources(cluster,endpoints){
  const a=initialAllocation[cluster],budget={cpu:String(a.cpu),memory:a.memoryMiB+'Mi'},cloud=cluster==='cloud';
  return [
    {apiVersion:'v1',kind:'Service',metadata:{name:'hydraulic',namespace},spec:{type:'NodePort',selector:{app:'hydraulic'},ports:[{port:8080,targetPort:8080,nodePort}]}},
    {apiVersion:'apps/v1',kind:'Deployment',metadata:{name:'hydraulic',namespace},spec:{replicas:1,selector:{matchLabels:{app:'hydraulic'}},template:{metadata:{labels:{app:'hydraulic'}},spec:{automountServiceAccountToken:false,
      volumes:cloud?[{name:'reference',configMap:{name:'reference'}}]:[],containers:[{name:'app',image,imagePullPolicy:'Never',
        env:[{name:'ROLE',value:cluster},{name:'CLOUD_URL',value:endpoints.cloud}],ports:[{containerPort:8080}],resources:{requests:budget,limits:budget},
        readinessProbe:{httpGet:{path:'/health',port:8080},initialDelaySeconds:1,periodSeconds:2},volumeMounts:cloud?[{name:'reference',mountPath:'/reference',readOnly:true}]:[]}]}}}}
  ];
}
function copiedInput(label,input,target,args,network,memory,output){
  const name=namespace+'-'+label;
  const id=docker(['create','--name',name,'--network',network,'--cpus','1','--memory',memory,image,'python','/app/fixtures.py',...args]);
  save(label+'-container.json',{id,name});docker(['cp',input,id+':'+target],undefined,120000);
  if(['HC-17','HC-18','HC-19'].includes(experiment)&&label==='prepare'){
    const archived=['service.py','fixtures.py','test_service.py',...(['HC-18','HC-19'].includes(experiment)||revision==='views'?['input_codec.py','test_input_codec.py']:[])];
    for(const file of archived)docker(['cp',id+':/app/'+file,path.join(folder,'protocol',file)]);
    save('protocol/image-source.json',{image,imageId:load('plan.json').imageId,files:archived,source:'Copied from the actual preparation image container; not current working-tree service source'});
  }
  let log;
  try{log=docker(['start','--attach',id],undefined,180000);}
  catch(error){write(folder,label+'-failure.log',String(error.stdout||'')+'\n'+String(error.stderr||error));save(label+'-final.json',JSON.parse(docker(['inspect',id]))[0].State);throw error;}
  write(folder,label+'.log',log);const final=JSON.parse(docker(['inspect',id]))[0];save(label+'-final.json',final.State);
  assert.equal(final.State.ExitCode,0,'Preparation/verification failed; keep container evidence');
  if(output)docker(['cp',id+':'+output,path.join(folder,'fixtures')],undefined,120000);
  assert.equal(final.Name,'/'+name);docker(['rm',id]);return log;
}
async function setup(){
  if(experiment==='HC-18'&&revision!=='baseline'){
    const previous=revision==='short-lock'?'baseline':'short-lock';
    const audit=JSON.parse(readFileSync(path.resolve('.local/cea/hc18-'+previous+'-20261018/audit.json'),'utf8'));
    assert.equal(audit.status,'PASS','Previous phase must be cleaned and audited');assert.equal(audit.newPodsRemaining,0);
  }
  if(experiment==='HC-17'&&revision!=='baseline'){
    const previous=revision==='views'?'baseline':'views';
    const audit=JSON.parse(readFileSync(path.resolve('.local/cea/hc17-'+previous+'-20261017/audit.json'),'utf8'));
    assert.equal(audit.status,'PASS','Previous phase must be cleaned and audited');assert.equal(audit.newPodsRemaining,0);
  }
  assert(!existsSync(path.join(folder,'plan.json')),'Existing batch; do not overwrite');mkdirSync(folder,{recursive:true});
  const before=snapshot();save('before.json',before);assert(clusters.every(c=>before.active[c].length===0),'Active jobs: postpone experiment');
  const host=sampleHost(),cpuCores=Number(docker(['exec','cea-cloud-1','nproc']));assertBudget(initialAllocation,cpuCores);
  assert(host.linux.MemAvailable>=5632*2**20,'Insufficient WSL memory for k6 plus reserve');
  save('capacity.json',{cpuCores,memoryBytes:host.linux.MemTotal,background:host});
  const endpoints={};
  for(const c of clusters){
    assert(!get(c,'namespaces').items.some(v=>v.metadata.name===namespace),'Namespace exists');
    assert(!get(c,'services',['-A']).items.some(v=>v.spec.ports?.some(p=>p.nodePort===nodePort)),'NodePort occupied');
    endpoints[c]='http://'+JSON.parse(docker(['inspect',`cea-${c}-1`]))[0].NetworkSettings.Networks.cea_default.IPAddress+':'+nodePort;
  }
  save('allocation.json',initialAllocation);
  save('plan.json',{experiment,revision,namespace,image,nodePort,endpoints,initialAllocation,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),imageId:docker(['image','inspect',image,'--format','{{.Id}}']),
    scope:'complete hydraulic HTTP chain; original raw signal bytes once / first HTTP send to last verified result; no deployment/startup/persistence in timed interval',
    protocol:experimentProtocol()});
  const archiveFolder=path.join(folder,'protocol');mkdirSync(archiveFolder);
  for(const f of ['run.mjs','load.js'])copyFileSync(path.join(source,f),path.join(archiveFolder,f));
  copyFileSync(path.join(source,'metrics.mjs'),path.join(archiveFolder,'load-metrics.mjs'));
  for(const f of ['host-monitor.mjs','metrics.mjs',...(['HC-17','HC-18','HC-19'].includes(experiment)?[]:['fixtures.py'])])copyFileSync(path.join(source,'..',f),path.join(archiveFolder,f));
  if(!['HC-14','HC-17','HC-18','HC-19'].includes(experiment))for(const f of ['service.py','test_service.py'])copyFileSync(path.join(source,'..',f),path.join(archiveFolder,f));
  console.log(copiedInput('prepare',path.resolve('.local/cea/hc01/full'),'/source',fixturePrepareArgs(),'none','1g','/fixtures'));
  save('manifest.json',JSON.parse(readFileSync(path.join(folder,'fixtures/manifest.json'),'utf8')));
  validateFixtureFormat(load('manifest.json'));
  const archive=path.join(folder,'image.tar');docker(['image','save','-o',archive,image],undefined,120000);
  for(const c of clusters){
    docker(['cp',archive,`cea-${c}-1:/tmp/${namespace}-image.tar`],undefined,120000);
    docker(['exec',`cea-${c}-1`,'ctr','-n','k8s.io','images','import',`/tmp/${namespace}-image.tar`],undefined,120000);
    docker(['exec',`cea-${c}-1`,'rm',`/tmp/${namespace}-image.tar`]);
    create(c,[{apiVersion:'v1',kind:'Namespace',metadata:{name:namespace,labels:{experiment}}}]);
    if(c==='cloud')create(c,[{apiVersion:'v1',kind:'ConfigMap',metadata:{name:'reference',namespace},binaryData:{'reference.npz':readFileSync('.local/cea/hc01/full/reference.npz').toString('base64')}}]);
    const manifests=businessResources(c,endpoints);save('manifests-'+c+'.json',manifests);create(c,manifests);
  }
  docker(['exec','cea-cloud-1','mkdir',remote]);docker(['cp',path.join(folder,'fixtures'),`cea-cloud-1:${remote}/fixtures`],undefined,120000);
  docker(['cp',path.join(source,'load.js'),`cea-cloud-1:${remote}/load.js`]);
  docker(['cp',path.join(source,'metrics.mjs'),`cea-cloud-1:${remote}/metrics.mjs`]);
  for(const c of clusters)console.log(kube(c,['rollout','status','deployment/hydraulic','-n',namespace,'--timeout=30s']));
  save('deployed.json',Object.fromEntries(clusters.map(c=>[c,pod(c)])));save('cgroups-setup.json',podCgroups());console.log('SETUP_READY');
}
function assertIdle(){
  assert(!existsSync(path.join(folder,'failed.json')),'Earlier request/validation failure: preserve evidence and stop');
  assert(!existsSync(path.join(folder,'host-stop.json')),'Host capacity stop: no further experiments');
  assert(!get('cloud','pods',['-n',namespace,'-l','role=load']).items.length,'A load Pod still exists');
}
function verify(){
  assertIdle();const allocation=load('allocation.json'),label='verify-'+Date.now();
  const result=JSON.parse(copiedInput(label,path.join(folder,'fixtures'),'/fixtures',['verify','/fixtures',JSON.stringify(load('plan.json').endpoints)],'cea_default','512m'));
  save(label+'.json',{...result,allocation});assert.equal(result.status,'PASS');
  for(const c of clusters){
    assert.equal(result.stats[c].cpuMax,allocation[c].cpu*100000+' 100000');assert.equal(Number(result.stats[c].memoryMax),allocation[c].memoryMiB*2**20);assert.equal(result.stats[c].errors,0);
  }
  save(label+'-cgroups.json',podCgroups());save('correctness.json',{...result,allocation});console.log(JSON.stringify({status:result.status,cycles:result.cycles,arraysCompared:result.arraysCompared}));
}
export function assertBudget(allocation,cpuCores){
  assert.equal(Object.keys(allocation).length,5);for(const c of [...clusters,'load'])assert(allocation[c].cpu>0&&allocation[c].memoryMiB>0);
  assert(Object.values(allocation).reduce((n,a)=>n+a.cpu,0)<=cpuCores-1,'Experiment CPU quotas exceed WSL budget');
}
export function changedAllocation(before,target,cpu,memoryMiB,cpuCores,experimentName=experiment){
  assert(!['HC-16','HC-17','HC-18','HC-19'].includes(experimentName),experimentName+' freezes all resource quotas; configure is not allowed');
  assert([...clusters,'load'].includes(target),'Unknown allocation target');
  if(target==='load'){assert([5,6,7].includes(cpu));assert.equal(memoryMiB,5120);}
  else {assert([2,3,4].includes(cpu));assert(cpu>=before[target].cpu,'Business CPU cannot decrease in this exploration');assert(Number.isInteger(memoryMiB)&&memoryMiB>=before[target].memoryMiB);}
  const after={...before,[target]:{cpu,memoryMiB}};assertBudget(after,cpuCores);return after;
}
function configure(target,cpu,memoryMiB){
  assertIdle();const before=load('allocation.json'),after=changedAllocation(before,target,cpu,memoryMiB,load('capacity.json').cpuCores);
  assert.notDeepEqual(after,before,'No allocation change requested');
  const host=sampleHost(),extraMiB=Math.max(0,memoryMiB-before[target].memoryMiB);
  assert(extraMiB+512<=host.linux.MemAvailable/2**20,'Insufficient WSL memory headroom for increase');
  const evidence={at:new Date().toISOString(),target,before,after,host};const label='configure-'+Date.now();save(label+'.json',evidence);
  if(target!=='load'){
    assert.equal(get(target,'namespace',[namespace]).metadata.labels.experiment,experiment);
    const budget={cpu:String(cpu),memory:memoryMiB+'Mi'};
    kube(target,['patch','deployment','hydraulic','-n',namespace,'--type=strategic','-p',JSON.stringify({spec:{template:{spec:{containers:[{name:'app',resources:{requests:budget,limits:budget}}]}}}})]);
    console.log(kube(target,['rollout','status','deployment/hydraulic','-n',namespace,'--timeout=30s']));save(label+'-pod.json',pod(target));
  }
  save('allocation.json',after);console.log('ALLOCATION_CHANGED; run verify before next trial');
}
export function parseServiceStats(log,prefix=logPrefix){
  const stats={};
  assert(['HC14','HC15','HC16','HC17','HC18','HC19'].includes(prefix));
  for(const line of log.split('\n')){
    const match=line.match(/msg=("(?:[^"\\]|\\.)*") source=console/);if(!match)continue;
    const stat=JSON.parse(match[1]).match(new RegExp('^'+prefix+'_STATS (edge-[abc]|cloud) (\\{[\\s\\S]*\\})\\s*$'));if(stat)stats[stat[1]]=JSON.parse(stat[2]);
  }
  return stats;
}
const sampler=`while [ ! -f /output/exit ]; do printf '%s ' "$(date +%s)"; awk '/^usage_usec|^throttled_usec/ {printf "%s ",$2}' /sys/fs/cgroup/cpu.stat; tr '\\n' ' ' < /sys/fs/cgroup/memory.current; awk '/^inactive_file / {print $2}' /sys/fs/cgroup/memory.stat; sleep 1; done`;
export function loadPodSpec(label,duration,preVUs,maxVUs,endpoints,allocation){
  return {apiVersion:'v1',kind:'Pod',metadata:{name:'load-'+label,namespace,labels:{experiment,role:'load'}},spec:{restartPolicy:'Never',automountServiceAccountToken:false,
    volumes:[{name:'input',hostPath:{path:remote,type:'Directory'}},{name:'output',emptyDir:{}}],containers:[{name:'k6',image:'grafana/k6:1.3.0',imagePullPolicy:'Never',
      command:['sh','-c',`cat /sys/fs/cgroup/cpu.max > /output/cpu.max; cat /sys/fs/cgroup/memory.max > /output/memory.max; (${sampler}) > /output/resources.txt & k6 run /input/load.js > /output/k6.log 2>&1; echo $? > /output/exit; wait; sleep 3600`],
      env:[{name:'RUN',value:label},{name:'EXPERIMENT',value:experiment},{name:'RATE',value:String(rate)},{name:'DURATION',value:duration},{name:'PRE_ALLOCATED_VUS',value:String(preVUs)},{name:'MAX_VUS',value:String(maxVUs)},
        {name:'ENDPOINTS',value:JSON.stringify(endpoints)},{name:'GOMEMLIMIT',value:'4096MiB'},{name:'GOGC',value:'50'}],
      resources:{requests:{cpu:'1',memory:'512Mi'},limits:{cpu:String(allocation.load.cpu),memory:allocation.load.memoryMiB+'Mi'}},
      volumeMounts:[{name:'input',mountPath:'/input',readOnly:true},{name:'input',mountPath:'/fixtures',subPath:'fixtures',readOnly:true},{name:'output',mountPath:'/output'}]}]}};
}
export function validateProcessing(result,stats,manifest){
  assert.equal(Object.keys(stats).length,4,'Missing business stats');verifyAccounting(result,stats,manifest);
  assert(result.batches>0&&result.seconds>0);assert.equal(result.GBps,result.signalBytes/result.seconds/1e9);
  assert.equal(result.uploadStarted,result.started,'Not every started batch issued upload');assert.equal(result.initiatedSignalBytes,result.signalBytes,'Started/uploaded byte accounting mismatch');
  assert(Number.isInteger(result.droppedIterations)&&result.droppedIterations>=0);assert(Number.isInteger(result.lateUploadStarts)&&result.lateUploadStarts>=0);
  if(result.offeredLoadAchieved){
    assert.equal(result.droppedIterations,0);assert.equal(result.lateUploadStarts,0);
    const boundary=result.started-result.plannedBatches;assert(boundary>=0&&boundary<=arrivalBoundaryAllowance(result),'Unexpected arrival count outside known k6 boundary');
    assert(result.initiatedSignalBytes>=result.plannedSignalBytes,'Nominal byte load not initiated');
  }
}
async function trial(label,duration,preVUs=32,maxVUs=32){
  validateTrialParameters(label,duration,preVUs,maxVUs);assertIdle();
  if(experiment==='HC-19'){
    const index=hc19Sequence.findIndex(row=>row.label===label);
    for(const previous of hc19Sequence.slice(0,index))assert.equal(load(previous.label+'/validation.json').status,'PASS','Previous HC-19 trial must pass');
  }
  if(experiment==='HC-18'){
    const sequence=hc18Sequence(revision),index=sequence.findIndex(row=>row.label===label);
    for(const previous of sequence.slice(0,index))assert.equal(load(previous.label+'/validation.json').status,'PASS','Previous HC-18 trial must pass');
    if(label.startsWith('confirm-')){
      const baseline=JSON.parse(readFileSync(path.resolve('.local/cea/hc18-baseline-20261018/report.json'),'utf8')).rows.find(row=>row.run==='compare-60s');
      const candidate=load('report.json').rows.find(row=>row.run==='compare-60s');
      assertConfirmationGate(baseline,candidate,process.env.HC18_CONFIRM_APPROVED,'HC-18');
      if(label==='confirm-2')save('confirmation-review.json',{at:new Date().toISOString(),baselineGBps:baseline.GBps,candidateGBps:candidate.GBps,reviewApproved:true,reviewer:'experiment-runner'});
    }
  }
  if(experiment==='HC-16'){
    const index=hc16Sequence.findIndex(row=>row.label===label);
    for(const previous of hc16Sequence.slice(0,index))assert.equal(load(previous.label+'/validation.json').status,'PASS','Previous HC-16 trial must pass before continuing');
  }
  if(experiment==='HC-17'){
    const sequence=hc17Sequence(revision),index=sequence.findIndex(row=>row.label===label);
    for(const previous of sequence.slice(0,index))assert.equal(load(previous.label+'/validation.json').status,'PASS','Previous HC-17 trial must pass before continuing');
    if(label.startsWith('confirm-')){
      const baseline=JSON.parse(readFileSync(path.resolve('.local/cea/hc17-baseline-20261017/report.json'),'utf8')).rows.find(row=>row.run==='compare-30s');
      const candidate=load('report.json').rows.find(row=>row.run==='compare-30s');
      assertConfirmationGate(baseline,candidate,process.env.HC17_CONFIRM_APPROVED);
      if(label==='confirm-1')save('confirmation-review.json',{at:new Date().toISOString(),baselineGBps:baseline.GBps,candidateGBps:candidate.GBps,reviewApproved:true,reviewer:'experiment-runner'});
    }
  }
  const allocation=load('allocation.json');assertBudget(allocation,load('capacity.json').cpuCores);assert.deepEqual(load('correctness.json').allocation,allocation,'Reverify changed allocation first');
  if(['HC-16','HC-17','HC-18','HC-19'].includes(experiment))assert.deepEqual(allocation,initialAllocation,experiment+' resource quotas are frozen');
  const target=path.join(folder,label);assert(!existsSync(target),'Trial label exists; never overwrite');mkdirSync(target);
  const host=[sampleHost()];assert(allocation.load.memoryMiB+512<=host[0].linux.MemAvailable/2**20,'Insufficient available WSL RAM for k6 plus reserve');
  assert(!hostStopReasons(host,'capacity').length,'Critical host pressure');appendFileSync(path.join(target,'host.jsonl'),JSON.stringify(host[0])+'\n');write(target,'allocation.json',allocation);
  write(target,'cgroups-before.json',podCgroups());
  if(experiment!=='HC-14')write(target,'network-before.json',podNetwork());
  const name='load-'+label,spec=loadPodSpec(label,duration,preVUs,maxVUs,load('plan.json').endpoints,allocation);write(target,'pod.json',spec);
  const started=Date.now();let exit=null,stopped=false;create('cloud',[spec]);
  try{
    while(Date.now()-started<(parseInt(duration)+150)*1000){
      const p=get('cloud','pod',[name,'-n',namespace]);
      if(p.status.containerStatuses?.[0]?.state?.terminated){write(target,'pod-final.json',p);write(target,'container.log',kube('cloud',['logs',name,'-n',namespace]));throw Error('Load container terminated; original evidence retained');}
      if(p.status.phase==='Running'){
        const status=kube('cloud',['exec',name,'-n',namespace,'--','sh','-c','if [ -f /output/exit ]; then cat /output/exit; fi']);if(status){exit=Number(status);break;}
      }
      try{host.push(sampleHost(host.at(-1)));}
      catch(error){
        save('host-stop.json',{label,reasons:['Host monitor failed'],error:String(error)});
        if(p.status.phase==='Running')kube('cloud',['exec',name,'-n',namespace,'--','sh','-c','kill -INT $(pidof k6)']);
        else kube('cloud',['delete','pod',name,'-n',namespace,'--wait=false']);throw error;
      }
      appendFileSync(path.join(target,'host.jsonl'),JSON.stringify(host.at(-1))+'\n');const reasons=hostStopReasons(host,'capacity');
      if(reasons.length&&!stopped){
        stopped=true;save('host-stop.json',{label,reasons,sample:host.at(-1)});console.log('HOST_CAPACITY_STOP '+JSON.stringify(reasons));
        if(p.status.phase==='Running')kube('cloud',['exec',name,'-n',namespace,'--','sh','-c','kill -INT $(pidof k6)']);
        else {kube('cloud',['delete','pod',name,'-n',namespace,'--wait=false']);throw Error('Host capacity guard before k6 start');}
      }
      await pause(2000);
    }
    write(target,'pod-final.json',get('cloud','pod',[name,'-n',namespace]));assert.notEqual(exit,null,'Trial timeout; preserve Pod/evidence');
    host.push(sampleHost(host.at(-1)));appendFileSync(path.join(target,'host.jsonl'),JSON.stringify(host.at(-1))+'\n');
    const finalReasons=hostStopReasons(host,'capacity');if(finalReasons.length){stopped=true;save('host-stop.json',{label,reasons:finalReasons,sample:host.at(-1)});}
    for(const f of ['k6.log','resources.txt','exit','cpu.max','memory.max'])write(target,f,kube('cloud',['exec',name,'-n',namespace,'--','cat','/output/'+f]));
    try{write(target,'summary.json',kube('cloud',['exec',name,'-n',namespace,'--','cat','/output/summary.json']));}catch{}
    const log=readFileSync(path.join(target,'k6.log'),'utf8'),stats=parseServiceStats(log);write(target,'stats.json',stats);write(target,'host-summary.json',hostSummary(host,'capacity'));write(target,'cgroups-after.json',podCgroups());
    if(experiment!=='HC-14')write(target,'network-after.json',podNetwork());
    const limits={cpuMax:readFileSync(path.join(target,'cpu.max'),'utf8').trim(),memoryMax:Number(readFileSync(path.join(target,'memory.max'),'utf8'))};write(target,'actual-limits.json',limits);
    kube('cloud',['delete','pod',name,'-n',namespace,'--wait=false']);console.log(log.split('\n').filter(v=>v.includes(logPrefix+'_REPORT')||v.includes('level=error')).join('\n'));
    assert.equal(exit,0,'k6 failed; no retry');assert(!stopped,'Host capacity guard');assert.equal(limits.cpuMax,allocation.load.cpu*100000+' 100000');assert.equal(limits.memoryMax,allocation.load.memoryMiB*2**20);
    const result=JSON.parse(readFileSync(path.join(target,'summary.json'),'utf8')).report;validateProcessing(result,stats,load('manifest.json'));
    for(const c of clusters){assert.equal(stats[c].cpuMax,allocation[c].cpu*100000+' 100000');assert.equal(Number(stats[c].memoryMax),allocation[c].memoryMiB*2**20);}
    write(target,'validation.json',{status:'PASS',processingValid:true,offeredLoadAchieved:result.offeredLoadAchieved});console.log(JSON.stringify(result));
  }catch(error){
    save('failed.json',{label,error:String(error),at:new Date().toISOString()});write(target,'host-summary.json',hostSummary(host,'capacity'));
    if(experiment!=='HC-14'&&!existsSync(path.join(target,'network-after.json'))){
      try{write(target,'network-after.json',podNetwork());}catch(captureError){write(target,'network-after-error.json',{error:String(captureError)});}
    }
    throw error;
  }
}
export function businessSummary(stats,allocation,before,after){
  return Object.fromEntries(Object.entries(stats).map(([c,s])=>{
    const resources=s.samples?.length>1?resourceSummary(s.samples):{};
    const memoryBytes=(s.samples||[]).map(v=>v.memoryBytes).filter(Number.isFinite);
    const eventsDelta=before?.[c]&&after?.[c]?Object.fromEntries(Object.entries(after[c].memoryEvents).map(([key,v])=>[key,v-before[c].memoryEvents[key]])):null;
    return [c,{...resources,stages:s.stages,peakMemoryCurrentMiB:memoryBytes.length?Math.max(...memoryBytes)/2**20:null,
      meanCpuQuotaPercent:resources.meanCores===undefined?null:resources.meanCores/allocation[c].cpu*100,memoryEventsDelta:eventsDelta,
      samePod:before?.[c]&&after?.[c]?before[c].uid===after[c].uid:null}];
  }));
}
function report(){
  const rows=[];
  for(const d of readdirSync(folder,{withFileTypes:true}).filter(v=>v.isDirectory()&&existsSync(path.join(folder,v.name,'summary.json')))){
    const target=path.join(folder,d.name),summary=JSON.parse(readFileSync(path.join(target,'summary.json'),'utf8')),row={...summary.report};
    row.exitCode=existsSync(path.join(target,'exit'))?Number(readFileSync(path.join(target,'exit'),'utf8')):null;row.processingValid=row.exitCode===0&&existsSync(path.join(target,'validation.json'));
    row.valid=row.processingValid;const stats=JSON.parse(readFileSync(path.join(target,'stats.json'),'utf8'));
    if(row.processingValid)validateProcessing(row,stats,load('manifest.json'));else row.exclusion='Request/validation/infrastructure failure: partial throughput is diagnostic only';
    row.allocation=JSON.parse(readFileSync(path.join(target,'allocation.json'),'utf8'));row.host=JSON.parse(readFileSync(path.join(target,'host-summary.json'),'utf8'));
    const cgroupFile=name=>existsSync(path.join(target,name))?JSON.parse(readFileSync(path.join(target,name),'utf8')):null;
    row.business=businessSummary(stats,row.allocation,cgroupFile('cgroups-before.json'),cgroupFile('cgroups-after.json'));
    if(experiment!=='HC-14')row.network=networkDelta(cgroupFile('network-before.json'),cgroupFile('network-after.json'));
    if(existsSync(path.join(target,'resources.txt'))){
      const samples=readFileSync(path.join(target,'resources.txt'),'utf8').trim().split('\n').map(l=>l.trim().split(/\s+/).map(Number)).filter(v=>v.length===5);
      const convert=s=>({at:s[0],cpuUsec:s[1],throttledUsec:s[2],workingSetBytes:s[3]-s[4]});if(samples.length>1)row.generator=resourceSummary(samples.map(convert));
    }
    rows.push(row);
  }
  const confirmed=rows.filter(r=>r.run.startsWith('confirm-')&&r.processingValid);
  if(experiment==='HC-19'){
    const measured=rows.filter(r=>r.run.startsWith('measure-')&&r.durationSeconds===60&&r.processingValid);
    const result={rows,revision,measurementRuns:measured.map(r=>r.run),measuredMeanGBps:measured.length===3?measured.reduce((n,r)=>n+r.GBps,0)/3:null,
      allThreeAbove2_5GBps:measured.length===3&&measured.every(r=>r.GBps>=2.5),allThreeOfferedLoadAchieved:measured.length===3&&measured.every(r=>r.offeredLoadAchieved),
      scope:'HC19 candidate only: cloud fusion no longer serialized; raw signal bytes / full HTTP chain; no new baseline; historical difference is not controlled gain; drops are not accepted load'};
    save('report.json',result);console.log(JSON.stringify(result,null,2));return;
  }
  if(experiment==='HC-18'){
    const longRuns=rows.filter(r=>r.durationSeconds===60&&r.processingValid);
    const result={rows,revision,comparisonRun:'compare-60s',confirmedMeanGBps:longRuns.length===3?longRuns.reduce((n,r)=>n+r.GBps,0)/3:null,
      allThreeAbove2_5GBps:longRuns.length===3&&longRuns.every(r=>r.GBps>=2.5),allThreeOfferedLoadAchieved:longRuns.length===3&&longRuns.every(r=>r.offeredLoadAchieved),
      scope:'HC18 center lock-scope-only comparison; complete original signal bytes / full HTTP chain; baseline and return 60s, candidate up to three 60s runs; drops are not sustained offered load'};
    save('report.json',result);console.log(JSON.stringify(result,null,2));return;
  }
  const result=experiment==='HC-17'?{rows,revision,shortComparisonRun:'compare-30s',
    confirmationRuns:rows.filter(r=>r.run.startsWith('confirm-')).map(r=>r.run),confirmedMeanGBps:confirmed.length===3?confirmed.reduce((n,r)=>n+r.GBps,0)/3:null,
    allThreeAbove2GBps:confirmed.length===3&&confirmed.every(r=>r.GBps>=2),allThreeOfferedLoadAchieved:confirmed.length===3&&confirmed.every(r=>r.offeredLoadAchieved),
    scope:'HC-17 isolated '+revision+' phase; short comparison separate from optional views confirmations; original signal bytes once through complete hydraulic HTTP chain; nominal 3GB/s is not accepted load'}:experiment==='HC-16'?{rows,comparisonRuns:['baseline-32','candidate-48','return-32'],
    scope:'Same complete hydraulic chain and quotas: 32/48/32 VU short comparison; warmup/probe excluded, dropped arrivals disclosed; not a three-run stability confirmation'}:{rows,confirmedMeanGBps:confirmed.length?confirmed.reduce((n,r)=>n+r.GBps,0)/confirmed.length:null,
    allThreeAbove2GBps:confirmed.length===3&&confirmed.every(r=>r.GBps>=2),allThreeOfferedLoadAchieved:confirmed.length===3&&confirmed.every(r=>r.offeredLoadAchieved),
    scope:'Complete original hydraulic HTTP processing chain; dropped arrivals must not be described as sustained 3GB/s input'};save('report.json',result);console.log(JSON.stringify(result,null,2));
}
function capture(label){
  assert(/^[a-z0-9-]+$/.test(label));const target=path.join(folder,label);assert(existsSync(target));assert(!existsSync(path.join(target,'k8s-state.json')),'Already captured');
  write(target,'k8s-state.json',Object.fromEntries(clusters.map(c=>[c,get(c,'pods,events,endpointslices',['-n',namespace])])));
  for(const c of clusters)write(target,c+'.log',kube(c,['logs','deployment/hydraulic','-n',namespace,'--timestamps']));
  if(experiment!=='HC-14')write(target,'network-capture.json',podNetwork());
}
function cleanup(){
  save('host-after-load.json',sampleHost());
  for(const c of clusters){
    assert.equal(get(c,'namespace',[namespace]).metadata.labels.experiment,experiment);const current=get(c,'pods',['-n',namespace]);save('final-'+c+'.json',current);
    for(const p of current.items)if(p.status.phase!=='Pending')write(folder,`final-${c}-${p.metadata.name}.log`,kube(c,['logs',p.metadata.name,'-n',namespace]));
    kube(c,['delete','namespace',namespace,'--wait=false']);
  }
  console.log('Exact test namespaces deletion requested; audit after termination');
}
export function auditContainers(before,after,experimentName=experiment,runRevision=revision){
  // This already-finished HC-15 diagnostic unit-test container happened to be
  // included in the concurrent setup snapshot. Preserve that original snapshot;
  // allow only its exact identity, never a name prefix or other old container.
  const excludedBatchContainers=experimentName==='HC-15'&&runRevision==='diagnostic'?before.filter(c=>
    c.name==='/cea-hc15-service-unit-20261017'&&c.id==='388aa4d3a57c2fb9898e79b7a432de42bbf18f143f4620e37f1f68defee4df1d'):[];
  const expected=before.filter(c=>!excludedBatchContainers.includes(c));
  assert.deepEqual(after,expected,'Old containers changed or unit-test container still remains');
  return {oldContainers:expected.length,beforeContainers:before.length,excludedBatchContainers};
}
function audit(){
  for(const c of clusters)assert(!get(c,'namespaces').items.some(v=>v.metadata.name===namespace),'Namespace still exists');
  const before=load('before.json'),after=snapshot();save('after.json',after);save('host-after-cleanup.json',sampleHost());
  const containerAudit=auditContainers(before.containers,after.containers);
  for(const key of ['objects','warm','harborLog'])assert.deepEqual(after[key],before[key],'Old '+key+' changed');
  save('audit.json',{status:'PASS',...containerAudit,oldObjects:Object.values(before.objects).reduce((n,a)=>n+a.length,0),oldWarmObjects:before.warm.length,newPodsRemaining:0});
  assert.equal(path.dirname(folder),path.resolve('.local/cea'));assert.equal(path.basename(folder),batch);
  if(existsSync(path.join(folder,'image.tar')))rmSync(path.join(folder,'image.tar'));if(existsSync(path.join(folder,'fixtures')))rmSync(path.join(folder,'fixtures'),{recursive:true});
  assert.equal(docker(['exec','cea-cloud-1','readlink','-f',remote]),remote);docker(['exec','cea-cloud-1','rm','-r','--',remote]);
  console.log('AUDIT_PASS; only derived fixtures and image export removed');
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const command=process.argv[2];
  if(command==='setup')await setup();else if(command==='verify')verify();
  else if(command==='configure')configure(process.argv[3],Number(process.argv[4]),Number(process.argv[5]));
  else if(command==='trial')await trial(process.argv[3],process.argv[4],Number(process.argv[5]||32),Number(process.argv[6]||32));
  else if(command==='report')report();else if(command==='capture')capture(process.argv[3]);else if(command==='cleanup')cleanup();else if(command==='audit')audit();
  else throw Error('Use setup|verify|configure target cpu memoryMiB|trial label duration [preVUs=32] [maxVUs=32]|report|capture label|cleanup|audit');
}
