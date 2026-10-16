// Real cgroup smoke; only creates/removes its own short-lived test containers.
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const folder=resolve('.local/cea/job-usage-20261017/meter');mkdirSync(folder,{recursive:true});
const image=process.env.METER_IMAGE||'cea/file-helper:job-usage-v1';
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true}).trim();
const evidence=[];
for(const [name,command,exit] of [
  ['short',['true'],0],
  ['failed',['sh','-c','exit 7'],7],
  ['signal',['sleep','30'],143],
  ['compute',['python','-c',`import time,hashlib,json
data=bytearray(8*1024*1024)
until=time.monotonic()+1.5
while time.monotonic()<until: hashlib.sha256(data).digest()
print(json.dumps({'cpu':open('/sys/fs/cgroup/cpu.stat').read(),'memory':open('/sys/fs/cgroup/memory.current').read()}))`],0],
]) {
  const id='cea-job-usage-meter-'+name;
  const reportPath=folder+'/'+name+'.json';writeFileSync(reportPath,'');
  // Like Kubernetes, bind a persistent termination-message file into /dev.
  docker('create','--name',id,'--cpus','0.25','--memory','64m','--mount','type=bind,source='+reportPath+',target=/dev/termination-log',
    '--entrypoint','/app/resource-meter',image,'--',...command);
  try {
    docker('start',id);
    if(name==='signal'){await new Promise(r=>setTimeout(r,200));docker('kill','--signal','TERM',id);}
    assert.equal(Number(docker('wait',id)),exit);
    const r=JSON.parse(readFileSync(reportPath)).resources;
    assert.equal(r.status,'COMPLETE');assert(r.cpuCoreSeconds>0 && r.cpuCoreSeconds<2);assert(r.memoryByteSeconds>0);assert(r.samples>=2);
    const logs=docker('logs',id);
    if(name==='compute') {
      const actual=JSON.parse(logs),cpu=Number(actual.cpu.match(/usage_usec (\d+)/)[1])/1e6;
      assert(r.cpuCoreSeconds>=cpu && r.cpuCoreSeconds-cpu<0.15);
      assert(r.peakMemoryBytes>8*1048576 && r.peakMemoryBytes<64*1048576);assert(r.samples>=10);
    }
    evidence.push({name,exit,report:r,logs});
  } finally {docker('rm','-f',id);}
}
writeFileSync(folder+'/summary.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
