import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {parse} from '../../../frontend/node_modules/yaml/dist/index.js';
import {duration,pair,transform} from './run.mjs';
test('duration uses real flow start/end, not creation or first evaluation',()=>{
  assert.equal(duration({state:'SUCCESS',createdAt:'2026-10-06T00:00:00Z',startedAt:'2026-10-06T00:00:05Z',endedAt:'2026-10-06T00:00:15Z'}),10);
  assert.throws(()=>duration({state:'FAILED'}));assert.throws(()=>duration({state:'SUCCESS'}));
});
test('failure or final accuracy below target cannot count as improvement',()=>{
  const a={execution:{state:'SUCCESS'},final:{accuracy:.91},seconds:100},c={execution:{state:'SUCCESS'},final:{accuracy:.92},seconds:70};
  assert(Math.abs(pair(a,c).efficiency-(100/70-1))<1e-12);
  assert.equal(pair(a,{...c,final:{accuracy:.89}}).efficiency,null);
  assert.equal(pair({...a,execution:{state:'FAILED'}},c).valid,false);
  assert.equal(pair(a,null).valid,false);
});
test('only experiment entry/output and fixed budgets change; CADS schedule remains12',async()=>{
  for(const algorithm of ['fedavg','fedcads']){
    const old=parse(await fs.readFile(new URL(`../convergence/${algorithm}.yaml`,import.meta.url),'utf8'));
    const flow=transform(old,algorithm);assert.equal(old.id,`conv01-${algorithm}-mnist`);
    assert.equal(flow.inputs.rounds.defaultValue,algorithm==='fedavg'?10:7);
    assert.deepEqual(flow.tasks[1].repeat,old.tasks[1].repeat);
    const leaves=[flow.tasks[0],flow.tasks[1].tasks[0].tasks[0],...flow.tasks[1].tasks.slice(1)];
    assert(leaves.every(t=>!t.container.outputFiles.includes('cea-measurement.json')));
    assert(leaves.every(t=>t.container.namespaceFiles['flow_entry.py'].revision===1));
    for(const task of leaves)if(task.container.parameters?.ROUNDS)assert.deepEqual(task.container.parameters.ROUNDS,{source:'LITERAL',value:12});
  }
});
