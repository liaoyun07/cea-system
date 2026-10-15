// Cloud-only installation of the upstream controller; no changes to CEA workloads.
// Run inspect.mjs first, then install.mjs check|install from backend/.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const folder='.local/cea/agent-sandbox-cloud-20261016';
const mode=process.argv[2];assert(['check','install'].includes(mode));
const objects=JSON.parse(readFileSync(`${folder}/upstream.json`));
const before=JSON.parse(readFileSync(`${folder}/before.json`));
assert(!before.clusters.cloud.namespaces.includes('agent-sandbox-system'));
const deployment=objects.find(o=>o.kind==='Deployment');
assert.equal(deployment.spec.template.spec.containers[0].image,'registry.k8s.io/agent-sandbox/agent-sandbox-controller:v1.0.2');
deployment.spec.template.spec.containers[0].resources={requests:{cpu:'100m',memory:'128Mi'},limits:{cpu:'500m',memory:'512Mi'}};
const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:32*1024*1024}).trim();
const kubectl=(args,input)=>docker(['exec','-i','cea-cloud-1','kubectl',...args],input);
const list=items=>JSON.stringify({apiVersion:'v1',kind:'List',items});
const clusterObjects=objects.filter(o=>['Namespace','CustomResourceDefinition','ClusterRole','ClusterRoleBinding'].includes(o.kind));
for(const object of clusterObjects){
 const found=kubectl(['get',object.kind,object.metadata.name,'--ignore-not-found','-o','name']);
 assert.equal(found,'',`Existing object ${object.kind}/${object.metadata.name}; inspect before changing it`);
}
const validation=kubectl(['apply','--server-side','--dry-run=server','--field-manager=cea-warm-install','-f','-'],list(clusterObjects));
writeFileSync(`${folder}/compatibility.txt`,validation);console.log(validation);
writeFileSync(`${folder}/installation.json`,list(objects));
if(mode==='install'){
 assert(!existsSync(`${folder}/installed.json`),'Already installed; do not resubmit');
 const applied=kubectl(['apply','--server-side','--field-manager=cea-warm-install','-f','-'],list(objects));
 writeFileSync(`${folder}/installed.json`,JSON.stringify({at:new Date().toISOString(),applied},null,2));
 console.log(applied);
}
