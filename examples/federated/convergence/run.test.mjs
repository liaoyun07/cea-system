import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {parse} from '../../../frontend/node_modules/yaml/dist/index.js';
import {hit} from './run.mjs';

test('first target crossing is not best/final accuracy or fixed-budget runtime',()=>{
  const rows=[{round:1,accuracy:0.8,seconds:20},{round:2,accuracy:0.9,seconds:40},{round:3,accuracy:0.95,seconds:60}];
  assert.deepEqual(hit(rows,0.9),rows[1]);assert.equal(hit(rows,0.99),null);
});
test('experimental flows have same common config, init seed and physical topology',async()=>{
  const flows=await Promise.all(['fedavg','fedcads'].map(async name=>parse(await fs.readFile(new URL(`${name}.yaml`,import.meta.url),'utf8'))));
  for(const key of ['rounds','model','training_dataset','test_dataset','local_epochs','batch_size','learning_rate','seed'])
    assert.deepEqual(flows[0].inputs[key],flows[1].inputs[key]);
  for(const flow of flows){
    const leaves=[flow.tasks[0],flow.tasks[1].tasks[0].tasks[0],...flow.tasks[1].tasks.slice(1)];
    for(const task of leaves){
      assert.equal(task.container.version,'conv01-v1');
      if(['init','train'].includes(task.id))assert.deepEqual(task.container.parameters.SEED,{source:'INPUT',name:'seed'});
    }
    assert.deepEqual(flow.tasks[0].container.candidateClusters,['cloud']);
    assert.equal(flow.tasks[1].tasks[0].loop.concurrency,6);
    assert.deepEqual(flow.tasks[1].tasks[0].tasks[0].container.candidateClusters,{source:'ITEM',path:['value','clusters']});
  }
});
