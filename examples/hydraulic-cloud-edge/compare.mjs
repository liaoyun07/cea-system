import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const socketPath = process.env.CEA_DOCKER_PIPE || '//./pipe/dockerDesktopLinuxEngine';
const api = 'http://127.0.0.1:18085/api/namespaces/lab';
const root = path.resolve(process.argv[2] || '.local/cea/hc03/run-1');
const passes = Number(process.argv[3] || 1);
const repeatMode = process.argv[3] !== undefined;
if (![1,5,10].includes(passes)) throw Error('Dataset passes must be 1, 5 or 10.');
const authorization = process.env.CEA_COMPARE_AUTH;
if (!authorization) throw Error('Run through compare-run.ps1; authorization is not written to evidence.');
await fs.mkdir(root, {recursive:true});
const save = (name, value) => fs.writeFile(path.join(root,name),JSON.stringify(value,null,2),{flag:'wx'});
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));

function docker(url, body) {
  return new Promise((resolve,reject)=>{
    const req=http.request({socketPath,path:url,method:body?'POST':'GET',
      headers:body?{'Content-Type':'application/json'}:{}},res=>{
      const chunks=[];res.on('data',d=>chunks.push(d));res.on('end',()=>{
        const raw=Buffer.concat(chunks);
        if(res.statusCode>=300) return reject(Error(`Docker ${res.statusCode}: ${raw}`));
        resolve(raw);
      });
    });
    req.on('error',reject);req.setTimeout(15000,()=>req.destroy(Error('Docker read timeout')));
    req.end(body?JSON.stringify(body):undefined);
  });
}
const dj=async (url,body)=>JSON.parse(await docker(url,body));
async function request(url, body) {
  const response=await fetch(`${api}/${url}`,{method:body?'POST':'GET',
    headers:{Authorization:authorization,'Content-Type':'application/json',...(body?{'Idempotency-Key':randomUUID()}: {})},
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
  if(!response.ok) throw Error(`API ${response.status}: ${await response.text()}`);
  return response.json();
}

const containers=(await dj('/containers/json')).filter(c=>c.Names.some(n=>n.startsWith('/cea-')));
const info=await dj('/info');
const inspect=await Promise.all(containers.map(c=>dj(`/containers/${c.Id}/json`)));
const beforeFlows=await request('flows?limit=100');
await save('environment.json',{capacity:{cpuCores:info.NCPU,memoryBytes:info.MemTotal,cgroup:info.CgroupVersion},
  containers:inspect.map(c=>({id:c.Id,name:c.Name,image:c.Image,startedAt:c.State.StartedAt,
    memoryLimit:c.HostConfig.Memory,nanoCpus:c.HostConfig.NanoCpus})),flows:beforeFlows,
  scope:'CEA Docker cgroups plus four disjoint /cea-* Kubernetes Pod cgroups; not host NodeMetrics'});

async function podStats() {
  // Pod cgroups are siblings of /docker, NOT descendants of K3s containers.
  const command="for c in cea-cloud cea-edge-a cea-edge-b cea-edge-c; do p=/sys/fs/cgroup/$c; echo $c; cat $p/cpu.stat; echo memory; cat $p/memory.current; echo inactive; sed -n 's/^inactive_file //p' $p/memory.stat; echo limit; cat $p/memory.max; cat $p/cpu.max; done";
  const exec=await dj('/containers/cea-edge-a-1/exec',{AttachStdout:true,AttachStderr:true,Cmd:['sh','-ec',command]});
  const raw=await docker(`/exec/${exec.Id}/start`,{Detach:false,Tty:false});
  let text='';for(let i=0;i<raw.length;){const length=raw.readUInt32BE(i+4);text+=raw.subarray(i+8,i+8+length).toString();i+=8+length;}
  const result=[];
  for(const match of text.matchAll(/(cea-(?:cloud|edge-[abc]))\n([\s\S]*?)memory\n(\d+)\ninactive\n(\d+)\nlimit\n([^\n]+)\n([^\n]+)\n/g)){
    result.push({name:`pods:${match[1]}`,cpuNs:Number(/usage_usec (\d+)/.exec(match[2])[1])*1000,
      memoryBytes:Math.max(0,Number(match[3])-Number(match[4])),memoryLimit:match[5],cpuLimit:match[6]});
  }
  if(result.length!==4) throw Error(`Incomplete Pod cgroup sample: ${text}`);
  const status=await dj(`/exec/${exec.Id}/json`);
  if(status.ExitCode!==0) throw Error('Pod cgroup read failed');
  return result;
}
async function sample() {
  const begin=Date.now();
  const [stats,pods]=await Promise.all([
    Promise.all(containers.map(async c=>{
      const s=await dj(`/containers/${c.Id}/stats?stream=false&one-shot=true`);
      const inactive=s.memory_stats.stats?.inactive_file ?? s.memory_stats.stats?.total_inactive_file;
      if(inactive===undefined || s.cpu_stats.cpu_usage.total_usage===undefined) throw Error('Missing cgroup counters');
      return {name:c.Names[0].slice(1),read:s.read,cpuNs:s.cpu_stats.cpu_usage.total_usage,
        memoryBytes:Math.max(0,s.memory_stats.usage-inactive)};
    })),podStats()]);
  const components=[...stats,...pods];
  return {atMs:(begin+Date.now())/2,readDurationMs:Date.now()-begin,components,
    cpuNs:components.reduce((a,c)=>a+c.cpuNs,0),memoryBytes:components.reduce((a,c)=>a+c.memoryBytes,0)};
}
function summarize(samples) {
  const first=samples[0],last=samples.at(-1),seconds=(last.atMs-first.atMs)/1000;
  let integral=0;for(let i=1;i<samples.length;i++) integral+=(samples[i].atMs-samples[i-1].atMs)/1000*(samples[i].memoryBytes+samples[i-1].memoryBytes)/2;
  const componentCosts=first.components.map(c=>({name:c.name,cpuCoreSeconds:(last.components.find(v=>v.name===c.name).cpuNs-c.cpuNs)/1e9}));
  if(componentCosts.some(c=>c.cpuCoreSeconds<0)) throw Error('CPU counter reset; trial invalid');
  const cpu=(last.cpuNs-first.cpuNs)/1e9;
  return {observationSeconds:seconds,cpuCoreSeconds:cpu,memoryGiBSeconds:integral/2**30,
    averageCpuPercent:cpu/seconds/info.NCPU*100,averageMemoryPercent:integral/seconds/info.MemTotal*100,
    peakMemoryGiB:Math.max(...samples.map(s=>s.memoryBytes))/2**30,componentCosts,
    maxSampleGapMs:Math.max(...samples.slice(1).map((s,i)=>s.atMs-samples[i].atMs)),
    maxReadDurationMs:Math.max(...samples.map(s=>s.readDurationMs))};
}

const flowId=mode=>repeatMode?`hydraulic-${mode}-repeat${passes}`:`hydraulic-${mode}-compare`;
const flows={central:await request(`flows/${flowId('central')}`),distributed:await request(`flows/${flowId('distributed')}`)};
const trials=[];
for(let pair=0;pair<=5;pair++) {
  const order=pair%2===0?['central','distributed']:['distributed','central'];
  for(const mode of order) {
    const name=`pair-${pair}-${mode}`;
    // A fixed idle reference is retained, never silently subtracted from primary costs.
    const idle=[await sample()];for(let n=0;n<4;n++){await sleep(500);idle.push(await sample());}
    const samples=[await sample()];
    const submittedAtMs=Date.now();
    const accepted=await request('executions',{flowId:flows[mode].flowId,revision:flows[mode].revision,inputs:{}});
    await save(`${name}-accepted.json`,accepted);
    console.log(`${name}: ${accepted.executionId}`);
    let execution;
    const deadline=Date.now()+600000;
    while(true) {
      execution=await request(`executions/${accepted.executionId}`);
      samples.push(await sample());
      if(['SUCCESS','FAILED','KILLED'].includes(execution.state)) break;
      if(Date.now()>deadline) throw Error(`Still active: ${accepted.executionId}; do not resubmit.`);
      await sleep(500);
    }
    const completedObservedAtMs=Date.now();
    const tasks=await request(`executions/${accepted.executionId}/tasks`);
    const reports=[];
    for(const t of tasks.filter(t=>t.outputs?.['cea-measurement.json'])) {
      reports.push({taskId:t.taskId,report:await request(`executions/${accepted.executionId}/tasks/${t.id}/output-json?port=cea-measurement.json`)});
    }
    const final=tasks.find(t=>t.taskId===(mode==='central'?'central':'fusion'));
    const report=execution.state==='SUCCESS'?await request(`executions/${accepted.executionId}/tasks/${final.id}/output-json?port=report.json`):null;
    const upstreamBytes=reports.filter(r=>r.taskId===(mode==='central'?'central':'fusion'))
      .flatMap(r=>r.report.inputs).filter(f=>!f.path.endsWith('/reference.npz')&&!f.path.endsWith('/dataset-REFERENCE')).reduce((a,f)=>a+f.bytes,0);
    const trial={pair,warmup:pair===0,mode,datasetPasses:passes,execution,tasks,reports,report,samples,idleSamples:idle,
      submittedAtMs,completedObservedAtMs,upstreamBytes,resources:summarize(samples),idleResources:summarize(idle),
      executionSeconds:(Date.parse(execution.endedAt)-Date.parse(execution.createdAt))/1000};
    await save(`${name}.json`,trial);trials.push(trial);
    console.log(JSON.stringify({mode,state:execution.state,seconds:trial.executionSeconds,...trial.resources,componentCosts:undefined,upstreamBytes}));
    if(execution.state!=='SUCCESS') throw Error('Failed trial preserved; no replacement runs.');
    if(reports.length!==(mode==='central'?1:4)) throw Error('Wrong measured task count');
  }
}
const formal=trials.filter(t=>!t.warmup);
const averages={};
for(const mode of ['central','distributed']) {
  const selected=formal.filter(t=>t.mode===mode);
  averages[mode]={};
  for(const key of ['cpuCoreSeconds','memoryGiBSeconds','averageCpuPercent','averageMemoryPercent','peakMemoryGiB'])
    averages[mode][key]=selected.reduce((a,t)=>a+t.resources[key],0)/selected.length;
  for(const key of ['executionSeconds','upstreamBytes']) averages[mode][key]=selected.reduce((a,t)=>a+t[key],0)/selected.length;
}
const reductions={};for(const key of Object.keys(averages.central)) reductions[key]=(1-averages.distributed[key]/averages.central[key])*100;
await save('summary.json',{datasetPasses:passes,averages,reductions,scope:'Unsubtracted whole-CEA costs in submit/completion-observation envelope; execution latency separately uses API timestamps.',
  formalExecutions:formal.map(t=>({mode:t.mode,id:t.execution.id})),beforeFlows,afterFlows:await request('flows?limit=100')});
const after=await Promise.all(containers.map(c=>dj(`/containers/${c.Id}/json`)));
await save('after-containers.json',after.map(c=>({id:c.Id,name:c.Name,image:c.Image,startedAt:c.State.StartedAt,memoryLimit:c.HostConfig.Memory,nanoCpus:c.HostConfig.NanoCpus})));
console.log(JSON.stringify({averages,reductions},null,2));
