import test from 'node:test';
import assert from 'node:assert/strict';
import {summary} from './balanced-rate.mjs';

test('exclude warmup and retain unsuccessful formal attempt in the count',()=>{
  const sample={warmup:false,execution:{id:'one',state:'SUCCESS'},measurement:{status:'AVAILABLE',bytesPerSecond:500e6,activeSeconds:3},totalSeconds:30,train:{peak:2}};
  const result=summary([sample,{...sample,warmup:true,measurement:{...sample.measurement,bytesPerSecond:900e6}},
    {...sample,execution:{id:'failed',state:'FAILED'},measurement:{status:'NOT_SUCCESSFUL'}}]);
  assert.equal(result.attempts,2);assert.equal(result.success,1);assert.equal(result.meanMBps,500);assert.equal(result.meanTotalSeconds,30);
  assert.equal(result.rows.length,2);assert.equal(result.rows[1].state,'FAILED');
  assert.equal(summary([]).meanMBps,null);
});
