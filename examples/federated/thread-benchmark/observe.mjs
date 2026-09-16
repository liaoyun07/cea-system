// Bounded read-only observation of newly created CEA algorithm Pods.
import {createWriteStream} from 'node:fs';
import {spawn} from 'node:child_process';

export function observe(directory) {
  const started=Date.now()-2000, processes=[], streams=[], tracked=new Set();
  let stopped=false;
  const stream=path=>{const result=createWriteStream(`${directory}/${path}`,{flags:'a'});streams.push(result);return result;};
  const events=stream('pod-events.jsonl');
  const redact=text=>text.replace(/(https?:\/\/[^\s"'?]+)\?[^\s"']+/g,'$1?[REDACTED]');
  for(const cluster of ['cloud','edge-a','edge-b','edge-c']) {
    const child=spawn('docker',['exec',`cea-${cluster}-1`,'kubectl','get','pods','-n','cea-lab','--watch','--output-watch-events','-o','json','--request-timeout=600s'],{windowsHide:true});
    processes.push(child);const errors=stream(`${cluster}-watch.log`);
    child.on('error',error=>{if(!stopped)errors.write(error.message);});
    child.stderr.on('data',b=>{if(!stopped)errors.write(redact(b.toString()));});
    let buffer='',depth=0,quote=false,escaped=false,start=-1,position=0;
    child.stdout.on('data',chunk=>{
      if(stopped)return;
      buffer+=chunk.toString();
      for(;position<buffer.length;position++) {
        const c=buffer[position];if(start<0){if(c!=='{')continue;start=position;depth=0;}
        if(quote){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quote=false;continue;}
        if(c==='"')quote=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){onEvent(cluster,JSON.parse(buffer.slice(start,position+1)));start=-1;}
      }
      if(start<0){buffer='';position=0;}else if(start>0){buffer=buffer.slice(start);position-=start;start=0;}
    });
  }
  function onEvent(cluster,event) {
    const pod=event.object;
    if(!pod?.metadata?.name?.startsWith('cea-')||Date.parse(pod.metadata.creationTimestamp)<started)return;
    const statuses=[...(pod.status?.initContainerStatuses??[]),...(pod.status?.containerStatuses??[])];
    events.write(JSON.stringify({observedAt:new Date().toISOString(),cluster,event:event.type,name:pod.metadata.name,
      uid:pod.metadata.uid,phase:pod.status?.phase,reason:pod.status?.reason,
      statuses:statuses.map(s=>({name:s.name,state:s.state,lastState:s.lastState,restartCount:s.restartCount}))})+'\n');
    for(const status of statuses) {
      if(status.name!=='task'||(!status.state?.running&&!status.state?.terminated))continue;
      const key=`${cluster}-${pod.metadata.name}-task`;if(tracked.has(key))continue;tracked.add(key);
      const output=stream(`${key}.log`);
      const logger=spawn('docker',['exec',`cea-${cluster}-1`,'kubectl','logs','-n','cea-lab',pod.metadata.name,'-c','task','--follow','--timestamps','--request-timeout=580s'],{windowsHide:true});
      processes.push(logger);logger.on('error',e=>{if(!stopped)output.write(e.message);});
      for(const pipe of [logger.stdout,logger.stderr])pipe.on('data',b=>{if(!stopped)output.write(redact(b.toString()));});
    }
  }
  return {async stop(){stopped=true;for(const child of processes)child.kill();await new Promise(r=>setTimeout(r,400));await Promise.all(streams.map(s=>new Promise(r=>s.end(r))));}};
}
