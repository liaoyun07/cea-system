// JOB-USAGE-01: additive, small ordinary workflows; never edits old flows or limits.
import {readFileSync,writeFileSync,mkdirSync,existsSync,copyFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const folder='.local/cea/job-usage-20261017';mkdirSync(folder,{recursive:true});
const env=Object.fromEntries(readFileSync('deploy/cea/.env','utf8').split(/\r?\n/).filter(l=>/^[A-Z_0-9]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const headers={Authorization:'Basic '+Buffer.from(env.BACKEND_USER+':'+env.BACKEND_PASSWORD).toString('base64'),'Content-Type':'application/json'};
const base='http://127.0.0.1:'+(env.CEA_API_PORT||18085)+'/api/namespaces/lab';
async function api(path,body,extra={}) {const r=await fetch(base+path,{headers:{...headers,...extra},method:body?'POST':'GET',body:body?JSON.stringify(body):undefined});assert(r.ok,`${path}: ${r.status} ${r.ok?'':await r.text()}`);return r.json();}
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true,maxBuffer:256*1024*1024}).trim();
const inventory=()=>JSON.parse(docker('inspect',...docker('ps','-q','--filter','label=com.docker.compose.project=cea').split(/\s+/))).map(c=>({name:c.Name,id:c.Id,image:c.Image,started:c.State.StartedAt}));
const save=(name,v)=>writeFileSync(folder+'/'+name,JSON.stringify(v,null,2));
async function all(path){const result=[];for(let offset=0;;offset+=100){const page=await api(path+'?limit=100&offset='+offset);result.push(...page);if(page.length<100)return result;}}
if(process.argv[2]==='capture') {
  assert(!existsSync(folder+'/live-before.json'),'Capture exists; do not replace release evidence');
  const executions=await all('/executions');
  assert(executions.every(e=>['SUCCESS','FAILED','KILLED','SKIPPED'].includes(e.state)),'Active ordinary execution; defer release');
  const services=inventory(),flows=await all('/flows');
  const histories=await Promise.all(flows.map(f=>api('/flows/'+f.flowId)));
  save('live-before.json',{services,executions,flows:histories});
  docker('tag',services.find(c=>c.name==='/cea-backend-1').image,'cea/backend:before-job-usage-20261017');
  copyFileSync('deploy/cea/secrets/backend/storage-endpoints.yaml',folder+'/storage-endpoints-before.yaml');
  const dump=execFileSync('docker',['exec','cea-mysql-1','sh','-c','MYSQL_PWD="$MYSQL_PASSWORD" exec mysqldump -u"$MYSQL_USER" --single-transaction --no-tablespaces cea'],{maxBuffer:512*1024*1024,windowsHide:true});
  assert(dump.length>1000);writeFileSync(folder+'/database-before.sql',dump,{flag:'wx'});
  console.log(JSON.stringify({services:services.length,executions:executions.length,flows:flows.length,backupBytes:dump.length}));
} else if(process.argv[2]==='run') {
  for(const mode of ['success','retry']) {
    const flowId='verify-job-usage-'+mode+'-20261017',receipt=folder+'/'+mode+'-run.json';
    let state=existsSync(receipt)?JSON.parse(readFileSync(receipt)):null;
    if(!state) {
      const container=cluster=>({applicationId:'edge-bearing',version:'ep01-v1',candidateClusters:[cluster],command:['sh','-c',`sleep 1; printf '{"ok":true}' > /cea-work/out/check.json`],outputFiles:['check.json']});
      const tasks=mode==='success'?[{id:'parallel',type:'core.Parallel',tasks:['cloud','edge-a','edge-b','edge-c'].map(cluster=>({id:cluster,type:'platform.Application',timeout:'PT2M',container:container(cluster)}))}]:
        [{id:'failed',type:'platform.Application',timeout:'PT2M',retry:{type:'constant',maxAttempts:2,interval:'PT0.1S'},container:{...container('cloud'),command:['sh','-c','exit 7'],outputFiles:[]}}];
      const revision=await api('/flows/'+flowId+'/revisions',{expectedRevision:0,source:JSON.stringify({schemaVersion:1,namespace:'lab',id:flowId,tasks})});
      state={flowId,revision:revision.revision};save(mode+'-run.json',state);
    }
    if(!state.id){state.id=(await api('/executions',{flowId,revision:state.revision,inputs:{}},{'Idempotency-Key':flowId})).executionId;save(mode+'-run.json',state);}
    for(let i=0;i<120;i++){const execution=await api('/executions/'+state.id);if(['SUCCESS','FAILED','KILLED'].includes(execution.state)){assert.equal(execution.state,mode==='success'?'SUCCESS':'FAILED',execution.error);break;}assert(i<119,'Execution still active');await new Promise(r=>setTimeout(r,2000));}
    const usage=await api('/executions/'+state.id+'/resource-usage');save(mode+'-usage.json',usage);
    assert.equal(usage.attempts,mode==='success'?4:2);assert.equal(usage.status,'COMPLETE',JSON.stringify(usage));
    assert(usage.cpuCoreSeconds>0 && usage.memoryGiBSeconds>0 && usage.averageMemoryGiB>0);
    const tasks=await api('/executions/'+state.id+'/tasks'),evidence=[];
    for(const j of usage.jobs) {
      const attempts=await api('/executions/'+state.id+'/tasks/'+j.taskRunId+'/attempts');
      assert.deepEqual(attempts.find(a=>a.attemptNo===j.attemptNo).resourceUsage,j.usage);
      const cluster=mode==='success'?j.taskId:'cloud';
      const pods=JSON.parse(docker('exec','cea-'+cluster+'-1','kubectl','-n','cea-lab','get','pods','-l','job-name='+j.usage.jobName,'-o','json')).items;
      if(mode==='retry' && pods.length===0) {
        // Existing runner suspends failed Jobs and Kubernetes removes their Pods.
        // The last terminated-container snapshot must still survive in Attempt.
        const job=JSON.parse(docker('exec','cea-'+cluster+'-1','kubectl','-n','cea-lab','get','job',j.usage.jobName,'-o','json'));
        assert.equal(job.metadata.uid,j.usage.jobUid);assert.equal(job.spec.suspend,true);assert.equal(j.state,'FAILED');
        assert(j.usage.podUid);assert(j.usage.containers.every(c=>c.status==='COMPLETE'));
        evidence.push({taskRunId:j.taskRunId,attemptNo:j.attemptNo,podRemoved:true,podUid:j.usage.podUid,jobUid:job.metadata.uid});continue;
      }
      assert.equal(pods.length,1);assert.equal(pods[0].metadata.uid,j.usage.podUid);
      for(const status of [...pods[0].status.initContainerStatuses,...pods[0].status.containerStatuses]) {
        const report=JSON.parse(status.state.terminated.message).resources;
        const saved=j.usage.containers.find(c=>c.name===status.name);
        for(const key of ['cpuCoreSeconds','memoryByteSeconds','durationSeconds','peakMemoryBytes','samples']) {
          if(['peakMemoryBytes','samples'].includes(key))assert.equal(saved[key],report[key]);
          // JSON/MySQL decimal re-encoding can change the final IEEE-754 bit.
          else assert(Math.abs(saved[key]-report[key])<=8*Number.EPSILON*Math.max(1,Math.abs(report[key])),key);
        }
      }
      if(mode==='success') {
        assert.match(tasks.find(t=>t.id===j.taskRunId).outputs['check.json'],/^s3:\/\//);
        assert.deepEqual(await api('/executions/'+state.id+'/tasks/'+j.taskRunId+'/output-json?port=check.json'),{ok:true});
      }
      evidence.push({taskRunId:j.taskRunId,pod:pods[0]});
    }
    save(mode+'-pods.json',evidence);console.log(mode,usage.status,'jobs',usage.attempts,'CPU',usage.cpuCoreSeconds,'memory GiB.s',usage.memoryGiBSeconds);
  }
} else if(process.argv[2]==='cleanup') {
  const removed=[];
  for(const mode of ['success','retry']) {
    const state=JSON.parse(readFileSync(folder+'/'+mode+'-run.json')),saved=JSON.parse(readFileSync(folder+'/'+mode+'-usage.json'));
    assert.deepEqual(await api('/executions/'+state.id+'/resource-usage'),saved);
    for(const j of saved.jobs) {
      const cluster=mode==='success'?j.taskId:'cloud';assert(['cloud','edge-a','edge-b','edge-c'].includes(cluster));
      const job=JSON.parse(docker('exec','cea-'+cluster+'-1','kubectl','-n','cea-lab','get','job',j.usage.jobName,'-o','json'));
      assert.equal(job.metadata.uid,j.usage.jobUid);assert.equal(j.usage.jobName,'cea-'+j.taskRunId+'-a'+j.attemptNo);
      docker('exec','cea-'+cluster+'-1','kubectl','-n','cea-lab','delete','job',j.usage.jobName,'--wait=true');removed.push(j.usage.jobName);
    }
    assert.deepEqual(await api('/executions/'+state.id+'/resource-usage'),saved,'Resource records must survive Job/Pod deletion');
  }
  save('cleanup.json',{removed,recordsPreserved:true});console.log('Removed only',removed.length,'test Jobs; resource records preserved');
} else if(process.argv[2]==='audit') {
  const before=JSON.parse(readFileSync(folder+'/live-before.json')),services=inventory(),executions=await all('/executions');
  for(const c of before.services)if(c.name!=='/cea-backend-1')assert.deepEqual(services.find(a=>a.name===c.name),c);
  for(const old of before.executions)assert.deepEqual(executions.find(e=>e.id===old.id),old);
  for(const old of before.flows)assert.deepEqual(await api('/flows/'+old.flowId),old);
  const historical=before.executions.find(e=>e.state==='SUCCESS');
  if(historical){const usage=await api('/executions/'+historical.id+'/resource-usage');assert.notEqual(usage.status,'COMPLETE');assert.equal(usage.cpuCoreSeconds,null);save('historical-usage.json',usage);}
  save('live-audit.json',{status:'PASS',unchangedServices:before.services.length-1,oldExecutions:before.executions.length,oldFlows:before.flows.length});console.log('Old services, flow revisions and executions preserved');
} else throw Error('Use capture, run, audit or cleanup');
