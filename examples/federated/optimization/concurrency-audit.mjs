// Read-only Job, SDK, image and startup audit after the timed concurrency runs.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {intervals} from '../parallel-benchmark/run.mjs';
const batch=process.argv[2]??'par09';assert(['par09','par10','par11'].includes(batch));
const includeLaunch=process.argv[3]==='launch';
const count=batch==='par09'?9:18,runs=batch==='par10'?1:4;
const folder=resolve(import.meta.dirname,`../../../.local/cea/${batch}`);
const images=JSON.parse(await readFile(resolve(folder,'../par08/images.json'),'utf8'));
const rows=[],copies=[],launchWarnings=[];let totalReports=0;
for(let i=0;i<runs;i++){
  const trial=JSON.parse(await readFile(resolve(folder,`trial-${i}.json`),'utf8'));
  assert.equal(trial.execution.state,'SUCCESS');assert.equal(trial.reports.length,2*count+3);
  const reports=trial.reports.map(r=>r.report);totalReports+=reports.length;
  const union=intervals(reports);assert(Math.abs(union.activeSeconds-trial.measurement.activeSeconds)<1e-8);
  for(const [field,key] of [['inputs','inputBytes'],['outputs','outputBytes']])
    assert.equal(reports.flatMap(r=>r[field]).reduce((sum,file)=>sum+file.bytes,0),trial.measurement[key]);
  const jobs=[],trainingContainers=[];
  for(const cluster of ['cloud','edge-a','edge-b','edge-c']){
    const leaves=trial.tasks.filter(t=>['init','train','preprocess','aggregate','evaluate'].includes(t.taskId)&&
      (['train','preprocess'].includes(t.taskId)?`edge-${'abc'[(t.iteration-1)%3]}`:'cloud')===cluster);
    const names=leaves.map(t=>{assert.match(t.id,/^[a-f0-9-]{36}$/);return `cea-${t.id}-a1`;});
    const get=kind=>JSON.parse(execFileSync('docker',['exec',`cea-${cluster}-1`,'kubectl','get',kind,...(kind==='jobs'?names:['-l',`job-name in (${names.join(',')})`]),'-n','cea-lab','-o','json'],{encoding:'utf8'})).items;
    const actualJobs=get('jobs'),pods=get('pods');assert.equal(actualJobs.length,leaves.length);assert.equal(pods.length,leaves.length);
    if(includeLaunch){
      const events=JSON.parse(execFileSync('docker',['exec',`cea-${cluster}-1`,'kubectl','get','events','-n','cea-lab','-o','json'],{encoding:'utf8',maxBuffer:20*1024*1024})).items;
      const podNames=new Set(pods.map(p=>p.metadata.name));
      for(const event of events.filter(e=>e.type==='Warning'&&podNames.has(e.involvedObject?.name)))
        launchWarnings.push({executionId:trial.execution.id,cluster,pod:event.involvedObject.name,
          reason:event.reason,message:event.message,first:event.firstTimestamp??event.eventTime,last:event.lastTimestamp,count:event.count??1});
    }
    if(cluster!=='cloud')for(const stage of ['preprocess','train'])assert.equal(leaves.filter(t=>t.taskId===stage).length,count/3);
    for(const task of leaves){
      const name=`cea-${task.id}-a1`,job=actualJobs.find(j=>j.metadata.name===name),pod=pods.find(p=>p.metadata.labels['job-name']===name);
      assert.equal(job.status.succeeded,1);assert.equal(pod.status.phase,'Succeeded');
      if(batch==='par11'){
        assert.equal(job.spec.suspend,false);
        assert(!job.metadata.annotations?.['cea.platform/files-pending'],'Preparation marker must be cleared before running');
      }
      const image=job.spec.template.spec.containers.find(c=>c.name==='task').image;
      if(task.taskId==='train'){
        const env=Object.fromEntries(job.spec.template.spec.containers.find(c=>c.name==='task').env.map(e=>[e.name,e.value]));
        assert.equal(env.CLIENT_ID,`${cluster}${Math.floor((task.iteration-1)/3)+1}`);
        assert.equal(env.BATCH_SIZE,'1024');assert.equal(env.LOCAL_EPOCHS,'1');assert.equal(env.LEARNING_RATE,'0.01');
        assert(!('DATASET' in env),'Prepared train must not reload the dataset catalog');
      }
      const key=['preprocess','train'].includes(task.taskId)?'preprocess':'federated';assert(image.endsWith(images[key].slice(images[key].indexOf('@'))));
      const statuses=[...pod.status.initContainerStatuses,...pod.status.containerStatuses];assert.equal(statuses.length,3);
      for(const status of statuses){assert.equal(status.state.terminated.exitCode,0);assert.equal(status.restartCount,0);}
      const main=statuses.find(s=>s.name==='task').state.terminated;
      if(task.taskId==='train')trainingContainers.push({startedAt:main.startedAt,endedAt:main.finishedAt});
      jobs.push({taskRunId:task.id,taskId:task.taskId,item:task.iteration,cluster,image,jobCreatedAt:job.metadata.creationTimestamp,createdAt:pod.metadata.creationTimestamp,containers:statuses.map(s=>({name:s.name,...s.state.terminated}))});
      if(task.outputs['model.pt']){
        const uri=new URL(task.outputs['model.pt']),bucket=cluster==='cloud'?'cea-artifacts':`cea-artifacts-${cluster}`;
        assert.equal(uri.protocol,'s3:');assert.equal(uri.hostname,bucket);assert.match(uri.pathname,/^\/[A-Za-z0-9/._-]+$/);
        copies.push({source:`${cluster==='cloud'?'local':cluster}/${bucket}${uri.pathname}`,destination:`${batch}/models/${i}/${task.taskId}-${task.iteration}.pt`});
      }
    }
  }
  assert.equal(jobs.length,2*count+3);assert.equal(trainingContainers.length,count);
  rows.push({index:i,executionId:trial.execution.id,warmup:trial.warmup,measurement:trial.measurement,
    trainAlgorithm:intervals(trial.reports.filter(r=>r.taskId==='train').map(r=>r.report)),
    trainContainersSecondPrecision:intervals(trainingContainers),allAlgorithms:union,jobs});
}
assert.equal(copies.length,runs*(count+2));
await writeFile(resolve(folder,includeLaunch?'audit-with-launch.json':'audit.json'),JSON.stringify({result:'PASS',reports:totalReports,jobs:rows.reduce((s,r)=>s+r.jobs.length,0),rows,copies,...(includeLaunch?{launchWarnings}:{})},null,2),{flag:'wx'});
console.log(`PASS: ${totalReports} SDK reports and actual Jobs/digests, no container failures/restarts; train container and algorithm parallelism separated.`);
if(includeLaunch)console.log(`Launch warnings (separate from container exits): ${launchWarnings.length}; sandbox failures: ${launchWarnings.filter(e=>e.reason==='FailedCreatePodSandBox').length}.`);
