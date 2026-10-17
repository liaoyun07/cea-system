import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync,rmSync,readdirSync,appendFileSync,copyFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {prepareManifest} from './integrity.mjs';
import {resourceSummary} from '../metrics.mjs';
import {sampleHost,hostStopReasons,hostSummary} from '../host-monitor.mjs';

const experiment='HC-13',batch='hc13-20261017',namespace='cea-'+batch,nodePort=31093;
const image='cea/hc-generator-receiver:hc13-v1',fixtureImage='cea/hydraulic-resident:hc05-v1';
const folder=path.resolve('.local/cea/'+batch),remote='/tmp/'+namespace;
const source='examples/hydraulic-cloud-edge/resident/generator';
const groups=['edge-a','edge-b','edge-c'],clusters=[...groups,'cloud'];
const docker=(args,input,timeout=30000)=>execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,timeout,maxBuffer:64*1024*1024}).trim();
const kube=(cluster,args,input)=>docker(['exec','-i',`cea-${cluster}-1`,'kubectl',...args],input);
const get=(cluster,resource,args=[])=>JSON.parse(kube(cluster,['get',resource,...args,'-o','json']));
const save=(name,value)=>writeFileSync(path.join(folder,name),JSON.stringify(value,null,2));
const load=name=>JSON.parse(readFileSync(path.join(folder,name),'utf8'));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const create=(cluster,items)=>kube(cluster,['create','-f','-'],JSON.stringify({apiVersion:'v1',kind:'List',items}));
const receiverPod=cluster=>get(cluster,'pods',['-n',namespace,'-l','app=receiver']).items[0];

