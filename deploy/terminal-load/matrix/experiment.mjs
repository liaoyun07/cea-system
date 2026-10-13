// TERM-SIZE-01: fixed-position nine-case experiment on the existing isolated simulator.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const sim=`${root}/.local/cea/terminal-load`,folder=`${sim}/matrix`;
mkdirSync(folder,{recursive:true});
const env=Object.fromEntries(readFileSync(`${root}/deploy/cea/.env`,'utf8').split(/\r?\n/).filter(l=>/^[A-Z_0-9]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const headers={Authorization:`Basic ${Buffer.from(`${env.BACKEND_USER}:${env.BACKEND_PASSWORD}`).toString('base64')}`,'Content-Type':'application/json',Connection:'close'};
const base=`http://127.0.0.1:${env.CEA_API_PORT}/api/namespaces/lab`;
const read=name=>JSON.parse(readFileSync(`${folder}/${name}.json`,'utf8'));
const save=(name,value)=>writeFileSync(`${folder}/${name}.json`,JSON.stringify(value,null,2));
const docker=args=>execFileSync('docker',args,{cwd:root,encoding:'utf8',maxBuffer:128*1024*1024,windowsHide:true});
const cea=args=>docker(['compose','-p','cea','--env-file',`${root}/deploy/cea/.env`,'-f',`${root}/deploy/cea/compose.yaml`,...args]);
async function api(path,method='GET',body){const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});assert(r.ok,`${path}: ${r.status} ${r.ok?'':await r.text()}`);return r.status===204?null:r.json();}
async function all(path){const result=[];for(let offset=0;;offset+=100){const page=await api(`${path}?limit=100&offset=${offset}`);result.push(...page);if(page.length<100)return result;}}
async function idle(){assert((await all('/executions')).every(e=>['SUCCESS','FAILED','KILLED','SKIPPED'].includes(e.state)),'Active executions');assert((await api('/edge/load/devices')).every(d=>!d.loadRunId),'Active load batch');}
function services(){return JSON.parse(docker(['inspect',...docker(['ps','-q']).trim().split(/\s+/)])).filter(c=>c.Name.startsWith('/cea-')).map(c=>({id:c.Id,name:c.Name,image:c.Image,started:c.State.StartedAt}));}
async function snapshot(){return {services:services(),flows:await Promise.all((await all('/flows')).map(f=>api(`/flows/${f.flowId}`))),policies:await all('/edge/policies'),datasets:await all('/resources/datasets')};}
const mode=process.argv[2];
if(mode==='capture'){
 await idle();assert(!existsSync(`${folder}/before.json`),'already captured');save('before',await snapshot());
 docker(['tag','cea/backend:local','cea/backend:before-size-matrix']);
 for(const name of ['compose.yaml','gateway.json','bootstrap.json'])copyFileSync(`${sim}/${name}`,`${folder}/before-${name}`);
 console.log('Idle baseline and rollback configuration captured.');
}else if(mode==='prepare'){
 assert(existsSync(`${folder}/before.json`));await idle();
 console.log(docker(['build','-t','cea/terminal-agent:size-v1',`${root}/deploy/terminal-agent`]));
 console.log(docker(['build','-t','cea/offload-signal:size-v1',`${root}/deploy/terminal-load/matrix`]));
 docker(['save','-o',`${folder}/agent-image.tar`,'cea/terminal-agent:size-v1']);
 docker(['save','-o',`${folder}/signal-image.tar`,'cea/offload-signal:size-v1']);
 console.log(docker(['exec','cea-terminal-load-engine','docker','load','-i','/sim/matrix/agent-image.tar']));
 console.log(docker(['run','--rm','--network','none','-v',`${sim}:/sim`,'-v',`${root}/deploy/terminal-load/matrix:/source:ro`,'cea/terminal-agent:size-v1','python','/source/prepare.py']));
 console.log(cea(['run','--rm','--no-deps','image-tool','copy','--dest-tls-verify=false','--dest-authfile=/run/secrets/registry-auth.json','docker-archive:/data/terminal-load/matrix/signal-image.tar','docker://registry-center:5000/lab/offload-signal:size-v1']));
 const digest=cea(['run','--rm','--no-deps','image-tool','inspect','--tls-verify=false','--authfile=/run/secrets/registry-auth.json','--format','{{.Digest}}','docker://registry-center:5000/lab/offload-signal:size-v1']).trim();
 assert(/^sha256:[a-f0-9]{64}$/.test(digest));save('image',{digest});
 for(const registry of ['registry-edge-a'])console.log(cea(['run','--rm','--no-deps','image-tool','copy','--all','--preserve-digests','--src-tls-verify=false','--dest-tls-verify=false','--authfile=/run/secrets/registry-auth.json',`docker://registry-center:5000/lab/offload-signal@${digest}`,`docker://${registry}:5000/lab/offload-signal:size-v1`]));
 console.log('Images and exact-size terminal-local files ready.');
}else if(['publish','register','warm'].includes(mode)){
 await idle();
 const digest=read('image').digest;
 if(mode==='publish'){
 console.log(cea(['up','-d','--no-deps','--wait','backend']));
 console.log(cea(['exec','-T','frontend','nginx','-s','reload']));
 const gateway=JSON.parse(readFileSync(`${sim}/gateway.json`,'utf8'));
 gateway.computeEvents=[...new Set([...gateway.computeEvents,...['terminal','edge','cloud'].map(l=>'size-matrix-'+l)])];
 writeFileSync(`${sim}/gateway.json`,JSON.stringify(gateway,null,2));
 const compose=JSON.parse(readFileSync(`${sim}/compose.yaml`,'utf8'));
 mkdirSync(`${folder}/spool`,{recursive:true});
 delete compose.services.gateway.tmpfs;
 compose.services.gateway.volumes=compose.services.gateway.volumes.filter(v=>!v.includes(':/tmp'));
 compose.services.gateway.volumes.push(`${folder}/spool:/tmp`);
 writeFileSync(`${sim}/compose.yaml`,JSON.stringify(compose,null,2));
 console.log(docker(['compose','-p','cea-terminal-load','-f',`${sim}/compose.yaml`,'up','-d','--no-deps','gateway']));
 const bootstrap=JSON.parse(readFileSync(`${sim}/bootstrap.json`,'utf8'));
 bootstrap.agentImage='cea/terminal-agent:size-v1';
 bootstrap.hosts['sim-load-gateway']=JSON.parse(docker(['inspect','cea-terminal-load-gateway']))[0].NetworkSettings.Networks.cea_default.IPAddress;
 writeFileSync(`${sim}/bootstrap.json`,JSON.stringify(bootstrap,null,2));
 console.log(docker(['exec','cea-terminal-load-engine','docker','run','--rm','--privileged','--cgroupns=host','-v','/sys/fs/cgroup:/sys/fs/cgroup','-v','/var/run/docker.sock:/var/run/docker.sock','-v','/sim:/sim','-v','/source:/source:ro','cea/terminal-agent:size-v1','python','/source/bootstrap.py']));
 }
 if(mode!=='warm'){
 await api('/applications/offload-signal/versions/size-v1','PUT',{applicationId:'offload-signal',version:'size-v1',image:`registry-center:5000/lab/offload-signal@${digest}`,parameters:{}});
 for(const layer of ['TERMINAL','EDGE','CLOUD']){
  const id='size-matrix-'+layer.toLowerCase();
  const flow={schemaVersion:1,namespace:'lab',id,description:`5/50/500 MB 分块振动统计：${layer}`,inputs:{data_file:{type:'OBJECT',required:true}},tasks:[{id:'features',type:'platform.Application',timeout:'PT20M',container:{applicationId:'offload-signal',version:'size-v1',execution:'TERMINAL',offload:{strategy:'FIXED',layer},command:['python','/app/app.py'],inputFiles:{'signal.csv':{source:'INPUT',name:'data_file'}},outputFiles:['result.json']}}],outputs:{terminal_result:{source:'TASK_OUTPUT',taskId:'features',port:'result.json'}}};
  await api(`/edge/policies/${id}`,'PUT',{clusterId:'edge-a',eventType:id,enabled:true,expectedRevision:0,source:JSON.stringify(flow)});
 }
 }
 console.log(docker(['exec','cea-terminal-load-engine','docker','exec','-e','PYTHONPATH=/app','sim-terminal-001','python','/source/warm.py','--image',`registry-edge-a:5000/lab/offload-signal@${digest}`]));
 for(const [cluster,registry] of [['cloud','registry-center'],['edge-a','registry-edge-a']]){
  // Reuse private Registry credentials; never print arguments on a preload error.
  const auth=JSON.parse(readFileSync(`${root}/deploy/cea/secrets/backend/registry-auth.json`,'utf8')).auths;
  const credentials=Buffer.from(auth[`${registry}:5000`].auth,'base64').toString();
  try {docker(['exec',`cea-${cluster}-1`,'crictl','pull','--creds',credentials,`${registry}:5000/lab/offload-signal@${digest}`]);}
  catch {throw new Error(`${cluster} image preload failed`);}
 }
 save('published',{at:new Date().toISOString(),digest});console.log('Published; original policies, resource quotas and networks unchanged.');
}else if(mode==='run'){
 await idle();assert(existsSync(`${folder}/published.json`));
 const bootstrap=JSON.parse(readFileSync(`${sim}/bootstrap.json`,'utf8'));
 const environment={at:new Date().toISOString(),terminal:{cpu:bootstrap.cpu,memoryMiB:bootstrap.memoryMiB},clusters:{}};
 for(const cluster of ['edge-a','cloud']){
  const inspected=JSON.parse(docker(['inspect',`cea-${cluster}-1`]))[0];
  environment.clusters[cluster]={outerCpu:inspected.HostConfig.NanoCpus/1e9,outerMemoryBytes:inspected.HostConfig.Memory,
   podRootCpuMax:docker(['exec',`cea-${cluster}-1`,'cat',`/sys/fs/cgroup/cea-${cluster}/cpu.max`]).trim(),
   podRootMemoryMax:docker(['exec',`cea-${cluster}-1`,'cat',`/sys/fs/cgroup/cea-${cluster}/memory.max`]).trim()};
 }
 save('environment',environment);
 for(const file of read('files'))for(const layer of ['terminal','edge','cloud']){
  const receipt=`${sim}/state/sim-terminal-001/matrix/${file.mb}-${layer}.json`;
  if(existsSync(receipt)){const saved=JSON.parse(readFileSync(receipt,'utf8'));assert(saved.resultVerified,`Inspect existing ${receipt}; no automatic rerun`);save(`${file.mb}-${layer}`,saved);continue;}
  console.log(`START ${file.mb} MB / ${layer}`);
  docker(['exec','cea-terminal-load-engine','docker','exec','-e','PYTHONPATH=/app','sim-terminal-001','python','/source/matrix/request.py','--file',file.fileId,'--mb',String(file.mb),'--layer',layer]);
  const result=JSON.parse(readFileSync(receipt,'utf8'));
  save(`${file.mb}-${layer}`,result);console.log(JSON.stringify({mb:file.mb,layer,executionId:result.executionId,elapsedSeconds:result.elapsedSeconds,measurement:result.response.result.measurement}));
 }
}else if(mode==='verify'){
 await idle();const before=read('before'),after=await snapshot();
 const preservedServices=before.services.filter(c=>c.name.startsWith('/cea-')&&!['/cea-backend-1','/cea-terminal-load-gateway'].includes(c.name));
 for(const old of preservedServices)assert.deepEqual(after.services.find(c=>c.name===old.name),old);
 for(const field of ['flows','policies','datasets'])for(const old of before[field])assert(after[field].some(row=>JSON.stringify(row)===JSON.stringify(old)),`Old ${field} changed`);
 const rows=[],observations=await all('/offloading/samples');
 for(const file of read('files'))for(const layer of ['terminal','edge','cloud']){
  const result=read(`${file.mb}-${layer}`);assert(result.resultVerified);
  const execution=await api(`/executions/${result.executionId}`),tasks=await api(`/executions/${result.executionId}/tasks`);
  assert.equal(execution.state,'SUCCESS');assert.equal(tasks.length,1);assert.equal(tasks[0].state,'SUCCESS');
  const observation=observations.find(o=>o.executionId===result.executionId);
  assert.equal(observation.target.kind,layer.toUpperCase());assert(observation.startedAt);assert.equal(observation.outcome,'SUCCESS');
  save(`execution-${file.mb}-${layer}`,{execution,tasks,observation});
  rows.push({mb:file.mb,layer,executionId:result.executionId,elapsedSeconds:result.elapsedSeconds,...result.response.result.measurement});
 }
 save('summary',{result:'PASS',rows,preservedServices:preservedServices.length,oldFlows:before.flows.length});console.log(JSON.stringify(rows,null,2));
}else throw new Error('capture | prepare | publish | register | warm | run | verify');
