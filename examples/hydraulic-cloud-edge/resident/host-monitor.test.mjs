import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hostStopReasons,hostSummary} from './host-monitor.mjs';
const sample=(at,busy=40,available=4096)=>({at,linux:{busyPercent:busy,ioWaitPercent:0,MemAvailable:available*2**20,oom_kill:0,pswpin:0,pswpout:0,
  psi:{memory_full:{avg10:0},io_full:{avg10:0}}},windows:{cpuPercent:busy,availableMiB:available,pagesInputPerSec:0}});
test('healthy and isolated short CPU spikes do not stop',()=>assert.deepEqual(hostStopReasons([sample(0),sample(4000,99),sample(9000)]),[]));
test('sustained CPU bottleneck stops escalation',()=>assert.match(hostStopReasons([sample(0,95),sample(4000,95),sample(9000,95)]).join(),/CPU/));
test('critical memory and OOM stop immediately',()=>{const s=sample(1000,40,400);s.linux.oom_kill=1;assert.equal(hostStopReasons([sample(0),s]).length,2);});
test('sustained low memory stops',()=>assert.match(hostStopReasons([sample(0,40,1200),sample(4000,40,1200),sample(9000,40,1200)]).join(),/memory/));
test('sustained memory PSI stops even with available memory',()=>{
  const samples=[sample(0),sample(4000),sample(9000)];
  for(const s of samples)s.linux.psi.memory_full.avg10=8;
  assert.match(hostStopReasons(samples).join(),/memory stalls/);
});
test('IO stop requires both sustained stalls and IO wait',()=>{
  const samples=[sample(0),sample(4000),sample(9000)];
  for(const s of samples)s.linux.psi.io_full.avg10=8;
  assert.deepEqual(hostStopReasons(samples),[]);
  for(const s of samples)s.linux.ioWaitPercent=15;
  assert.match(hostStopReasons(samples).join(),/IO stalls/);
});
test('Windows paging stop requires low available memory too',()=>{
  const samples=[sample(0),sample(4000),sample(9000)];
  for(const s of samples)s.windows.pagesInputPerSec=3000;
  assert.deepEqual(hostStopReasons(samples),[]);
  for(const s of samples)s.windows.availableMiB=1500;
  assert.match(hostStopReasons(samples).join(),/paging/);
});
test('summary separates host from container metrics',()=>{const r=hostSummary([sample(0,20),sample(9000,60)]);assert.equal(r.linuxMeanBusyPercent,40);assert.equal(r.linuxMinAvailableMiB,4096);});
test('cloud node limit events are deltas, not lifetime counts',()=>{
  const samples=[sample(0),sample(9000)];
  samples.forEach((s,i)=>s.cloudNode={'memory.max':4*2**30,'memory.current':(2+i)*2**30,events_max:60000+i*3,pressure_full:{avg10:i}});
  const r=hostSummary(samples).cloudNode;
  assert.equal(r.limitEventsDelta,3);assert.equal(r.memoryLimitMiB,4096);assert.equal(r.peakMiB,3072);
});
test('capacity policy records pressure and full CPU without stopping a within-memory trial',()=>{
  const samples=[sample(0,100,1100),sample(4000,100,1100),sample(9000,100,1100)];
  for(const s of samples){s.linux.psi.memory_full.avg10=12;s.linux.psi.io_full.avg10=15;s.linux.ioWaitPercent=20;s.windows.pagesInputPerSec=3000;}
  assert.deepEqual(hostStopReasons(samples,'capacity'),[]);
  const r=hostSummary(samples,'capacity');assert.equal(r.linuxMaxMemoryFullAvg10,12);assert.deepEqual(r.stopReasons,[]);
  assert(hostStopReasons(samples).length>0);
});
test('capacity policy still stops at host OOM or critical Windows/Linux available memory',()=>{
  const first=sample(0),oom=sample(9000);oom.linux.oom_kill=1;
  assert.match(hostStopReasons([first,oom],'capacity').join(),/OOM/);
  const linux=sample(9000);linux.linux.MemAvailable=511*2**20;
  assert.match(hostStopReasons([first,linux],'capacity').join(),/512/);
  const windows=sample(9000);windows.windows.availableMiB=511;
  assert.match(hostStopReasons([first,windows],'capacity').join(),/512/);
});
