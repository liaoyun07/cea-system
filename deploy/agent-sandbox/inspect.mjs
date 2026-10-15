// Read-only upstream/environment inspection. Run from backend/.
import {createRequire} from 'node:module';
import {mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const YAML=require('yaml');
const folder='.local/cea/agent-sandbox-cloud-20261016';
assert(!existsSync(folder),'Inspection evidence already exists; do not overwrite');
mkdirSync(folder,{recursive:true});
const save=(name,value)=>writeFileSync(`${folder}/${name}.json`,JSON.stringify(value,null,2));
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024,timeout:30000}).trim();
const kube=(cluster,...args)=>JSON.parse(docker('exec',`cea-${cluster}-1`,'kubectl',...args,'-o','json'));
const clusters=['cloud','edge-a','edge-b','edge-c'];
const source='https://github.com/kubernetes-sigs/agent-sandbox/releases/download/v1.0.2/sandbox-with-extensions.yaml';
const response=await fetch(source,{signal:AbortSignal.timeout(60000)});assert(response.ok,`Download ${response.status}`);
const text=await response.text();writeFileSync(`${folder}/upstream.yaml`,text);
const objects=YAML.parseAllDocuments(text).map(d=>{assert.equal(d.errors.length,0);return d.toJS();}).filter(Boolean);
save('upstream',objects);
const ids=docker('ps','-q','--filter','name=cea-').split(/\s+/);
save('before',{createdAt:new Date().toISOString(),source,commit:docker('exec','cea-cloud-1','kubectl','version','-o','json'),containers:JSON.parse(docker('inspect',...ids)).map(c=>({name:c.Name,id:c.Id,started:c.State.StartedAt})),clusters:Object.fromEntries(clusters.map(c=>[c,{deployments:kube(c,'get','deployments','-A').items.map(d=>({name:d.metadata.name,namespace:d.metadata.namespace,uid:d.metadata.uid,spec:d.spec})),hpas:kube(c,'get','hpa','-A').items,crds:kube(c,'get','crd').items.map(d=>({name:d.metadata.name,uid:d.metadata.uid})),namespaces:kube(c,'get','namespaces').items.map(d=>d.metadata.name)}]))});
for(const obj of objects){
 console.log(obj.kind,obj.metadata.name);
 if(obj.kind==='Deployment'||obj.kind==='ClusterRole') console.log(JSON.stringify(obj,null,2));
 if(obj.kind==='CustomResourceDefinition'){
  const version=obj.spec.versions.find(v=>v.storage);const spec=version.schema.openAPIV3Schema.properties.spec;
  console.log('schema',version.name,JSON.stringify(Object.fromEntries(Object.entries(spec.properties).map(([k,v])=>[k,{type:v.type,description:v.description,default:v.default,enum:v.enum,properties:v.properties?Object.keys(v.properties):undefined}]))));
 }
}
