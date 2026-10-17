import {execFileSync} from 'node:child_process';

const execute=(name,args)=>execFileSync(name,args,{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:1024*1024}).trim();
let cloudId;
export function sampleHost(previous){
  const lines=execute('docker',['exec','cea-cloud-1','awk',
    '/^cpu / || /^MemTotal:|^MemAvailable:|^SwapTotal:|^SwapFree:|^pswpin |^pswpout |^oom_kill / || FILENAME ~ /pressure/ {print FILENAME, $0}',
    '/proc/stat','/proc/meminfo','/proc/vmstat','/proc/pressure/cpu','/proc/pressure/memory','/proc/pressure/io']).split('\n');
  const linux={psi:{}};
  for(const line of lines){
    const [file,key,...values]=line.trim().split(/\s+/);
    if(file==='/proc/stat')linux.ticks=values.slice(0,8).map(Number);
    else if(file==='/proc/meminfo')linux[key.slice(0,-1)]=Number(values[0])*1024;
    else if(file==='/proc/vmstat')linux[key]=Number(values[0]);
    else linux.psi[file.split('/').at(-1)+'_'+key]=Object.fromEntries(values.map(v=>{const [k,n]=v.split('=');return [k,Number(n)];}));
  }
  cloudId ||= execute('docker',['inspect','cea-cloud-1','--format','{{.Id}}']);
  const nodeRoot='/sys/fs/cgroup/docker/'+cloudId+'/';
  const nodeLines=execute('docker',['exec','cea-cloud-1','awk','{print FILENAME, $0}',
    ...['memory.current','memory.max','memory.swap.current','memory.events','memory.pressure'].map(f=>nodeRoot+f)]).split('\n');
  const cloudNode={};
  for(const line of nodeLines){
    const [file,key,...values]=line.trim().split(/\s+/),name=file.split('/').at(-1);
    if(name==='memory.events')cloudNode['events_'+key]=Number(values[0]);
    else if(name==='memory.pressure')cloudNode['pressure_'+key]=Object.fromEntries(values.map(v=>{const [k,n]=v.split('=');return [k,Number(n)];}));
    else cloudNode[name]=Number(key);
  }
  const windows=JSON.parse(execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    "$m=Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory; $c=Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter \"Name='_Total'\"; [pscustomobject]@{cpuPercent=$c.PercentProcessorTime;availableMiB=$m.AvailableMBytes;pagesInputPerSec=$m.PagesInputPerSec;committedPercent=$m.PercentCommittedBytesInUse} | ConvertTo-Json -Compress"]));
  const sample={at:Date.now(),linux,windows,cloudNode};
  if(previous){
    const delta=linux.ticks.map((v,i)=>v-previous.linux.ticks[i]),total=delta.reduce((s,v)=>s+v,0);
    linux.busyPercent=(total-delta[3]-delta[4])/total*100;linux.ioWaitPercent=delta[4]/total*100;
  }
  return sample;
}

// Conservative experiment stop conditions, not general capacity/SLO definitions.
export function hostStopReasons(samples,policy='conservative'){
  if(!samples.length)return [];
  const last=samples.at(-1),first=samples[0],reasons=[];
  if(last.linux.oom_kill>first.linux.oom_kill)reasons.push('Linux host OOM counter increased');
  if(last.linux.MemAvailable<512*2**20||last.windows.availableMiB<512)reasons.push('Host available memory below 512 MiB');
  // HC-11 user-authorized capacity exploration: PSI/CPU/IO are evidence, not stop rules.
  if(policy==='capacity')return reasons;
  const recent=samples.filter(s=>last.at-s.at<=15000);
  if(recent.length<3||last.at-recent[0].at<8000)return reasons;
  const every=predicate=>recent.every(predicate);
  if(every(s=>s.linux.busyPercent>90||s.windows.cpuPercent>90))reasons.push('Host CPU over 90% for at least 8 seconds');
  if(every(s=>s.linux.MemAvailable<1536*2**20||s.windows.availableMiB<1024))reasons.push('Sustained low host memory');
  if(every(s=>s.linux.psi.memory_full.avg10>1))reasons.push('Sustained Linux memory stalls');
  if(every(s=>s.linux.psi.io_full.avg10>5&&s.linux.ioWaitPercent>10))reasons.push('Sustained Linux IO stalls');
  if(every(s=>s.windows.availableMiB<2048&&s.windows.pagesInputPerSec>2048))reasons.push('Windows low memory with sustained paging');
  return reasons;
}

export function hostSummary(samples,policy='conservative'){
  if(!samples.length)return null;
  const cpu=samples.map(s=>s.linux.busyPercent).filter(Number.isFinite);
  const nodeSamples=samples.filter(s=>s.cloudNode);
  return {samples:samples.length,linuxMeanBusyPercent:cpu.length?cpu.reduce((a,b)=>a+b,0)/cpu.length:null,
    linuxMaxBusyPercent:cpu.length?Math.max(...cpu):null,windowsMaxBusyPercent:Math.max(...samples.map(s=>s.windows.cpuPercent)),
    linuxMinAvailableMiB:Math.min(...samples.map(s=>s.linux.MemAvailable/2**20)),windowsMinAvailableMiB:Math.min(...samples.map(s=>s.windows.availableMiB)),
    linuxMaxMemoryFullAvg10:Math.max(...samples.map(s=>s.linux.psi.memory_full.avg10)),
    linuxMaxIOFullAvg10:Math.max(...samples.map(s=>s.linux.psi.io_full.avg10)),
    swapInPages:samples.at(-1).linux.pswpin-samples[0].linux.pswpin,swapOutPages:samples.at(-1).linux.pswpout-samples[0].linux.pswpout,
    cloudNode:nodeSamples.length?{memoryLimitMiB:nodeSamples.at(-1).cloudNode['memory.max']/2**20,
      peakMiB:Math.max(...nodeSamples.map(s=>s.cloudNode['memory.current']/2**20)),
      limitEventsDelta:nodeSamples.at(-1).cloudNode.events_max-nodeSamples[0].cloudNode.events_max,
      maxMemoryFullAvg10:Math.max(...nodeSamples.map(s=>s.cloudNode.pressure_full.avg10))}:null,
    stopReasons:hostStopReasons(samples,policy)};
}
