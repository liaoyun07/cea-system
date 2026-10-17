import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyAccounting,loadPodSpec,parseReceiverStats} from './run.mjs';

const manifest=[{expected:{inputBytes:100},files:[{length:20},{length:30},{length:60}]},
  {expected:{inputBytes:10},files:[{length:3},{length:4},{length:5}]}];
function data(){return {result:{batches:3,started:3,failed:0,seconds:2,signalBytes:210,payloadBytes:232,GBps:210/2/1e9},
  stats:{'edge-a':{requests:3,bytes:43,failed:0,inflight:0},'edge-b':{requests:3,bytes:64,failed:0,inflight:0},'edge-c':{requests:3,bytes:125,failed:0,inflight:0}}};}
test('parses k6 quoted JSON stats with Go encoder trailing newline',()=>{
  const {stats}=data();
  for(const suffix of ['', '\n']){
    const log=Object.entries(stats).map(([g,s])=>'time="now" level=info msg='+JSON.stringify('HC13_STATS '+g+' '+JSON.stringify(s)+suffix)+' source=console').join('\n');
    assert.deepEqual(parseReceiverStats(log),stats);
  }
});
test('cyclic raw and NPZ payload totals verified separately against all three receivers',()=>{const {result,stats}=data();verifyAccounting(result,stats,manifest);});
test('failed batches cannot be accepted as throughput evidence',()=>{const {result,stats}=data();result.failed=1;assert.throws(()=>verifyAccounting(result,stats,manifest));});
test('receiver byte loss is rejected even if sender totals are correct',()=>{const {result,stats}=data();stats['edge-b'].bytes--;assert.throws(()=>verifyAccounting(result,stats,manifest));});
test('unfinished uploads and lost acknowledgements are rejected',()=>{const {result,stats}=data();stats['edge-c'].inflight=1;assert.throws(()=>verifyAccounting(result,stats,manifest));stats['edge-c'].inflight=0;result.started++;assert.throws(()=>verifyAccounting(result,stats,manifest));});
test('payload bytes cannot replace raw signal bytes in the throughput numerator',()=>{const {result,stats}=data();result.signalBytes=result.payloadBytes;assert.throws(()=>verifyAccounting(result,stats,manifest));});
test('both sending modes keep identical actual CPU RAM and immutable fixture mounting',()=>{
  for(const mode of ['legacy','reuse']){
    const p=loadPodSpec('example',mode,12,'30s',{}),c=p.spec.containers[0];
    assert.deepEqual(c.resources.limits,{cpu:'7',memory:'5120Mi'});
    assert.equal(c.env.find(e=>e.name==='GOMEMLIMIT').value,'4096MiB');
    assert.equal(c.env.find(e=>e.name==='MODE').value,mode);
    assert(c.command[2].includes('/sys/fs/cgroup/cpu.max'));
    assert(c.volumeMounts.filter(v=>v.name==='input').every(v=>v.readOnly));
    assert.equal(p.metadata.namespace,'cea-hc13-20261017');
  }
});
