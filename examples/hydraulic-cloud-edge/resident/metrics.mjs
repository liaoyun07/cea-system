import assert from 'node:assert/strict';

export function verifyAccounting(result,stats,manifest){
  assert.equal(result.failed,0);assert.equal(result.started,result.batches);
  const fullBytes=manifest.reduce((s,m)=>s+m.expected.inputBytes,0);
  const expected=Math.floor(result.batches/manifest.length)*fullBytes+
    manifest.slice(0,result.batches%manifest.length).reduce((s,m)=>s+m.expected.inputBytes,0);
  assert.equal(result.signalBytes,expected,'Cyclic source accounting mismatch');
  assert.equal(stats.cloud.completed,result.batches);assert.equal(stats.cloud.inputBytes,result.signalBytes);
  for(const s of Object.values(stats)){
    assert.equal(s.errors,0);assert.equal(s.completed,result.batches);assert.equal(s.pending,0);assert.equal(s.unconsumed,0);
  }
  assert.equal(['edge-a','edge-b','edge-c'].reduce((sum,g)=>sum+stats[g].inputBytes,0),result.signalBytes);
}

export function resourceSummary(samples){
  assert(samples.length>=2);const first=samples[0],last=samples.at(-1),seconds=last.at-first.at;
  assert(seconds>0);assert(last.cpuUsec>=first.cpuUsec,'Counter reset');
  let integral=0;
  for(let i=1;i<samples.length;i++){
    assert(samples[i].at>=samples[i-1].at,'Nonmonotonic sample');
    integral+=(samples[i].at-samples[i-1].at)*(samples[i].workingSetBytes+samples[i-1].workingSetBytes)/2;
  }
  return {seconds,cpuSeconds:(last.cpuUsec-first.cpuUsec)/1e6,meanCores:(last.cpuUsec-first.cpuUsec)/1e6/seconds,
    averageMiB:integral/seconds/2**20,peakMiB:Math.max(...samples.map(x=>x.workingSetBytes))/2**20,
    throttleSeconds:(last.throttledUsec-first.throttledUsec)/1e6};
}
