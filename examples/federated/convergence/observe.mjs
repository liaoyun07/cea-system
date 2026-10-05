// Read-only diagnostic log follower for this batch's active Job containers.
// Logs stay in ignored local evidence; credentials/Pod specs are not exported.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../../..'),folder=path.join(root,'.local/cea/conv01/cea-1');
const settings=Object.fromEntries((await fs.readFile(path.join(root,'deploy/cea/.env'),'utf8')).split(/\r?\n/)
  .filter(l=>l&&!l.startsWith('#')).map(l=>{const at=l.indexOf('=');return [l.slice(0,at),l.slice(at+1)];}));
const auth=`Basic ${Buffer.from(`${settings.BACKEND_USER}:${settings.BACKEND_PASSWORD}`).toString('base64')}`;
const base=`http://127.0.0.1:${settings.CEA_API_PORT}/api/namespaces/lab`;
const streams=new Map(),done=new Set();
async function json(route){const r=await fetch(base+route,{headers:{Authorization:auth},signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error(`Diagnostic API ${r.status}`);return r.json();}
try{
  while(true){
    try{await fs.access(path.join(folder,'summary.json'));break;}catch{}
    const files=(await fs.readdir(folder)).filter(n=>/^trial-\d+-accepted.json$/.test(n));
    for(const file of files){
      const accepted=JSON.parse(await fs.readFile(path.join(folder,file),'utf8'));
      const execution=await json(`/executions/${accepted.executionId}`);
      if(['SUCCESS','FAILED','KILLED'].includes(execution.state))continue;
      const tasks=await json(`/executions/${accepted.executionId}/tasks`);
      for(const task of tasks.filter(t=>t.state==='RUNNING'&&['init','train','aggregate','evaluate'].includes(t.taskId))){
        if(streams.has(task.id)||done.has(task.id))continue;
        const cluster=task.taskId==='train'?['edge-a','edge-b','edge-c'][task.iteration-1]:'cloud';
        const log=path.join(folder,`diagnostic-${task.id}.log`);
        const child=spawn('docker',['exec',`cea-${cluster}-1`,'kubectl','-n','cea-lab','logs',`job/cea-${task.id}-a1`,
          '--all-containers=true','--prefix=true','--follow','--pod-running-timeout=5s'],{windowsHide:true});
        streams.set(task.id,child);
        let captured=false;
        child.stdout.on('data',data=>{captured=true;fs.appendFile(log,data).catch(()=>{});});
        child.stderr.on('data',data=>fs.appendFile(log,data).catch(()=>{}));
        child.on('exit',code=>{streams.delete(task.id);if(captured&&code===0)done.add(task.id);});
      }
    }
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
}finally{for(const child of streams.values())child.kill();}
console.log('Diagnostic observer stopped; logs retained locally.');
