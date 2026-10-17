// Run only after approval to add Service update to the four existing backend accounts.
import {execFileSync} from 'node:child_process';
import {existsSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const folder='.local/cea/flow-dep-01-20261018';
const kube=(cluster,args,input)=>execFileSync('docker',['exec','-i',`cea-${cluster}-1`,'kubectl',...args],{input,encoding:'utf8',windowsHide:true,timeout:30000});
const get=(c,kind)=>JSON.parse(kube(c,['get',kind,'cea-observe-nodes','-o','json']));
const write=(name,data)=>writeFileSync(`${folder}/${name}.json`,JSON.stringify(data,null,2));
assert(!existsSync(`${folder}/permissions.json`),'Permission evidence already exists');
const results=[];
for(const cluster of ['cloud','edge-a','edge-b','edge-c']) {
  const before=get(cluster,'clusterrole'),binding=get(cluster,'clusterrolebinding');
  assert.deepEqual(binding.subjects,[{kind:'ServiceAccount',name:'cea-backend',namespace:'cea-lab'}]);
  const index=before.rules.findIndex(r=>JSON.stringify(r.apiGroups)==='[""]'&&JSON.stringify(r.resources)==='["services"]');
  assert(index>=0);assert(!before.rules[index].verbs.includes('update'));
  write(`permissions-${cluster}-before`,{role:before,binding});
  const patch=[{op:'test',path:'/metadata/resourceVersion',value:before.metadata.resourceVersion},
    {op:'test',path:`/rules/${index}`,value:before.rules[index]},
    {op:'add',path:`/rules/${index}/verbs/-`,value:'update'}];
  kube(cluster,['patch','clusterrole','cea-observe-nodes','--type=json','--patch-file=/dev/stdin'],JSON.stringify(patch));
  const after=get(cluster,'clusterrole');write(`permissions-${cluster}-after`,after);
  const expected=structuredClone(before.rules);expected[index].verbs.push('update');assert.deepEqual(after.rules,expected);
  assert.deepEqual(get(cluster,'clusterrolebinding'),binding);
  const permitted=kube(cluster,['auth','can-i','update','services','-n','cea-lab-flow-dep01','--as=system:serviceaccount:cea-lab:cea-backend']).trim();
  assert.equal(permitted,'yes');results.push({cluster,serviceUpdate:permitted,otherRulesUnchanged:true,bindingUnchanged:true});
}
write('permissions',{status:'PASS',results});console.log(JSON.stringify(results));
