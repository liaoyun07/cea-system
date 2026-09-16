// Bounded read-only observation of newly created CEA algorithm Pods.
import {createWriteStream} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';

export function observe(directory) {
  const started=Date.now()-2000, processes=[], streams=[], tracked=new Set();
  let stopped=false;
  const stream=path=>{const result=createWriteStream(`${directory}/${path}`,{flags:'a'});streams.push(result);return result;};
  const events=stream('pod-events.jsonl');
  const redact=text=>text.replace(/(https?:\/\/[^\s"'?]+)\?[^\s"']+/g,'$1?[REDACTED]');
  function command(cluster,args,errors){
    // Killing the Docker client does not stop its remote exec. Record the exact
    // remote PID/start tick, then terminate only that process before closing.
    const script=`printf 'CEA_OBSERVER_PID %s %s\\n' "$$" "$(awk '{print $22}' /proc/$$/stat)" >&2; exec "$@"`;
    const child=spawn('docker',['exec',`cea-${cluster}-1`,'sh','-c',script,'cea-observer',...args],{windowsHide:true});
    const record={child,cluster,pid:null,tick:null,closed:false};processes.push(record);
    record.done=new Promise(resolve=>{child.once('close',()=>{record.closed=true;resolve();});});
    child.on('error',error=>{if(!stopped)errors.write(error.message);});
    let buffer='';
    child.stderr.on('data',bytes=>{
      buffer+=bytes.toString();let at;
      while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);
        const pid=line.match(/^CEA_OBSERVER_PID (\d+) (\d+)\r?$/);
        if(pid){record.pid=pid[1];record.tick=pid[2];}
        else if(!stopped)errors.write(redact(line)+'\n');
      }
    });
    return child;
  }
  for(const cluster of ['cloud','edge-a','edge-b','edge-c']) {
    const errors=stream(`${cluster}-watch.log`);
    const child=command(cluster,['kubectl','get','pods','-n','cea-lab','--watch','--output-watch-events','-o','json','--request-timeout=600s'],errors);
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
      const logger=command(cluster,['kubectl','logs','-n','cea-lab',pod.metadata.name,'-c','task','--follow','--timestamps','--request-timeout=580s'],output);
      logger.stdout.on('data',b=>{if(!stopped)output.write(redact(b.toString()));});
    }
  }
  return {async stop(){
    stopped=true;const deadline=Date.now()+10000;
    while(processes.some(p=>!p.closed&&!p.pid)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
    try{
      for(const p of processes){if(p.closed)continue;if(!p.pid)throw Error('Observer remote PID unavailable; stop and inspect');
        const script=`test -r /proc/$1/stat || exit 0; tick=$(awk '{print $22}' /proc/$1/stat); test "$tick" = "$2" || exit 0; kill -TERM "$1"`;
        execFileSync('docker',['exec',`cea-${p.cluster}-1`,'sh','-c',script,'cea-observer-stop',p.pid,p.tick],{timeout:10000});
      }
      await Promise.race([Promise.all(processes.map(p=>p.done)),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Observer did not exit after remote TERM')),10000);timer.unref();})]);
    }finally{
      for(const p of processes)if(!p.closed)p.child.kill();
      await Promise.all(streams.map(s=>new Promise(r=>s.end(r))));
    }
  }};
}
