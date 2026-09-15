import test from 'node:test';
import assert from 'node:assert/strict';
import {reduced,sequence,summarize} from './low-clients.mjs';
import {stringify} from '../../../frontend/node_modules/yaml/dist/index.js';

test('reduce only Loop members/concurrency; preserve executable fields',()=>{
  const original={id:'par10-fedavg-cifar10-c18-preprocess',inputs:{batch_size:{defaultValue:1024}},
    tasks:[{id:'init'},{id:'rounds',repeat:{iterations:{source:'LITERAL',value:1}},tasks:[{id:'clients',loop:{concurrency:18,
      values:{source:'LITERAL',value:Array.from({length:18},(_,i)=>({id:`edge-${'abc'[i%3]}${Math.floor(i/3)+1}`,clusters:[`edge-${'abc'[i%3]}`]}))},outputs:{models:'keep'}},tasks:[{id:'preprocess'},{id:'train'}]}]}]};
  for(const n of [1,2,3]){const f=reduced(stringify(original),n);assert.equal(f.tasks[1].tasks[0].loop.concurrency,n);
    assert.equal(f.tasks[1].tasks[0].loop.values.value.length,n);assert.deepEqual(f.inputs,original.inputs);assert.deepEqual(f.tasks[1].tasks[0].tasks,original.tasks[1].tasks[0].tasks);}
  assert.throws(()=>reduced(stringify(original),4));assert.equal(original.tasks[1].tasks[0].loop.concurrency,18);
});
test('one warmup and three balanced formal attempts per client count',()=>{
  for(const n of [1,2,3]){assert.equal(sequence.filter(x=>x.clients===n&&x.warmup).length,1);assert.equal(sequence.filter(x=>x.clients===n&&!x.warmup).length,3);}
  for(const offset of [3,6,9])assert.deepEqual(sequence.slice(offset,offset+3).map(x=>x.clients).sort(),[1,2,3]);
});
test('summary excludes warmup but retains failed attempt count',()=>{
  const row={clients:1,warmup:false,execution:{id:'ok',state:'SUCCESS'},endToEndSeconds:10,measurement:{status:'AVAILABLE',activeSeconds:2,bytesPerSecond:1000000,inputBytes:1,outputBytes:1},trainParallel:{peak:1},reports:[{taskId:'train',report:{durationNs:1000000000}}]};
  const result=summarize([row,{...row,warmup:true},{...row,execution:{id:'bad',state:'FAILED'},measurement:{status:'NOT_SUCCESSFUL'}}])[0];
  assert.equal(result.attempts,2);assert.equal(result.success,1);assert.equal(result.meanMBps,1);assert.deepEqual(result.executionIds,['ok','bad']);
});
