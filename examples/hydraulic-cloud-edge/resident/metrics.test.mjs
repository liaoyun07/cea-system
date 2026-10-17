import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyAccounting,resourceSummary} from './metrics.mjs';

test('integrates variable memory, CPU delta and throttling over actual time',()=>{
  const r=resourceSummary([{at:2,cpuUsec:10,throttledUsec:0,workingSetBytes:2**20},
    {at:4,cpuUsec:1000010,throttledUsec:500000,workingSetBytes:3*2**20}]);
  assert.equal(r.averageMiB,2);assert.equal(r.meanCores,.5);assert.equal(r.throttleSeconds,.5);
});
test('rejects reset CPU counters',()=>assert.throws(()=>resourceSummary([
  {at:0,cpuUsec:5,workingSetBytes:0},{at:1,cpuUsec:0,workingSetBytes:0}])));
const fixture=()=>({result:{batches:3,started:3,failed:0,signalBytes:40},
  manifest:[{expected:{inputBytes:10}},{expected:{inputBytes:20}}],
  stats:Object.fromEntries(['edge-a','edge-b','edge-c','cloud'].map(g=>[g,{completed:3,errors:0,pending:0,unconsumed:0,inputBytes:g==='cloud'?40:g==='edge-c'?20:10}]))});
test('counts repeated data and last partial replay once',()=>{
  const {result,stats,manifest}=fixture();verifyAccounting(result,stats,manifest);
});
test('rejects incomplete aggregate or residual state',()=>{
  const {result,stats,manifest}=fixture();stats.cloud.pending=1;
  assert.throws(()=>verifyAccounting(result,stats,manifest));
});
test('rejects summing intermediate bytes into input',()=>{
  const {result,stats,manifest}=fixture();result.signalBytes=80;
  assert.throws(()=>verifyAccounting(result,stats,manifest));
});
