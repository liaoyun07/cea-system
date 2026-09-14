// Explicit MET-001 catalog/Flow upgrade. Requires release snapshot and published images.
// Keeps DQN experiment profiles/versions intact; never rewrites an existing ApplicationVersion.
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { parseDocument, visit } from '../frontend/node_modules/yaml/dist/index.js';

const root=resolve(import.meta.dirname,'..'), evidence=resolve(root,'.local/cea/met01');
const settings=Object.fromEntries((await readFile(resolve(root,'deploy/cea/.env'),'utf8')).split(/\r?\n/).filter(l=>/^[A-Z_0-9]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const base=`http://127.0.0.1:${settings.CEA_API_PORT}/api/namespaces/lab`;
const headers={Authorization:'Basic '+Buffer.from(`${settings.BACKEND_USER}:${settings.BACKEND_PASSWORD}`).toString('base64'),'Content-Type':'application/json'};
async function api(path,method='GET',body) {
  const response=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const value=await response.json();
  if(!response.ok)throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(value)}`);
  return value;
}
const before=JSON.parse(await readFile(resolve(evidence,'before.json'),'utf8'));
const changes=[],version='met01-v1';
const imageFor=id=>['fl-init','fl-aggregate','fl-evaluate','fedavg-train','fedprox-train'].includes(id)?'federated':['edge-hydraulic','edge-bearing','edge-surface','edge-quality-report'].includes(id)?'edge-processing':id==='offload-signal'?'offload-signal':null;
const policyIds=new Set(['hydraulic-local','bearing-return','surface-cloud','offload-terminal','offload-edge','offload-cloud','offload-rule']);
if(process.argv.includes('--verify')) {
  const upgraded=JSON.parse(await readFile(resolve(evidence,'upgraded.json'),'utf8'));
  for(const flow of before.flows) {
    const old=await api(`/flows/${flow.flowId}?revision=${flow.revision}`);
    assert.equal(old.source,flow.source,'historical user Flow source');
  }
  for(const entry of upgraded.changes) {
    const now=entry.kind==='flow'?await api(`/flows/${entry.id}`): (await api(`/edge/policies/${entry.id}`)).flow;
    assert.equal(now.source,entry.source);assert.equal(now.revision,entry.revision);
  }
  for(const old of before.policies.filter(p=>!policyIds.has(p.policy.id))) {
    assert.deepEqual(await api(`/edge/policies/${old.policy.id}`),old,'DQN experiment must remain unchanged');
  }
  console.log('PASS: current explicit revisions, historical user Flow sources and all untouched DQN policies preserved.');
} else if(process.argv.includes('--sdk-permissions')) {
  const upgraded=JSON.parse(await readFile(resolve(evidence,'upgraded.json'),'utf8'));
  const nextVersion='met01-v3', digests={};
  for(const image of ['federated','edge-processing','offload-signal']) {
    const digest=execFileSync('docker',['exec','cea-backend-1','skopeo','inspect','--tls-verify=false','--authfile=/run/secrets/registry-auth.json','--format','{{.Digest}}',`docker://registry-center:5000/lab/${image}:${nextVersion}`],{encoding:'utf8'}).trim();
    assert.match(digest,/^sha256:[a-f0-9]{64}$/);digests[image]=`registry-center:5000/lab/${image}@${digest}`;
  }
  for(const id of ['fl-init','fl-aggregate','fl-evaluate','fedavg-train','fedprox-train','edge-hydraulic','edge-bearing','edge-surface','edge-quality-report','offload-signal']) {
    const old=await api(`/applications/${id}/versions/met01-v1`);
    await api(`/applications/${id}/versions/${nextVersion}`,'PUT',{...old,version:nextVersion,image:digests[imageFor(id)]});
  }
  for(const entry of upgraded.changes) {
    const current=entry.kind==='flow'?await api(`/flows/${entry.id}`):await api(`/edge/policies/${entry.id}`);
    const flow=entry.kind==='flow'?current:current.flow;
    assert.equal(flow.source,entry.source);assert.equal(flow.revision,entry.revision);
    const doc=parseDocument(flow.source);
    visit(doc,{Map(_key,node){if(node.get('type')==='platform.Application')node.get('container').set('version',nextVersion);}});
    const source=doc.toString();
    const saved=entry.kind==='flow'
      ? await api(`/flows/${entry.id}/revisions`,'POST',{expectedRevision:flow.revision,source})
      : await api(`/edge/policies/${entry.id}`,'PUT',{clusterId:current.policy.clusterId,eventType:current.policy.eventType,enabled:current.policy.enabled,expectedRevision:flow.revision,source});
    entry.source=source;entry.revision=entry.kind==='flow'?saved.revision:saved.flow.revision;
  }
  upgraded.digests=digests;upgraded.sdkCorrection='met01-v3: declared report readable by separate UID helpers without DAC bypass';
  await writeFile(resolve(evidence,'upgraded.json'),JSON.stringify(upgraded,null,2));
  console.log('Updated ten Application versions and nine Flow/policy revisions to met01-v3; all previous versions retained.');
} else if(process.argv.includes('--edge-v2')) {
  const upgraded=JSON.parse(await readFile(resolve(evidence,'upgraded.json'),'utf8'));
  const digest=execFileSync('docker',['exec','cea-backend-1','skopeo','inspect','--tls-verify=false','--authfile=/run/secrets/registry-auth.json','--format','{{.Digest}}','docker://registry-center:5000/lab/edge-processing:met01-v2'],{encoding:'utf8'}).trim();
  assert.match(digest,/^sha256:[a-f0-9]{64}$/);
  for(const id of ['edge-hydraulic','edge-bearing','edge-surface','edge-quality-report']) {
    const old=await api(`/applications/${id}/versions/met01-v1`);
    await api(`/applications/${id}/versions/met01-v2`,'PUT',{...old,version:'met01-v2',image:`registry-center:5000/lab/edge-processing@${digest}`});
  }
  for(const entry of upgraded.changes.filter(c=>['hydraulic-local','bearing-return','surface-cloud'].includes(c.id))) {
    const current=await api(`/edge/policies/${entry.id}`);assert.equal(current.flow.source,entry.source);
    const doc=parseDocument(current.flow.source);
    visit(doc,{Map(_key,node){if(node.get('type')==='platform.Application')node.get('container').set('version','met01-v2');}});
    const source=doc.toString();
    const saved=await api(`/edge/policies/${entry.id}`,'PUT',{clusterId:current.policy.clusterId,eventType:current.policy.eventType,enabled:current.policy.enabled,expectedRevision:current.flow.revision,source});
    entry.source=source;entry.revision=saved.flow.revision;
  }
  upgraded.digests['edge-processing']=`registry-center:5000/lab/edge-processing@${digest}`;
  upgraded.edgeCorrection='met01-v2: reject unconsumed NPZ members';
  await writeFile(resolve(evidence,'upgraded.json'),JSON.stringify(upgraded,null,2));
  console.log('Updated four edge Applications and three policy revisions to met01-v2; existing versions retained.');
} else {
  await readFile(resolve(evidence,'release.json'));
  const digests={};
  for(const image of ['federated','edge-processing','offload-signal']) {
    const digest=execFileSync('docker',['exec','cea-backend-1','skopeo','inspect','--tls-verify=false','--authfile=/run/secrets/registry-auth.json','--format','{{.Digest}}',`docker://registry-center:5000/lab/${image}:${version}`],{encoding:'utf8'}).trim();
    assert.match(digest,/^sha256:[a-f0-9]{64}$/);digests[image]=`registry-center:5000/lab/${image}@${digest}`;
  }
  const applications=await api('/applications?limit=100');
  for(const app of applications.filter(a=>imageFor(a.applicationId)&&a.version!==version)) {
    const current=await api(`/applications/${app.applicationId}/versions/${app.version}`);
    const next={...current,version,image:digests[imageFor(app.applicationId)]};
    await api(`/applications/${app.applicationId}/versions/${version}`,'PUT',next);
  }
  function upgrade(source) {
    const doc=parseDocument(source);assert.equal(doc.errors.length,0);
    let count=0;
    visit(doc,{Map(_key,node){
      if(node.get('type')!=='platform.Application')return;
      const container=node.get('container');
      if(!imageFor(container.get('applicationId')))throw new Error('Unexpected application; review manually');
      container.set('version',version);
      const ports=container.get('outputFiles');
      if(!ports.toJSON().includes('cea-measurement.json'))ports.add('cea-measurement.json');
      count++;
    }});
    assert(count>0);return doc.toString();
  }
  for(const old of before.flows.filter(f=>['fedavg','fedprox'].includes(f.flowId))) {
    const current=await api(`/flows/${old.flowId}`);assert.equal(current.revision,old.revision,'Flow edited since capture');
    const source=upgrade(old.source);
    const value=await api(`/flows/${old.flowId}/revisions`,'POST',{expectedRevision:old.revision,source});
    changes.push({kind:'flow',id:old.flowId,revision:value.revision,source});
  }
  for(const old of before.policies.filter(p=>policyIds.has(p.policy.id))) {
    const current=await api(`/edge/policies/${old.policy.id}`);assert.equal(current.flow.revision,old.flow.revision,'Policy edited since capture');
    const source=upgrade(old.flow.source);
    const value=await api(`/edge/policies/${old.policy.id}`,'PUT',{clusterId:old.policy.clusterId,eventType:old.policy.eventType,enabled:old.policy.enabled,expectedRevision:old.flow.revision,source});
    changes.push({kind:'policy',id:old.policy.id,revision:value.flow.revision,source});
  }
  await writeFile(resolve(evidence,'upgraded.json'),JSON.stringify({digests,changes},null,2));
  console.log(JSON.stringify(changes.map(({kind,id,revision})=>({kind,id,revision}))));
}
