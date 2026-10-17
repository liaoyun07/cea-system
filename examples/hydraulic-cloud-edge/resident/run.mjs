import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync,rmSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {verifyAccounting,resourceSummary} from './metrics.mjs';

const namespace='cea-hc05-20261017', image='cea/hydraulic-resident:hc05-v1';
const folder=path.resolve('.local/cea/hc05-20261017');
const remote='/tmp/'+namespace;
const source='examples/hydraulic-cloud-edge/resident';
const clusters=['edge-a','edge-b','edge-c','cloud'];
const docker=(args,input,timeout=30000)=>execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,timeout,maxBuffer:64*1024*1024}).trim();
const kube=(cluster,args,input)=>docker(['exec','-i',`cea-${cluster}-1`,'kubectl',...args],input);
const get=(cluster,resource,args=[])=>JSON.parse(kube(cluster,['get',resource,...args,'-o','json']));
const save=(name,value)=>writeFileSync(path.join(folder,name),JSON.stringify(value,null,2));
const load=name=>JSON.parse(readFileSync(path.join(folder,name),'utf8'));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const create=(cluster,items)=>kube(cluster,['create','-f','-'],JSON.stringify({apiVersion:'v1',kind:'List',items}));
const pod=cluster=>get(cluster,'pods',['-n',namespace,'-l','app=hydraulic']).items[0];
function snapshot(){
  const ids=docker(['ps','-aq','--filter','name=cea-']).split(/\s+/);
  const containers=JSON.parse(docker(['inspect',...ids])).map(c=>({id:c.Id,name:c.Name,image:c.Image,started:c.State.StartedAt,running:c.State.Running}));
  const objects=Object.fromEntries(clusters.map(c=>[c,get(c,'deployments,services,hpa',['-A']).items
    .filter(v=>v.metadata.namespace!==namespace).map(v=>({kind:v.kind,name:v.metadata.namespace+'/'+v.metadata.name,uid:v.metadata.uid,spec:v.spec}))]));
  const active=Object.fromEntries(clusters.map(c=>[c,get(c,'jobs',['-A']).items.filter(v=>v.status.active>0).map(v=>v.metadata.name)]));
  const background=docker(['stats','--no-stream','--format','{{.Name}} {{.CPUPerc}} {{.MemUsage}}']);
  const mem=docker(['exec','cea-cloud-1','head','-n','5','/proc/meminfo']);
  return {containers,objects,active,background,mem};
}
function resources(cluster,endpoints){
  const env=[{name:'ROLE',value:cluster},{name:'CLOUD_URL',value:endpoints.cloud}];
  const volumes=cluster==='cloud'?[{name:'reference',configMap:{name:'reference'}}]:[];
  return [
    {apiVersion:'v1',kind:'Service',metadata:{name:'hydraulic',namespace},spec:{type:'NodePort',selector:{app:'hydraulic'},ports:[{port:8080,targetPort:8080,nodePort:31085}]}},
    {apiVersion:'apps/v1',kind:'Deployment',metadata:{name:'hydraulic',namespace},spec:{replicas:1,selector:{matchLabels:{app:'hydraulic'}},template:{metadata:{labels:{app:'hydraulic'}},spec:{automountServiceAccountToken:false,volumes,containers:[{
      name:'app',image,imagePullPolicy:'Never',env,ports:[{containerPort:8080}],
      resources:{requests:{cpu:'1',memory:cluster==='cloud'?'512Mi':'1Gi'},limits:{cpu:'1',memory:cluster==='cloud'?'512Mi':'1Gi'}},
      readinessProbe:{httpGet:{path:'/health',port:8080},initialDelaySeconds:1,periodSeconds:2},
      volumeMounts:cluster==='cloud'?[{name:'reference',mountPath:'/reference',readOnly:true}]:[]
    }]}}}}
  ];
}
async function setup(){
  assert(!existsSync(path.join(folder,'plan.json')),'Existing batch; do not overwrite');
  mkdirSync(folder,{recursive:true});
  const before=snapshot();save('before.json',before);
  assert(clusters.every(c=>before.active[c].length===0),'Active jobs: postpone experiment');
  const endpoints={};
  for(const c of clusters){
    assert(!get(c,'namespaces').items.some(n=>n.metadata.name===namespace),'Namespace exists');
    assert(!get(c,'services',['-A']).items.some(s=>s.spec.ports?.some(p=>p.nodePort===31085)),'NodePort occupied');
    const inspect=JSON.parse(docker(['inspect',`cea-${c}-1`]))[0];
    endpoints[c]='http://'+inspect.NetworkSettings.Networks.cea_default.IPAddress+':31085';
  }
  save('plan.json',{namespace,image,endpoints,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    imageId:docker(['image','inspect',image,'--format','{{.Id}}']),cpuLimit:'1',edgeMemory:'1Gi',cloudMemory:'512Mi',
    cyclesPerBatch:64,sourceCycles:2205,scope:'raw-signal bytes once / first-send to last-batch completion; HTTP, no result persistence',
    protocol:{warmupSeconds:10,sweepVus:[1,2,4,8],sweepSeconds:30,confirmSeconds:60,confirmRepetitions:3}});
  console.log(docker(['run','--rm','--network','none','--cpus','1','--memory','1g',
    '--mount',`type=bind,source=${path.resolve('.local/cea/hc01/full')},target=/source,readonly`,
    '--mount',`type=bind,source=${folder},target=/output`,image,'python','/app/fixtures.py','prepare','/source','/output/fixtures'],undefined,120000));
  save('manifest.json',JSON.parse(readFileSync(path.join(folder,'fixtures/manifest.json'))));
  const archive=path.join(folder,'image.tar');
  docker(['image','save','-o',archive,image],undefined,120000);
  for(const c of clusters){
    console.log('Importing test image:',c);
    docker(['cp',archive,`cea-${c}-1:/tmp/${namespace}-image.tar`],undefined,120000);
    docker(['exec',`cea-${c}-1`,'ctr','-n','k8s.io','images','import',`/tmp/${namespace}-image.tar`],undefined,120000);
    docker(['exec',`cea-${c}-1`,'rm',`/tmp/${namespace}-image.tar`]);
    create(c,[{apiVersion:'v1',kind:'Namespace',metadata:{name:namespace,labels:{experiment:'HC-05'}}}]);
    if(c==='cloud')create(c,[{apiVersion:'v1',kind:'ConfigMap',metadata:{name:'reference',namespace},binaryData:{'reference.npz':readFileSync('.local/cea/hc01/full/reference.npz').toString('base64')}}]);
    const manifests=resources(c,endpoints);save(`manifests-${c}.json`,manifests);create(c,manifests);
  }
  // Dedicated node-local fixture copy, used only by the new load Pod.
  docker(['exec','cea-cloud-1','mkdir',remote]);
  docker(['cp',path.join(folder,'fixtures'),`cea-cloud-1:${remote}/fixtures`],undefined,120000);
  docker(['cp',path.join(source,'load.js'),`cea-cloud-1:${remote}/load.js`]);
  for(const c of clusters)console.log(kube(c,['rollout','status','deployment/hydraulic','-n',namespace,'--timeout=25s']));
  save('deployed.json',Object.fromEntries(clusters.map(c=>[c,pod(c)])));
  console.log('SETUP_READY');
}
function verify(){
  const {endpoints}=load('plan.json');
  const output=docker(['run','--rm','--network','cea_default','--cpus','1','--memory','512m',
    '--mount',`type=bind,source=${path.join(folder,'fixtures')},target=/fixtures,readonly`,image,
    'python','/app/fixtures.py','verify','/fixtures',JSON.stringify(endpoints)],undefined,180000);
  const result=JSON.parse(output);save('correctness.json',result);
  for(const c of clusters){
    assert.equal(result.stats[c].cpuMax,'100000 100000','CPU cgroup mismatch');
    assert.equal(Number(result.stats[c].memoryMax),c==='cloud'?512*2**20:2**30,'Memory cgroup mismatch');
    assert.equal(result.stats[c].errors,0);
  }
  console.log(JSON.stringify({status:result.status,cycles:result.cycles,arraysCompared:result.arraysCompared}));
}
const sampler=`while [ ! -f /output/exit ]; do printf '%s ' "$(date +%s)"; awk '/^usage_usec|^throttled_usec/ {printf "%s ",$2}' /sys/fs/cgroup/cpu.stat; tr '\\n' ' ' < /sys/fs/cgroup/memory.current; awk '/^inactive_file / {print $2}' /sys/fs/cgroup/memory.stat; sleep 1; done`;
async function trial(label,vus,duration){
  assert(/^[a-z0-9-]+$/.test(label));assert([1,2,4,8].includes(vus));assert(/^\d+s$/.test(duration));
  assert.equal(load('correctness.json').status,'PASS');
  const target=path.join(folder,label);assert(!existsSync(target),'Trial evidence exists; no overwrite');mkdirSync(target);
  const {endpoints}=load('plan.json');
  const name='load-'+label;
  const loadPod={apiVersion:'v1',kind:'Pod',metadata:{name,namespace,labels:{experiment:'HC-05',role:'load'}},spec:{restartPolicy:'Never',automountServiceAccountToken:false,
    volumes:[{name:'input',hostPath:{path:remote,type:'Directory'}},{name:'output',emptyDir:{}}],containers:[{name:'k6',image:'grafana/k6:1.3.0',imagePullPolicy:'Never',
      command:['sh','-c',`(${sampler}) > /output/resources.txt & k6 run /input/load.js > /output/k6.log 2>&1; echo $? > /output/exit; wait; sleep 3600`],
      env:[{name:'RUN',value:label},{name:'VUS',value:String(vus)},{name:'DURATION',value:duration},{name:'ENDPOINTS',value:JSON.stringify(endpoints)},
           {name:'GOMEMLIMIT',value:'1400MiB'},{name:'GOGC',value:'50'}],
      resources:{requests:{cpu:'1',memory:'512Mi'},limits:{cpu:'4',memory:'2Gi'}},
      volumeMounts:[{name:'input',mountPath:'/input',readOnly:true},{name:'input',mountPath:'/fixtures',subPath:'fixtures',readOnly:true},{name:'output',mountPath:'/output'}]}]}};
  writeFileSync(path.join(target,'pod.json'),JSON.stringify(loadPod,null,2));
  const started=Date.now();create('cloud',[loadPod]);
  let exit=null;
  while(Date.now()-started<(parseInt(duration)+150)*1000){
    const p=get('cloud','pod',[name,'-n',namespace]);
    if(p.status.containerStatuses?.[0]?.state?.terminated){
      writeFileSync(path.join(target,'pod-final.json'),JSON.stringify(p,null,2));
      writeFileSync(path.join(target,'container.log'),kube('cloud',['logs',name,'-n',namespace]));
      throw Error('Load container terminated; original status/log preserved: '+JSON.stringify(p.status.containerStatuses[0].state));
    }
    if(p.status.phase==='Running'){
      const status=kube('cloud',['exec',name,'-n',namespace,'--','sh','-c','if [ -f /output/exit ]; then cat /output/exit; fi']);
      if(status){exit=Number(status);break;}
    }
    await pause(2000);
  }
  const final=get('cloud','pod',[name,'-n',namespace]);writeFileSync(path.join(target,'pod-final.json'),JSON.stringify(final,null,2));
  assert.notEqual(exit,null,'Trial timed out; leave Pod/evidence for diagnosis');
  for(const file of ['k6.log','resources.txt','exit'])writeFileSync(path.join(target,file),kube('cloud',['exec',name,'-n',namespace,'--','cat','/output/'+file]));
  try{writeFileSync(path.join(target,'summary.json'),kube('cloud',['exec',name,'-n',namespace,'--','cat','/output/summary.json']));}catch{}
  const log=readFileSync(path.join(target,'k6.log'),'utf8');
  const stats={};
  for(const line of log.split('\n')){
    const match=line.match(/HC05_STATS (edge-[abc]|cloud) (\{.*\})" source=console/);
    if(match){stats[match[1]]=JSON.parse(match[2].replaceAll('\\"','"'));}
  }
  writeFileSync(path.join(target,'stats.json'),JSON.stringify(stats,null,2));
  kube('cloud',['delete','pod',name,'-n',namespace,'--wait=false']);
  console.log(log.split('\n').filter(v=>v.includes('HC05_REPORT')||v.includes('level=error')).join('\n'));
  assert.equal(exit,0,'k6 failed; do not rerun same trial');
  assert.equal(Object.keys(stats).length,4,'Incomplete service resource evidence');
  const result=JSON.parse(readFileSync(path.join(target,'summary.json'))).report;
  assert.equal(result.failed,0);assert.equal(result.started,result.batches);
  assert.equal(stats.cloud.completed,result.batches);assert.equal(stats.cloud.inputBytes,result.signalBytes);
  for(const c of clusters){assert.equal(stats[c].errors,0);assert.equal(stats[c].completed,result.batches);assert.equal(stats[c].pending,0);assert.equal(stats[c].unconsumed,0);}
  verifyAccounting(result,stats,load('manifest.json'));
  console.log(JSON.stringify(result));
}
function report(){
  const rows=[];
  for(const label of ['warmup-v2','sweep-1','sweep-2','warmup-v4','v2-sweep-1','v2-sweep-2','v2-sweep-4','v2-sweep-8','confirm-1','confirm-2','confirm-3']){
    const file=path.join(folder,label,'summary.json');if(!existsSync(file))continue;
    const summary=JSON.parse(readFileSync(file));const row=summary.report;
    const stats=JSON.parse(readFileSync(path.join(folder,label,'stats.json')));
    row.resources=Object.fromEntries(Object.entries(stats).map(([g,s])=>{
      return [g,{...resourceSummary(s.samples),stages:s.stages}];
    }));
    const samples=readFileSync(path.join(folder,label,'resources.txt'),'utf8').trim().split('\n').map(x=>x.trim().split(/\s+/).map(Number));
    const first=samples[0],last=samples.at(-1),seconds=last[0]-first[0];
    row.generator={seconds,meanCores:(last[1]-first[1])/1e6/seconds,peakMiB:Math.max(...samples.map(x=>(x[3]-x[4])/2**20))};
    const start=summary.k6.metrics.batch_started_epoch_ms.values.min/1000;
    const end=summary.k6.metrics.batch_finished_epoch_ms.values.max/1000;
    const active=samples.filter(s=>s[0]>=start&&s[0]<=end);
    if(active.length>1)row.generator.measuredActiveWindow=resourceSummary(active.map(s=>({at:s[0],cpuUsec:s[1],throttledUsec:s[2],workingSetBytes:s[3]-s[4]})));
    verifyAccounting(row,stats,load('manifest.json'));
    rows.push(row);
  }
  const confirmed=rows.filter(r=>r.run.startsWith('confirm-'));
  const result={rows,confirmedMeanGBps:confirmed.length?confirmed.reduce((s,r)=>s+r.GBps,0)/confirmed.length:null};
  save('report.json',result);console.log(JSON.stringify(result,null,2));
}
function cleanup(){
  for(const c of clusters){
    const ns=get(c,'namespace',[namespace]);assert.equal(ns.metadata.labels.experiment,'HC-05');
    const current=get(c,'pods',['-n',namespace]);save(`final-${c}.json`,current);
    for(const p of current.items)writeFileSync(path.join(folder,`final-${c}-${p.metadata.name}.log`),kube(c,['logs',p.metadata.name,'-n',namespace]));
    kube(c,['delete','namespace',namespace,'--wait=false']);
  }
  console.log('Dedicated namespaces deletion requested; audit after termination.');
}
function audit(){
  for(const c of clusters)assert(!get(c,'namespaces').items.some(v=>v.metadata.name===namespace),'Namespace still exists');
  const before=load('before.json'),after=snapshot();save('after.json',after);
  assert.deepEqual(after.containers,before.containers,'Old Docker container changed');
  assert.deepEqual(after.objects,before.objects,'Old Kubernetes workload/service/HPA changed');
  save('audit.json',{status:'PASS',oldContainers:before.containers.length,oldObjects:Object.values(before.objects).reduce((s,a)=>s+a.length,0),newPodsRemaining:0});
  // Exact created paths only; originals under hc01/full are never removed.
  assert.equal(path.dirname(folder),path.resolve('.local/cea'));assert.equal(path.basename(folder),'hc05-20261017');
  if(existsSync(path.join(folder,'image.tar')))rmSync(path.join(folder,'image.tar'));
  if(existsSync(path.join(folder,'fixtures')))rmSync(path.join(folder,'fixtures'),{recursive:true});
  const resolved=docker(['exec','cea-cloud-1','readlink','-f',remote]);assert.equal(resolved,remote);
  docker(['exec','cea-cloud-1','rm','-r','--',remote]);
  console.log('AUDIT_PASS; only generated fixture copies and image archive removed.');
}
const command=process.argv[2];
if(command==='setup')await setup();
else if(command==='verify')verify();
else if(command==='trial')await trial(process.argv[3],Number(process.argv[4]),process.argv[5]);
else if(command==='report')report();
else if(command==='cleanup')cleanup();
else if(command==='audit')audit();
else if(command==='capture-failed'){
  const name=process.argv[3];assert(/^load-warmup/.test(name));
  save(name+'-failed.json',get('cloud','pod',[name,'-n',namespace]));
  writeFileSync(path.join(folder,name+'-container.log'),kube('cloud',['logs',name,'-n',namespace]));
}
else if(command==='recover-test-only'){
  const endpoints=load('plan.json').endpoints;
  const before=JSON.parse(kube('cloud',['exec',pod('cloud').metadata.name,'-n',namespace,'--','python','-c',
    "import urllib.request,json,sys; print(json.dumps({g:json.load(urllib.request.urlopen(u+'/stats')) for g,u in json.loads(sys.argv[1]).items()}))",JSON.stringify(endpoints)]));
  save('aborted-run-state.json',before);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(before).map(([g,s])=>[g,{run:s.run,completed:s.completed,pending:s.pending,unconsumed:s.unconsumed}]))));
  for(const c of clusters){assert.equal(get(c,'namespace',[namespace]).metadata.labels.experiment,'HC-05');
    kube(c,['rollout','restart','deployment/hydraulic','-n',namespace]);
  }
  for(const c of clusters)console.log(kube(c,['rollout','status','deployment/hydraulic','-n',namespace,'--timeout=25s']));
  docker(['cp',path.join(source,'load.js'),`cea-cloud-1:${remote}/load.js`]);
}
else throw Error('Use setup|verify|trial label vus duration|report|cleanup|audit');
