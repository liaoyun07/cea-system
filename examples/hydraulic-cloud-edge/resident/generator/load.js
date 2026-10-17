import http from 'k6/http';
import {check} from 'k6';
import exec from 'k6/execution';
import {Counter,Trend} from 'k6/metrics';
import {open as fsOpen,SeekMode} from 'k6/experimental/fs';

const manifest=JSON.parse(open('/fixtures/manifest.json'));
const urls=JSON.parse(__ENV.ENDPOINTS),groups=['edge-a','edge-b','edge-c'];
const mode=__ENV.MODE;
if(!['legacy','reuse'].includes(mode))throw Error('Unknown sending mode');
const files=[];
// VU-local buffers cannot overlap across simultaneously posted groups.
const buffers=groups.map(()=>new Map());
for(const item of manifest){
  const handles=[];
  for(let g=0;g<3;g++){
    const f=item.files[g];handles.push(await fsOpen('/fixtures/'+f.name));
    if(mode==='reuse'&&!buffers[g].has(f.length))buffers[g].set(f.length,new Uint8Array(f.length));
  }
  files.push(handles);
}
const signalBytes=new Counter('confirmed_signal_bytes'),payloadBytes=new Counter('confirmed_payload_bytes');
const started=new Counter('started_batches'),completed=new Counter('completed_batches'),failed=new Counter('failed_batches');
const firstMs=new Trend('first_send_ms'),lastMs=new Trend('finished_ms'),latency=new Trend('batch_latency_ms',true);
export const options={
  scenarios:{batches:{executor:'constant-vus',vus:Number(__ENV.VUS),duration:__ENV.DURATION,gracefulStop:'30s'}},
  batch:3,batchPerHost:3,discardResponseBodies:true,
  systemTags:['name','status','method','scenario'],summaryTrendStats:['avg','min','max','p(95)','p(99)'],
  thresholds:{checks:['rate==1'],http_req_failed:['rate==0'],failed_batches:['count==0']},
};
export function setup(){
  for(const group of groups){
    const r=http.post(urls[group]+'/reset',null,{responseType:'text',tags:{name:'reset'}});
    if(r.status!==200)throw Error('Receiver reset failed: '+group+' '+r.body);
  }
}
export default async function(){
  const iteration=exec.scenario.iterationInTest,index=iteration%manifest.length,item=manifest[index];
  const payloads=[];
  try{for(let g=0;g<3;g++){
    const f=item.files[g],file=files[index][g];
    const bytes=mode==='reuse'?buffers[g].get(f.length):new Uint8Array(f.length);
    await file.seek(0,SeekMode.Start);
    const size=await file.read(bytes);
    if(size!==bytes.length)throw Error('short fixture read');
    payloads.push(bytes.buffer);
  }}catch(e){failed.add(1);check(false,{'input read complete':v=>v});throw e;}
  const begin=Date.now();firstMs.add(begin);started.add(1);let ok=false;
  try{
    const responses=http.batch(groups.map((g,i)=>['POST',urls[g]+'/ingest',payloads[i],{
      headers:{'Content-Type':'application/octet-stream','X-Expected-Bytes':String(item.files[i].length),'X-Expected-Crc32c':item.files[i].crc32c},
      responseType:'text',timeout:'30s',tags:{name:g},
    }]));
    ok=responses.every((r,i)=>{
      if(r.status!==200){console.error('HC13_ERROR '+JSON.stringify({iteration,group:groups[i],status:r.status,error:r.error,body:String(r.body||'').slice(0,4096)}));return false;}
      const ack=r.json();return ack.bytes===item.files[i].length&&ack.crc32c===item.files[i].crc32c;
    });
    if(ok){signalBytes.add(item.expected.inputBytes);payloadBytes.add(item.files.reduce((s,f)=>s+f.length,0));completed.add(1);}
  }catch(e){console.error(String(e));}
  finally{lastMs.add(Date.now());latency.add(Date.now()-begin);failed.add(ok?0:1);check(ok,{'complete body acknowledged':v=>v});}
}
export function teardown(){
  for(const g of groups){
    const r=http.get(urls[g]+'/stats',{responseType:'text',tags:{name:'stats'}});
    console.log('HC13_STATS '+g+' '+r.body);
  }
}
export function handleSummary(data){
  const m=data.metrics;
  const seconds=(m.finished_ms.values.max-m.first_send_ms.values.min)/1000;
  const report={run:__ENV.RUN,mode,vus:Number(__ENV.VUS),duration:__ENV.DURATION,seconds,
    signalBytes:m.confirmed_signal_bytes?.values.count||0,payloadBytes:m.confirmed_payload_bytes?.values.count||0,
    batches:m.completed_batches?.values.count||0,started:m.started_batches?.values.count||0,failed:m.failed_batches?.values.count||0,
    batchLatencyMs:m.batch_latency_ms.values,httpFailed:m.http_req_failed.values,
    sentBytes:m.data_sent.values.count,receivedBytes:m.data_received.values.count};
  report.GBps=report.signalBytes/seconds/1e9;report.payloadGBps=report.payloadBytes/seconds/1e9;
  console.log('HC13_REPORT '+JSON.stringify(report));
  return {'/output/summary.json':JSON.stringify({report,k6:data},null,2)};
}
