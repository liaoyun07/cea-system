// Read-only FLPAR-11 rollout evidence; no credentials or Secret contents recorded.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..'),folder=resolve(root,'.local/cea/par11');
const mode=process.argv[2];assert(['capture','verify','logs'].includes(mode));
await mkdir(folder,{recursive:true});
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:30000,maxBuffer:30*1024*1024});
const save=(name,data)=>writeFile(resolve(folder,name),JSON.stringify(data,null,2),{flag:'wx'});
if(mode==='logs'){
  const evidence=[];
  for(const id of ['cloud','edge-a','edge-b','edge-c']){
    const log=spawnSync('docker',['logs',`cea-${id}-1`,'--since','2026-09-15T17:09:10Z','--until','2026-09-15T17:10:20Z'],
      {encoding:'utf8',timeout:30000,maxBuffer:30*1024*1024,windowsHide:true});assert.equal(log.status,0);
    evidence.push({id,lines:(log.stdout+log.stderr).split(/\r?\n/).filter(l=>/1da1feab-b129-4093-a623-5b61237af211|b4369380-851e-44b3-8bde-e25b04f28c80/.test(l))});
  }
  await save('cross-cluster-cleanup.json',evidence);console.log(`Saved ${evidence.reduce((s,e)=>s+e.lines.length,0)} root-cause log lines`);process.exit(0);
}
const clusters=[];
for(const id of ['cloud','edge-a','edge-b','edge-c']){
  const container=`cea-${id}-1`,command=(...args)=>docker('exec',container,...args);
  const objects=JSON.parse(command('kubectl','get','nodes,namespaces,deployments,services','-A','-o','json')).items
    .map(o=>({kind:o.kind,name:o.metadata.name,...(o.metadata.namespace?{namespace:o.metadata.namespace}:{}),uid:o.metadata.uid,spec:o.spec}));
  const config=JSON.parse(command('kubectl','get',`--raw=/api/v1/nodes/cea-${id}/proxy/configz`)).kubeletconfig;
  const record={id,objects,cgroupRoot:config.cgroupRoot};
  if(mode==='verify'){
    assert.equal(config.cgroupRoot,`/cea-${id}`);
    const nodes=JSON.parse(command('kubectl','get','nodes','-o','json')).items;
    assert(nodes.every(n=>n.status.conditions.some(c=>c.type==='Ready'&&c.status==='True')));
    const running=JSON.parse(command('crictl','ps','-o','json')).containers;
    record.runningCgroups=[];
    for(const item of running){
      const inspected=JSON.parse(command('crictl','inspect',item.id)),pid=inspected.info?.pid;
      if(!pid)continue;
      const cgroup=command('cat',`/proc/${pid}/cgroup`).trim();
      assert(cgroup.includes(`/cea-${id}/kubepods/`),`${id} ${item.id}: ${cgroup}`);
      record.runningCgroups.push({name:item.metadata.name,cgroup});
    }
    assert(record.runningCgroups.length>0,'Verify actual running containers, not just config');
    const before=JSON.parse(await readFile(resolve(folder,'k3s-before.json'),'utf8')).find(c=>c.id===id);
    for(const old of before.objects)assert.deepEqual(objects.find(o=>o.uid===old.uid),old,'Cluster business objects must survive');
  }
  clusters.push(record);console.log(`${id}: ${record.cgroupRoot||'/'}; ${objects.length} preserved object definitions`);
}
await save(mode==='capture'?'k3s-before.json':'k3s-after.json',clusters);
