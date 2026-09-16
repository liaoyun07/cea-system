// Real CEA integration check: no containers or workloads created.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {observe} from '../thread-benchmark/observe.mjs';
const folder=new URL('../../../.local/cea/par22/observer-check/',import.meta.url);
await mkdir(folder,{recursive:true});
const attempt=await mkdtemp(new URL('attempt-',folder));
const snapshot=()=>['cloud','edge-a','edge-b','edge-c'].map(cluster=>({cluster,execIds:JSON.parse(execFileSync('docker',['inspect','--format','{{json .ExecIDs}}',`cea-${cluster}-1`],{encoding:'utf8'}))??[]}));
const before=snapshot();assert(before.every(c=>c.execIds.length===0));
async function eventually(expected){const deadline=Date.now()+10000;let state;do{state=snapshot();if(state.every(c=>c.execIds.length===expected))return state;await new Promise(r=>setTimeout(r,200));}while(Date.now()<deadline);assert.fail(JSON.stringify(state));}
const cycles=[];
for(let i=0;i<3;i++){
  const dir=`${attempt}/cycle-${i}`;await mkdir(dir);
  const watcher=observe(dir);let during;
  try{during=await eventually(1);await new Promise(r=>setTimeout(r,1000));}
  finally{await watcher.stop();}
  const after=await eventually(0);assert.deepEqual(after,before);cycles.push({during,after});
}
await writeFile(new URL('result.json',folder),JSON.stringify({result:'PASS',cycles},null,2),{flag:'wx'});
console.log('PASS: three observer cycles, all 12 remote watches exited, zero remaining Docker execs.');
