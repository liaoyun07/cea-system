// Preserve logs of this batch's short-lived Jobs before normal runtime cleanup.
import {execFileSync,spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
const root=new URL('../../.local/cea/terminal-load/job-logs/',import.meta.url);await mkdir(root,{recursive:true});
const until=Date.now()+240000;
const seen=new Set(), followers=[];
while(Date.now()<until) {
  for(const cluster of ['edge-a','cloud']) {
    try {
      const rows=JSON.parse(execFileSync('docker',['exec',`cea-${cluster}-1`,'kubectl','get','pods','-A','--field-selector=status.phase!=Succeeded,status.phase!=Failed','-o','json'],{encoding:'utf8',maxBuffer:64*1024*1024,windowsHide:true})).items;
      for(const pod of rows) {
        // The release guard established no pre-existing active executions; these are dedicated calibration/load Jobs.
        if(!pod.metadata.name.startsWith('cea-') || Date.parse(pod.metadata.creationTimestamp)<Date.now()-300000)continue;
        if(seen.has(pod.metadata.name))continue;
        seen.add(pod.metadata.name);
        for(const container of [...(pod.spec.initContainers||[]),...(pod.spec.containers||[])]) {
          const output=createWriteStream(new URL(`${cluster}-${pod.metadata.name}-${container.name}.log`,root));
          const child=spawn('docker',['exec',`cea-${cluster}-1`,'kubectl','logs','-f','--pod-running-timeout=30s','-n',pod.metadata.namespace,pod.metadata.name,'-c',container.name],{windowsHide:true,stdio:['ignore','pipe','pipe']});
          child.stdout.pipe(output);child.stderr.resume();followers.push(child);
        }
        await writeFile(new URL(`${cluster}-${pod.metadata.name}.json`,root),JSON.stringify({metadata:pod.metadata,status:pod.status},null,2));
      }
    }catch{}
  }
  await new Promise(r=>setTimeout(r,300));
}
for(const child of followers)if(child.exitCode==null)child.kill();
