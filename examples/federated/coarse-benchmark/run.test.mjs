import assert from 'node:assert/strict';
import test from 'node:test';
import {stringify} from '../../../frontend/node_modules/yaml/dist/index.js';
import {variant,sequence} from './run.mjs';
const original={id:'par21-candidate',labels:{keep:'yes'},inputs:{model:{defaultValue:'linear'},local_epochs:{defaultValue:1},batch_size:{defaultValue:1024},raw_training_dataset:{defaultValue:'cifar10-raw-train/v2',values:['cifar10-raw-train/v2']}},tasks:[{id:'init',container:{version:'par21-v1'}},{id:'rounds',repeat:{iterations:1},tasks:[{id:'clients',loop:{concurrency:6,values:{source:'LITERAL',value:Array.from({length:6},(_,i)=>({id:`edge-${'abc'[i%3]}${1+Math.floor(i/3)}`,clusters:[`edge-${'abc'[i%3]}`]}))},outputs:{models:'keep'}},tasks:[{id:'preprocess',container:{version:'par18-v1',command:['python','/app/preprocess.py']}},{id:'train',container:{version:'par21-v1',command:['keep'],parameters:{LOCAL_EPOCHS:'keep'}}}]},{id:'aggregate'},{id:'evaluate'}]}]};
test('baseline keeps entire original workload and application definition',()=>{
  const flow=variant(stringify(original),'baseline');assert.deepEqual(flow.tasks,original.tasks);assert.deepEqual(flow.inputs,original.inputs);
});
test('candidate only repacks three clients and selects the doubled data contract',()=>{
  const flow=variant(stringify(original),'candidate'),loop=flow.tasks[1].tasks[0];
  assert.deepEqual(loop.loop.values.value,original.tasks[1].tasks[0].loop.values.value.slice(0,3));assert.equal(loop.loop.concurrency,3);
  assert.equal(flow.inputs.raw_training_dataset.defaultValue,'cifar10-raw-train/par22-double');assert.equal(loop.tasks[0].container.version,'par22-v1');
  loop.loop=structuredClone(original.tasks[1].tasks[0].loop);loop.tasks[0].container.version='par18-v1';flow.inputs.raw_training_dataset=original.inputs.raw_training_dataset;
  assert.deepEqual(flow.tasks,original.tasks);assert.deepEqual(flow.inputs,original.inputs);
});
test('bounded warmups and same balanced formal order',()=>{
  assert.equal(sequence.length,8);assert(sequence.slice(0,2).every(r=>r.warmup));assert(sequence.slice(2).every(r=>!r.warmup));
  assert.deepEqual(sequence.slice(2).map(r=>r.kind),['baseline','candidate','candidate','baseline','baseline','candidate']);
});