function snapshot(){
  const ids=docker(['ps','-aq','--filter','name=cea-']).split(/\s+/);
  const containers=JSON.parse(docker(['inspect',...ids])).map(c=>({id:c.Id,name:c.Name,image:c.Image,
    started:c.State.StartedAt,running:c.State.Running,memory:c.HostConfig.Memory,memorySwap:c.HostConfig.MemorySwap,nanoCpus:c.HostConfig.NanoCpus}));
  const objects=Object.fromEntries(clusters.map(c=>[c,get(c,'deployments,services,hpa',['-A']).items
    .filter(v=>v.metadata.namespace!==namespace).map(v=>({kind:v.kind,name:v.metadata.namespace+'/'+v.metadata.name,uid:v.metadata.uid,spec:v.spec}))]));
  const active=Object.fromEntries(clusters.map(c=>[c,get(c,'jobs',['-A','--field-selector=status.successful=0']).items.filter(v=>v.status.active>0).map(v=>v.metadata.name)]));
  const oldWarm=get('cloud','sandboxes,sandboxclaims,sandboxwarmpools,sandboxtemplates,warmservices',['-n','cea-hpa-warm-20261016']).items;
  const sandboxes=oldWarm.filter(v=>v.kind==='Sandbox');
  assert.equal(sandboxes.length,3);assert(sandboxes.every(v=>v.spec.operatingMode==='Suspended'),'Old sandbox no longer paused');
  const warm=oldWarm.map(v=>({name:v.kind+'/'+v.metadata.name,uid:v.metadata.uid,spec:v.spec})).sort((a,b)=>a.name.localeCompare(b.name));
  const log=JSON.parse(docker(['inspect','harbor-log']))[0];assert.equal(log.State.Running,false,'Old Harbor log no longer stopped');
  const harborLog={id:log.Id,running:log.State.Running,started:log.State.StartedAt};
  return {containers,objects,warm,harborLog,active};
}
function receiverResources(){
  const budget={cpu:'2',memory:'512Mi'};
  return [
    {apiVersion:'v1',kind:'Service',metadata:{name:'receiver',namespace},spec:{type:'NodePort',selector:{app:'receiver'},ports:[{port:8080,targetPort:8080,nodePort}]}},
    {apiVersion:'apps/v1',kind:'Deployment',metadata:{name:'receiver',namespace},spec:{replicas:1,selector:{matchLabels:{app:'receiver'}},template:{metadata:{labels:{app:'receiver'}},spec:{automountServiceAccountToken:false,containers:[{
      name:'receiver',image,imagePullPolicy:'Never',ports:[{containerPort:8080}],env:[{name:'GOMAXPROCS',value:'2'}],resources:{requests:budget,limits:budget},
      readinessProbe:{httpGet:{path:'/health',port:8080},initialDelaySeconds:1,periodSeconds:2}
    }]}}}}
  ];
}
function prepareFixtures(){
  const name=namespace+'-prepare',input=path.resolve('.local/cea/hc01/full');
  assert(existsSync(path.join(input,'reference.npz')),'Original fixtures absent');
  const id=docker(['create','--name',name,'--network','none','--cpus','1','--memory','1g',fixtureImage,'python','/app/fixtures.py','prepare','/source','/fixtures']);
  save('prepare-container.json',{id,name});
  docker(['cp',input,id+':/source'],undefined,120000);
  let log;
  try{log=docker(['start','--attach',id],undefined,180000);}
  catch(error){
    writeFileSync(path.join(folder,'prepare-failure.log'),String(error.stdout||'')+'\n'+String(error.stderr||error));
    save('prepare-final.json',JSON.parse(docker(['inspect',id]))[0].State);throw error;
  }
  writeFileSync(path.join(folder,'prepare.log'),log);
  const final=JSON.parse(docker(['inspect',id]))[0];save('prepare-final.json',final.State);
  assert.equal(final.State.ExitCode,0,'Preparation failed; keep evidence/container');
  docker(['cp',id+':/fixtures',path.join(folder,'fixtures')],undefined,120000);
  assert.equal(final.Name,'/'+name);docker(['rm',id]);
  return prepareManifest(path.join(folder,'fixtures'));
}
async function setup(){
  assert(!existsSync(path.join(folder,'plan.json')),'Existing batch; do not overwrite');mkdirSync(folder,{recursive:true});
  const before=snapshot();save('before.json',before);
  assert(clusters.every(c=>before.active[c].length===0),'Active jobs: postpone experiment');
  const host=sampleHost(),cpuCores=Number(docker(['exec','cea-cloud-1','nproc']));
  assert(13<=cpuCores-1,'Experiment CPU quotas exceed WSL budget');
  assert(host.linux.MemAvailable>=5632*2**20,'Insufficient available WSL RAM');
  save('capacity.json',{cpuCores,memoryBytes:host.linux.MemTotal,background:host});
  const endpoints={};
  for(const c of clusters){
    assert(!get(c,'namespaces').items.some(v=>v.metadata.name===namespace),'Namespace exists');
    assert(!get(c,'services',['-A']).items.some(v=>v.spec.ports?.some(p=>p.nodePort===nodePort)),'NodePort occupied');
    if(c!=='cloud')endpoints[c]='http://'+JSON.parse(docker(['inspect',`cea-${c}-1`]))[0].NetworkSettings.Networks.cea_default.IPAddress+':'+nodePort;
  }
  save('plan.json',{experiment,namespace,image,endpoints,nodePort,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    imageId:docker(['image','inspect',image,'--format','{{.Id}}']),allocation:{receiverCpu:2,receiverMemoryMiB:512,loadCpu:7,loadMemoryMiB:5120,goMemoryMiB:4096},
    scope:'transport-only: real NPZ uploads and CRC32C acknowledgements; no hydraulic compute, no result persistence; raw signal bytes counted once / first send to last confirmation',
    protocol:{baseline:{mode:'legacy',vus:12,seconds:30},candidate:{mode:'reuse',vus:12,seconds:30},sweepVus:[24,32,48],sweepSeconds:30,confirmSeconds:60,confirmRepetitions:3,
      freeze:'same HC-01 inputs, 35 batches, 64 cycles, HTTP route, 7-core/5GiB k6 and three 2-core/512MiB receivers; no old-service, business-image or WSL change',
      selection:'review each tier; more concurrency only if useful; stop after request/accounting/capacity failure; healthy best tier gets three 60-second confirmations; do not overwrite/retry failures'}});
  const archiveFolder=path.join(folder,'protocol');mkdirSync(archiveFolder);
  for(const f of ['run.mjs','load.js','integrity.mjs','receiver.go','Dockerfile'])copyFileSync(path.join(source,f),path.join(archiveFolder,f));
  for(const f of ['host-monitor.mjs','metrics.mjs'])copyFileSync(path.join(source,'..',f),path.join(archiveFolder,f));
  save('manifest.json',prepareFixtures());
  const archive=path.join(folder,'image.tar');docker(['image','save','-o',archive,image],undefined,120000);
  for(const c of clusters){
    if(c!=='cloud'){
      docker(['cp',archive,`cea-${c}-1:/tmp/${namespace}-image.tar`],undefined,120000);
      docker(['exec',`cea-${c}-1`,'ctr','-n','k8s.io','images','import',`/tmp/${namespace}-image.tar`],undefined,120000);
      docker(['exec',`cea-${c}-1`,'rm',`/tmp/${namespace}-image.tar`]);
    }
    create(c,[{apiVersion:'v1',kind:'Namespace',metadata:{name:namespace,labels:{experiment}}}]);
    if(c!=='cloud'){const manifests=receiverResources();save('manifests-'+c+'.json',manifests);create(c,manifests);}
  }
  docker(['exec','cea-cloud-1','mkdir',remote]);
  docker(['cp',path.join(folder,'fixtures'),`cea-cloud-1:${remote}/fixtures`],undefined,120000);
  docker(['cp',path.join(source,'load.js'),`cea-cloud-1:${remote}/load.js`]);
  for(const c of groups)console.log(kube(c,['rollout','status','deployment/receiver','-n',namespace,'--timeout=30s']));
  save('deployed.json',Object.fromEntries(groups.map(c=>[c,receiverPod(c)])));
  save('receiver-limits.json',sampleReceivers(endpoints));
  console.log('SETUP_READY');
}

