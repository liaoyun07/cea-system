import test from 'node:test';
import assert from 'node:assert/strict';
import {initialAllocation,assertBudget,changedAllocation,parseServiceStats,loadPodSpec,validateProcessing,businessSummary,experimentConfig,parseNetworkCounters,networkDelta,auditContainers,experimentProtocol,hc16Sequence,validateTrialParameters,hc17Sequence,fixturePrepareArgs,validateFixtureFormat,assertConfirmationGate} from './run.mjs';

test('initial allocation stays within 16-core host minus reserve',()=>{assertBudget(initialAllocation,16);assert.throws(()=>assertBudget(initialAllocation,15));});
test('single business increase requires spare quota and leaves other services untouched',()=>{
  assert.throws(()=>changedAllocation(initialAllocation,'edge-a',3,2048,16,'HC-14'));
  const lowerLoad=changedAllocation(initialAllocation,'load',6,5120,16,'HC-14'),raised=changedAllocation(lowerLoad,'edge-a',3,2048,16,'HC-14');
  assert.equal(raised['edge-a'].cpu,3);assert.deepEqual(raised['edge-b'],initialAllocation['edge-b']);assert.equal(raised.load.cpu,6);assert.equal(initialAllocation.load.cpu,7);
});
test('resource changes cannot target old services or raise k6 RAM',()=>{
  assert.throws(()=>changedAllocation(initialAllocation,'backend',3,2048,16));assert.throws(()=>changedAllocation(initialAllocation,'load',6,6144,16));
  assert.throws(()=>changedAllocation(initialAllocation,'edge-a',1,2048,16));
});
test('k6 Pod keeps fixed arrival rate, explicit VU ceilings and real limit capture',()=>{
  const p=loadPodSpec('probe','10s',32,32,{},initialAllocation),c=p.spec.containers[0],env=Object.fromEntries(c.env.map(x=>[x.name,x.value]));
  assert.equal(env.RATE,'273');assert.equal(env.DURATION,'10s');assert.equal(env.PRE_ALLOCATED_VUS,'32');assert.equal(env.MAX_VUS,'32');
  assert.equal(p.metadata.namespace,experimentConfig(process.env.HC_EXPERIMENT||'HC-14',process.env.HC_REVISION).namespace);assert.deepEqual(c.resources.limits,{cpu:'7',memory:'5120Mi'});assert(c.command[2].includes('/sys/fs/cgroup/cpu.max'));
});
test('32 and 48 VU Pods differ only in explicit concurrency environment',()=>{
  const baseline=loadPodSpec('same','30s',32,32,{},initialAllocation),candidate=loadPodSpec('same','30s',48,48,{},initialAllocation);
  const env=Object.fromEntries(candidate.spec.containers[0].env.map(row=>[row.name,row.value]));
  assert.equal(env.GOMEMLIMIT,'4096MiB');assert.equal(env.GOGC,'50');assert.equal(env.PRE_ALLOCATED_VUS,'48');assert.equal(env.MAX_VUS,'48');
  for(const row of candidate.spec.containers[0].env)if(['PRE_ALLOCATED_VUS','MAX_VUS'].includes(row.name))row.value='32';
  assert.deepEqual(candidate,baseline);
});
test('console stats parser handles quoted JSON and escaped trailing newline',()=>{
  const message='HC14_STATS cloud '+JSON.stringify({completed:1,stages:{message:'a "b"'}})+'\n';
  const parsed=parseServiceStats('time=x level=info msg='+JSON.stringify(message)+' source=console','HC14');assert.equal(parsed.cloud.completed,1);assert.equal(parsed.cloud.stages.message,'a "b"');
});
function evidence(){
  const manifest=[{expected:{inputBytes:100}}],stats=Object.fromEntries(['edge-a','edge-b','edge-c','cloud'].map(c=>[c,{completed:2,inputBytes:c==='cloud'?200:c==='edge-c'?80:60,errors:0,pending:0,unconsumed:0}]));
  const result={seconds:1,signalBytes:200,batches:2,started:2,failed:0,GBps:200/1e9,uploadStarted:2,initiatedSignalBytes:200,droppedIterations:1,lateUploadStarts:0,plannedBatches:3,offeredLoadAchieved:false};
  return {manifest,stats,result};
}
test('drops preserve valid processed throughput but cannot claim full offered load',()=>{
  const {manifest,stats,result}=evidence();validateProcessing(result,stats,manifest);result.offeredLoadAchieved=true;assert.throws(()=>validateProcessing(result,stats,manifest));
});
test('business/request failures invalidate processing evidence',()=>{const {manifest,stats,result}=evidence();stats['edge-a'].errors=1;assert.throws(()=>validateProcessing(result,stats,manifest));});
test('started byte count must not be substituted for completed throughput',()=>{const {manifest,stats,result}=evidence();result.initiatedSignalBytes=300;assert.throws(()=>validateProcessing(result,stats,manifest));});
test('known arrival boundary still requires actual successful byte-prefix accounting',()=>{
  const {manifest,stats,result}=evidence();
  const count=2731;for(const [c,s] of Object.entries(stats)){s.completed=count;s.inputBytes=count*(c==='cloud'?100:c==='edge-c'?40:30);}
  Object.assign(result,{batches:count,started:count,uploadStarted:count,signalBytes:count*100,initiatedSignalBytes:count*100,GBps:count*100/1e9,
    rate:273,durationSeconds:10,plannedBatches:2730,plannedSignalBytes:273000,droppedIterations:0,offeredLoadAchieved:true});
  validateProcessing(result,stats,manifest);
  result.signalBytes=273000;assert.throws(()=>validateProcessing(result,stats,manifest));
});
test('business evidence distinguishes true cgroup memory from working set and records limit events',()=>{
  const stats={cloud:{samples:[{at:1,cpuUsec:0,throttledUsec:0,workingSetBytes:2**20,memoryBytes:3*2**20},{at:2,cpuUsec:1900000,throttledUsec:1000,workingSetBytes:2*2**20,memoryBytes:4*2**20}]}};
  const before={cloud:{uid:'one',memoryEvents:{max:3,oom:0}}},after={cloud:{uid:'one',memoryEvents:{max:8,oom:0}}};
  const r=businessSummary(stats,initialAllocation,before,after).cloud;
  assert.equal(r.peakMiB,2);assert.equal(r.peakMemoryCurrentMiB,4);assert.equal(r.meanCpuQuotaPercent,95);assert.equal(r.memoryEventsDelta.max,5);assert.equal(r.samePod,true);
});
test('HC15 revisions isolate image, namespace and evidence root without changing HC14',()=>{
  const previous=experimentConfig(),diagnostic=experimentConfig('HC-15','diagnostic'),fixed=experimentConfig('HC-15','fixed');
  assert.equal(previous.batch,'hc14-20261017');assert.equal(previous.image,'cea/hydraulic-resident:hc05-v1');assert.equal(previous.nodePort,31094);
  assert.equal(diagnostic.image,'cea/hydraulic-resident:hc15-diagnostic');assert.equal(fixed.image,'cea/hydraulic-resident:hc15-fixed');
  assert.notEqual(diagnostic.batch,fixed.batch);assert.notEqual(diagnostic.namespace,fixed.namespace);assert.equal(fixed.nodePort,31095);
  assert.throws(()=>experimentConfig('HC-15'));assert.throws(()=>experimentConfig('HC-15','retry'));
});
test('HC16 isolates the concurrency comparison while retaining the fixed HC15 image',()=>{
  const previous=experimentConfig('HC-15','fixed'),current=experimentConfig('HC-16');
  assert.equal(current.batch,'hc16-20261017');assert.equal(current.namespace,'cea-hc16-20261017');assert.equal(current.nodePort,31096);
  assert.equal(current.image,previous.image);assert.equal(current.logPrefix,'HC16');assert.notEqual(current.batch,previous.batch);
  assert.deepEqual(experimentConfig('HC-16','fixed'),current);assert.throws(()=>experimentConfig('HC-16','diagnostic'));
  assert.throws(()=>changedAllocation(initialAllocation,'load',6,5120,16,'HC-16'));
  assert.throws(()=>changedAllocation(initialAllocation,'edge-a',3,2048,18,'HC-16'));
});
test('HC16 freezes only the authorized 32/48/32 sequence, not historical confirmation rules',()=>{
  const protocol=experimentProtocol('HC-16');assert.equal(protocol.rate,273);assert.equal(protocol.confirmRepetitions,undefined);
  assert.deepEqual(protocol.sequence.map(row=>[row.label,row.duration,row.preVUs,row.maxVUs]),[
    ['warmup-32','10s',32,32],['baseline-32','30s',32,32],['probe-48','10s',48,48],['candidate-48','30s',48,48],['return-32','30s',32,32]
  ]);
  for(const row of hc16Sequence)validateTrialParameters(row.label,row.duration,row.preVUs,row.maxVUs,'HC-16');
  assert.throws(()=>validateTrialParameters('confirm-1','60s',32,32,'HC-16'));
  assert.throws(()=>validateTrialParameters('candidate-48','30s',32,48,'HC-16'));
  assert.throws(()=>validateTrialParameters('candidate-48','60s',48,48,'HC-16'));
  validateTrialParameters('confirm-1','60s',32,32,'HC-15');
});
test('HC17 phases isolate evidence while baseline and return keep the original fixed image',()=>{
  const phases=['baseline','views','return'].map(revision=>experimentConfig('HC-17',revision));
  assert.equal(new Set(phases.map(p=>p.namespace)).size,3);assert.equal(new Set(phases.map(p=>p.batch)).size,3);
  assert(phases.every(p=>p.nodePort===31097&&p.logPrefix==='HC17'));
  assert.equal(phases[0].image,'cea/hydraulic-resident:hc15-fixed');assert.equal(phases[2].image,phases[0].image);
  assert.equal(phases[1].image,'cea/hydraulic-resident:hc17-views');assert.equal(phases[1].batch,'hc17-views-20261017');
  assert.throws(()=>experimentConfig('HC-17'));assert.throws(()=>experimentConfig('HC-17','fixed'));
  assert.throws(()=>changedAllocation(initialAllocation,'load',6,5120,16,'HC-17'));
});
test('only HC17 views passes a new fixture format argument; legacy images receive their original command',()=>{
  for(const revision of ['baseline','return'])assert.deepEqual(fixturePrepareArgs('HC-17',revision),['prepare','/source','/fixtures']);
  assert.deepEqual(fixturePrepareArgs('HC-17','views'),['prepare','/source','/fixtures','arrays']);
  assert.deepEqual(fixturePrepareArgs('HC-15','fixed'),['prepare','/source','/fixtures']);
  const old=[{files:[{name:'x.npz',length:8}]}],views=[{files:[{name:'x.arrays',length:8,contentType:'application/vnd.cea.hydraulic-arrays'}]}];
  validateFixtureFormat(old,'HC-17','baseline');validateFixtureFormat(old,'HC-17','return');validateFixtureFormat(views,'HC-17','views');
  assert.throws(()=>validateFixtureFormat(old,'HC-17','views'));assert.throws(()=>validateFixtureFormat(views,'HC-17','baseline'));
});
test('HC17 allows only fixed 32 VU phase steps and views-only optional confirmations',()=>{
  for(const revision of ['baseline','views','return']){
    const sequence=hc17Sequence(revision);assert.equal(sequence.length,revision==='views'?5:2);
    assert.equal(experimentProtocol('HC-17',revision).optionalConfirmations,revision==='views');
    for(const row of sequence)validateTrialParameters(row.label,row.duration,row.preVUs,row.maxVUs,'HC-17',revision);
    assert.throws(()=>validateTrialParameters('compare-30s','30s',48,48,'HC-17',revision));
  }
  for(const revision of ['baseline','return'])assert.throws(()=>validateTrialParameters('confirm-1','60s',32,32,'HC-17',revision));
  assert.throws(()=>validateTrialParameters('confirm-4','60s',32,32,'HC-17','views'));
});
test('HC17 optional confirmations require explicit review plus zero-error measured short-run gain',()=>{
  const base={run:'compare-30s',processingValid:true,failed:0,started:100,batches:100,exitCode:0,durationSeconds:30,preAllocatedVUs:32,maxVUs:32,rate:273,allocation:initialAllocation,GBps:1.4};
  const views={...base,GBps:1.8};assertConfirmationGate(base,views,'1');
  assert.throws(()=>assertConfirmationGate(base,views,undefined),/explicit review approval/);assert.throws(()=>assertConfirmationGate(base,{...views,GBps:1.3},'1'));
  assert.throws(()=>assertConfirmationGate(base,{...views,failed:1},'1'));assert.throws(()=>assertConfirmationGate(base,{...views,processingValid:false},'1'));
  assert.throws(()=>assertConfirmationGate(base,{...views,allocation:{...initialAllocation,load:{cpu:6,memoryMiB:5120}}},'1'));
});
test('TCP evidence parses paired raw counters and reports relevant same-Pod deltas',()=>{
  const beforeCounters=parseNetworkCounters('TcpExt: ListenOverflows ListenDrops TCPAbortOnData\nTcpExt: 4 5 0\nTcp: OutRsts EstabResets\nTcp: 8 1\n');
  const afterCounters=parseNetworkCounters('TcpExt: ListenOverflows ListenDrops TCPAbortOnData\nTcpExt: 6 7 3\nTcp: OutRsts EstabResets\nTcp: 12 2\n');
  const before={cloud:{uid:'same',containerId:'x',counters:beforeCounters}},after={cloud:{uid:'same',containerId:'x',counters:afterCounters}};
  const delta=networkDelta(before,after).cloud;assert.equal(delta.counters['TcpExt.ListenOverflows'],2);assert.equal(delta.counters['Tcp.OutRsts'],4);assert.equal(delta.sameContainer,true);
  after.cloud.uid='replaced';assert.equal(networkDelta(before,after).cloud.counters,null);
  assert.throws(()=>parseNetworkCounters('Tcp: A B\nTcp: 1\n'));
});
test('HC15 stats prefix is explicit and does not accidentally consume old experiment logs',()=>{
  const log='time=x msg='+JSON.stringify('HC15_STATS cloud {"completed":4}\n')+' source=console';
  assert.equal(parseServiceStats(log,'HC15').cloud.completed,4);assert.deepEqual(parseServiceStats(log,'HC14'),{});
});
test('HC16 stats are isolated from HC15 log identity',()=>{
  const log='time=x msg='+JSON.stringify('HC16_STATS cloud {"completed":4}\n')+' source=console';
  assert.equal(parseServiceStats(log,'HC16').cloud.completed,4);assert.deepEqual(parseServiceStats(log,'HC15'),{});
});
test('HC17 stats are isolated and no HC17 phase inherits an old-container audit exception',()=>{
  const log='time=x msg='+JSON.stringify('HC17_STATS cloud {"completed":4}\n')+' source=console';
  assert.equal(parseServiceStats(log,'HC17').cloud.completed,4);assert.deepEqual(parseServiceStats(log,'HC16'),{});
  const old={name:'/cea-cloud-1',id:'old'};
  for(const revision of ['baseline','views','return']){
    assert.deepEqual(auditContainers([old],[old],'HC-17',revision).excludedBatchContainers,[]);
    assert.throws(()=>auditContainers([old],[],'HC-17',revision));
  }
});
test('audit excludes only the exact completed HC15 diagnostic unit container and preserves its snapshot evidence',()=>{
  const old={name:'/cea-cloud-1',id:'old',running:true};
  const unit={name:'/cea-hc15-service-unit-20261017',id:'388aa4d3a57c2fb9898e79b7a432de42bbf18f143f4620e37f1f68defee4df1d',running:true};
  const before=[unit,old],audit=auditContainers(before,[old],'HC-15','diagnostic');
  assert.equal(before.length,2);assert.equal(audit.beforeContainers,2);assert.equal(audit.oldContainers,1);assert.deepEqual(audit.excludedBatchContainers,[unit]);
  assert.throws(()=>auditContainers(before,[old],'HC-15','fixed'));
  assert.throws(()=>auditContainers(before,[old],'HC-14',null));
  assert.throws(()=>auditContainers([{...unit,id:'different'},old],[old],'HC-15','diagnostic'));
  assert.throws(()=>auditContainers([{...unit,name:'/cea-hc15-service-unit-other'},old],[old],'HC-15','diagnostic'));
  assert.throws(()=>auditContainers(before,before,'HC-15','diagnostic'));
  assert.throws(()=>auditContainers(before,[{...old,running:false}],'HC-15','diagnostic'));
});