function sampleReceivers(endpoints){
  return Object.fromEntries(groups.map(g=>{
    const sample=JSON.parse(docker(['exec','cea-cloud-1','wget','-qO-','-T','5',endpoints[g]+'/resources']));
    assert.equal(sample.cpuMax,'200000 100000',g+' actual CPU quota mismatch');
    assert.equal(Number(sample.memoryMax),512*2**20,g+' actual RAM cap mismatch');
    return [g,sample];
  }));
}

export function verifyAccounting(result,stats,manifest){
  assert.equal(result.failed,0);assert.equal(result.started,result.batches);assert(result.batches>0);assert(result.seconds>0);
  const sumCycle=select=>Math.floor(result.batches/manifest.length)*manifest.reduce((n,m)=>n+select(m),0)+manifest.slice(0,result.batches%manifest.length).reduce((n,m)=>n+select(m),0);
  assert.equal(result.signalBytes,sumCycle(m=>m.expected.inputBytes),'Raw signal accounting mismatch');
  assert.equal(result.payloadBytes,sumCycle(m=>m.files.reduce((n,f)=>n+f.length,0)),'NPZ payload accounting mismatch');
  assert.equal(result.GBps,result.signalBytes/result.seconds/1e9,'Rate formula mismatch');
  assert.equal(Object.keys(stats).length,3,'Incomplete receiver evidence');
  groups.forEach((g,i)=>{
    assert.equal(stats[g].requests,result.batches,g+' request count mismatch');
    assert.equal(stats[g].bytes,sumCycle(m=>m.files[i].length),g+' received bytes mismatch');
    assert.equal(stats[g].failed,0,g+' has failures');assert.equal(stats[g].inflight,0,g+' still has uploads');
  });
  assert.equal(groups.reduce((n,g)=>n+stats[g].bytes,0),result.payloadBytes,'Sender/receivers byte totals differ');
}
export function parseReceiverStats(log){
  const stats={};
  for(const line of log.split('\n')){
    const match=line.match(/msg=("(?:[^"\\]|\\.)*") source=console/);
    if(!match)continue;
    const message=JSON.parse(match[1]),stat=message.match(/^HC13_STATS (edge-[abc]) (\{[\s\S]*\})\s*$/);
    if(stat)stats[stat[1]]=JSON.parse(stat[2]);
  }
  return stats;
}
const sampler=`while [ ! -f /output/exit ]; do printf '%s ' "$(date +%s)"; awk '/^usage_usec|^throttled_usec/ {printf "%s ",$2}' /sys/fs/cgroup/cpu.stat; tr '\\n' ' ' < /sys/fs/cgroup/memory.current; awk '/^inactive_file / {print $2}' /sys/fs/cgroup/memory.stat; sleep 1; done`;
export function loadPodSpec(label,mode,vus,duration,endpoints){
  return {apiVersion:'v1',kind:'Pod',metadata:{name:'load-'+label,namespace,labels:{experiment,role:'load'}},spec:{restartPolicy:'Never',automountServiceAccountToken:false,
    volumes:[{name:'input',hostPath:{path:remote,type:'Directory'}},{name:'output',emptyDir:{}}],containers:[{name:'k6',image:'grafana/k6:1.3.0',imagePullPolicy:'Never',
      command:['sh','-c',`cat /sys/fs/cgroup/cpu.max > /output/cpu.max; cat /sys/fs/cgroup/memory.max > /output/memory.max; (${sampler}) > /output/resources.txt & k6 run /input/load.js > /output/k6.log 2>&1; echo $? > /output/exit; wait; sleep 3600`],
      env:[{name:'RUN',value:label},{name:'MODE',value:mode},{name:'VUS',value:String(vus)},{name:'DURATION',value:duration},{name:'ENDPOINTS',value:JSON.stringify(endpoints)},
        {name:'GOMEMLIMIT',value:'4096MiB'},{name:'GOGC',value:'50'}],resources:{requests:{cpu:'1',memory:'512Mi'},limits:{cpu:'7',memory:'5120Mi'}},
      volumeMounts:[{name:'input',mountPath:'/input',readOnly:true},{name:'input',mountPath:'/fixtures',subPath:'fixtures',readOnly:true},{name:'output',mountPath:'/output'}]}]}};
}
function capture(label){
  assert(/^[a-z0-9-]+$/.test(label));const target=path.join(folder,label);assert(existsSync(target));
  assert(!existsSync(path.join(target,'k8s-state.json')),'Already captured');
  writeFileSync(path.join(target,'k8s-state.json'),JSON.stringify(Object.fromEntries(clusters.map(c=>[c,get(c,'pods,events,endpointslices',['-n',namespace])])),null,2));
  for(const c of groups)writeFileSync(path.join(target,c+'.log'),kube(c,['logs','deployment/receiver','-n',namespace,'--timestamps']));
}
async function trial(label,mode,vus,duration){
  assert(/^[a-z0-9-]+$/.test(label));assert(['legacy','reuse'].includes(mode));assert([12,24,32,48].includes(vus));assert(/^\d+s$/.test(duration));
  assert(!existsSync(path.join(folder,'failed.json')),'Previous trial failed; stop, retain evidence and discuss');
  assert(!existsSync(path.join(folder,'host-stop.json')),'Host capacity failure: no further trials');
  assert(!get('cloud','pods',['-n',namespace,'-l','role=load']).items.length,'Previous load Pod still exists');
  const target=path.join(folder,label);assert(!existsSync(target),'Trial label already exists; do not overwrite');mkdirSync(target);
  const host=[sampleHost()],capacity=load('capacity.json');assert(13<=capacity.cpuCores-1);
  assert(host[0].linux.MemAvailable>=5632*2**20,'Insufficient WSL available RAM for 5GiB k6 and reserve');
  const reasons=hostStopReasons(host,'capacity');assert(!reasons.length,'Critical host pressure before start');
  appendFileSync(path.join(target,'host.jsonl'),JSON.stringify(host[0])+'\n');
  const endpoints=load('plan.json').endpoints;
  const name='load-'+label,spec=loadPodSpec(label,mode,vus,duration,endpoints),receiverSamples=[sampleReceivers(endpoints)];
  appendFileSync(path.join(target,'receiver-resources.jsonl'),JSON.stringify(receiverSamples[0])+'\n');
  writeFileSync(path.join(target,'pod.json'),JSON.stringify(spec,null,2));
  const started=Date.now();let exit=null,stopped=false;
  create('cloud',[spec]);
  try{
    while(Date.now()-started<(parseInt(duration)+150)*1000){
      const p=get('cloud','pod',[name,'-n',namespace]);
      if(p.status.containerStatuses?.[0]?.state?.terminated){
        writeFileSync(path.join(target,'pod-final.json'),JSON.stringify(p,null,2));
        writeFileSync(path.join(target,'container.log'),kube('cloud',['logs',name,'-n',namespace]));
        throw Error('Load container terminated; preserve its evidence before cleanup');
      }
      if(p.status.phase==='Running'){
        const status=kube('cloud',['exec',name,'-n',namespace,'--','sh','-c','if [ -f /output/exit ]; then cat /output/exit; fi']);
        if(status){exit=Number(status);break;}
      }
      try{
        host.push(sampleHost(host.at(-1)));
        receiverSamples.push(sampleReceivers(endpoints));
        appendFileSync(path.join(target,'receiver-resources.jsonl'),JSON.stringify(receiverSamples.at(-1))+'\n');
      }
      catch(error){
        save('host-stop.json',{label,reasons:['Host monitoring failed; no further escalation'],error:String(error)});
        if(p.status.phase==='Running')kube('cloud',['exec',name,'-n',namespace,'--','sh','-c','kill -INT $(pidof k6)']);
        else kube('cloud',['delete','pod',name,'-n',namespace,'--wait=false']);
        throw error;
      }
      appendFileSync(path.join(target,'host.jsonl'),JSON.stringify(host.at(-1))+'\n');
      const reasons=hostStopReasons(host,'capacity');
      if(reasons.length&&!stopped){
        stopped=true;save('host-stop.json',{label,reasons,sample:host.at(-1)});console.log('HOST_CAPACITY_STOP '+JSON.stringify(reasons));
        if(p.status.phase==='Running')kube('cloud',['exec',name,'-n',namespace,'--','sh','-c','kill -INT $(pidof k6)']);
        else {kube('cloud',['delete','pod',name,'-n',namespace,'--wait=false']);throw Error('Host capacity guard before k6 started');}
      }
      await pause(2000);
    }
    writeFileSync(path.join(target,'pod-final.json'),JSON.stringify(get('cloud','pod',[name,'-n',namespace]),null,2));
    assert.notEqual(exit,null,'Trial timed out; keep original load Pod/evidence');
    host.push(sampleHost(host.at(-1)));
    appendFileSync(path.join(target,'host.jsonl'),JSON.stringify(host.at(-1))+'\n');
    const finalReasons=hostStopReasons(host,'capacity');
    if(finalReasons.length){stopped=true;save('host-stop.json',{label,reasons:finalReasons,sample:host.at(-1)});}
    receiverSamples.push(sampleReceivers(endpoints));
    appendFileSync(path.join(target,'receiver-resources.jsonl'),JSON.stringify(receiverSamples.at(-1))+'\n');
    for(const file of ['k6.log','resources.txt','exit','cpu.max','memory.max'])writeFileSync(path.join(target,file),kube('cloud',['exec',name,'-n',namespace,'--','cat','/output/'+file]));
    try{writeFileSync(path.join(target,'summary.json'),kube('cloud',['exec',name,'-n',namespace,'--','cat','/output/summary.json']));}catch{}
    const log=readFileSync(path.join(target,'k6.log'),'utf8'),stats=parseReceiverStats(log);
    writeFileSync(path.join(target,'stats.json'),JSON.stringify(stats,null,2));
    writeFileSync(path.join(target,'host-summary.json'),JSON.stringify(hostSummary(host,'capacity'),null,2));
    const limits={cpuMax:readFileSync(path.join(target,'cpu.max'),'utf8').trim(),memoryMax:Number(readFileSync(path.join(target,'memory.max'),'utf8'))};
    writeFileSync(path.join(target,'actual-limits.json'),JSON.stringify(limits,null,2));
    kube('cloud',['delete','pod',name,'-n',namespace,'--wait=false']);
    console.log(log.split('\n').filter(v=>v.includes('HC13_REPORT')||v.includes('level=error')).join('\n'));
    assert.equal(exit,0,'k6 failed; preserve trial and do not retry');assert(!stopped,'Host capacity stop');
    assert.equal(limits.cpuMax,'700000 100000');assert.equal(limits.memoryMax,5120*2**20);
    const result=JSON.parse(readFileSync(path.join(target,'summary.json'),'utf8')).report;
    verifyAccounting(result,stats,load('manifest.json'));
    writeFileSync(path.join(target,'validation.json'),JSON.stringify({status:'PASS',limits,receiverCount:3}));
    console.log(JSON.stringify(result));
  }catch(error){
    save('failed.json',{label,error:String(error),at:new Date().toISOString()});
    writeFileSync(path.join(target,'host-summary.json'),JSON.stringify(hostSummary(host,'capacity'),null,2));
    throw error;
  }
}
function report(){
  const rows=[];
  for(const d of readdirSync(folder,{withFileTypes:true}).filter(d=>d.isDirectory()&&existsSync(path.join(folder,d.name,'summary.json')))){
    const target=path.join(folder,d.name),summary=JSON.parse(readFileSync(path.join(target,'summary.json'),'utf8')),row={...summary.report};
    row.exitCode=existsSync(path.join(target,'exit'))?Number(readFileSync(path.join(target,'exit'),'utf8')):null;
    row.valid=row.exitCode===0&&existsSync(path.join(target,'validation.json'));
    if(!row.valid)row.exclusion='Failed/incomplete trial; partial throughput is diagnostic only';
    else verifyAccounting(row,JSON.parse(readFileSync(path.join(target,'stats.json'),'utf8')),load('manifest.json'));
    row.host=JSON.parse(readFileSync(path.join(target,'host-summary.json'),'utf8'));
    const receiverSamples=readFileSync(path.join(target,'receiver-resources.jsonl'),'utf8').trim().split('\n').map(v=>JSON.parse(v));
    row.receivers=Object.fromEntries(groups.map(g=>[g,receiverSamples.length>1?resourceSummary(receiverSamples.map(s=>s[g])):null]));
    if(existsSync(path.join(target,'resources.txt'))){
      const samples=readFileSync(path.join(target,'resources.txt'),'utf8').trim().split('\n').map(l=>l.trim().split(/\s+/).map(Number)).filter(v=>v.length===5);
      const convert=s=>({at:s[0],cpuUsec:s[1],throttledUsec:s[2],workingSetBytes:s[3]-s[4]});
      if(samples.length>1)row.generator=resourceSummary(samples.map(convert));
      const start=summary.k6.metrics.first_send_ms.values.min/1000,end=summary.k6.metrics.finished_ms.values.max/1000;
      const active=samples.filter(v=>v[0]>=start&&v[0]<=end);
      if(active.length>1)row.generator.measuredActiveWindow=resourceSummary(active.map(convert));
    }
    rows.push(row);
  }
  const confirms=rows.filter(r=>r.run.startsWith('confirm-')&&r.valid);
  const result={rows,confirmedMeanGBps:confirms.length?confirms.reduce((n,r)=>n+r.GBps,0)/confirms.length:null,
    allThreeAbove2GBps:confirms.length===3&&confirms.every(r=>r.GBps>=2),scope:'Transport and integrity acknowledgements only, not hydraulic processing throughput'};
  save('report.json',result);console.log(JSON.stringify(result,null,2));
}
function cleanup(){
  save('host-after-load.json',sampleHost());
  for(const c of clusters){
    const ns=get(c,'namespace',[namespace]);assert.equal(ns.metadata.labels.experiment,experiment);
    const current=get(c,'pods',['-n',namespace]);save('final-'+c+'.json',current);
    for(const p of current.items)if(p.status.phase!=='Pending')writeFileSync(path.join(folder,`final-${c}-${p.metadata.name}.log`),kube(c,['logs',p.metadata.name,'-n',namespace]));
    kube(c,['delete','namespace',namespace,'--wait=false']);
  }
  console.log('Dedicated namespaces deletion requested; audit after termination.');
}
function audit(){
  for(const c of clusters)assert(!get(c,'namespaces').items.some(v=>v.metadata.name===namespace),'Namespace still exists');
  const before=load('before.json'),after=snapshot();save('after.json',after);save('host-after-cleanup.json',sampleHost());
  for(const key of ['containers','objects','warm','harborLog'])assert.deepEqual(after[key],before[key],'Old '+key+' changed');
  save('audit.json',{status:'PASS',oldContainers:before.containers.length,oldObjects:Object.values(before.objects).reduce((n,a)=>n+a.length,0),oldWarmObjects:before.warm.length,newPodsRemaining:0});
  assert.equal(path.dirname(folder),path.resolve('.local/cea'));assert.equal(path.basename(folder),batch);
  if(existsSync(path.join(folder,'image.tar')))rmSync(path.join(folder,'image.tar'));
  if(existsSync(path.join(folder,'fixtures')))rmSync(path.join(folder,'fixtures'),{recursive:true});
  const resolved=docker(['exec','cea-cloud-1','readlink','-f',remote]);assert.equal(resolved,remote);
  docker(['exec','cea-cloud-1','rm','-r','--',remote]);
  console.log('AUDIT_PASS; only generated fixtures and image export removed, source dataset and evidence retained.');
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const command=process.argv[2];
  if(command==='setup')await setup();
  else if(command==='trial')await trial(process.argv[3],process.argv[4],Number(process.argv[5]),process.argv[6]);
  else if(command==='report')report();
  else if(command==='capture')capture(process.argv[3]);
  else if(command==='cleanup')cleanup();
  else if(command==='audit')audit();
  else throw Error('Use setup|trial label legacy/reuse vus duration|report|capture label|cleanup|audit');
}
