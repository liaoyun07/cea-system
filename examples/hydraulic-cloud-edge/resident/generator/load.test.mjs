import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {crc32c} from './integrity.mjs';

test('CRC32C matches standard check and detects corruption',()=>{
  assert.equal(crc32c(Buffer.from('123456789')),'e3069283');
  assert.equal(crc32c(Buffer.alloc(0)),'00000000');
  assert.notEqual(crc32c(Buffer.from('123456788')),'e3069283');
});
const source=readFileSync(new URL('load.js',import.meta.url),'utf8').replace(/^import .*;\r?$/gm,'')
  .replace('export const options','const options').replace('export default async function()','async function run()').replaceAll('export function ','function ');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
async function exercise(mode,bad=false,shortRead=false){
  const metrics={},requests=[],identities=[];let checks=0;
  const contents=Array.from({length:2},(_,i)=>[0,1,2].map(g=>Buffer.alloc(i?3:8,g+1+i*3)));
  const manifest=contents.map((files,i)=>({files:files.map((b,g)=>({name:i+'-'+g,length:b.length,crc32c:crc32c(b)})),expected:{inputBytes:i?6:20}}));
  class Metric{constructor(name){this.name=name;metrics[name]=[];}add(v){metrics[this.name].push(v);}}
  const state={scenario:{iterationInTest:0}};
  const http={batch(items){identities.push(items.map(v=>v[2]));return items.map((r,g)=>{
    const bytes=Buffer.from(r[2]);requests.push({bytes:Buffer.from(bytes),params:r[3]});
    const checksum=crc32c(bytes);return {status:bad&&g===1?400:200,body:'bad',json:()=>({bytes:bytes.length,crc32c:checksum})};
  });}};
  const initialize=new AsyncFunction('http','check','exec','Counter','Trend','fsOpen','SeekMode','open','__ENV','console',source+';return {run};');
  const module=await initialize(http,v=>checks+=Number(v),state,Metric,Metric,async filename=>{
    const [i,g]=filename.split('/').at(-1).split('-').map(Number);
    return {seek:async()=>{},read:async b=>{b.set(contents[i][g]);return shortRead?b.length-1:b.length;}};
  },{Start:0},()=>JSON.stringify(manifest),{MODE:mode,VUS:'12',DURATION:'30s',RUN:'test',ENDPOINTS:JSON.stringify({'edge-a':'a','edge-b':'b','edge-c':'c'})},{log:()=>{},error:()=>{}});
  let thrown;
  try{for(const i of [0,1,2]){state.scenario.iterationInTest=i;await module.run();}}catch(e){thrown=e;}
  return {metrics,requests,identities,checks,contents,thrown};
}
test('reuse preserves group contents and exact short-batch lengths',async()=>{
  const r=await exercise('reuse');assert.equal(r.checks,3);
  for(let i=0;i<3;i++)for(let g=0;g<3;g++)assert.deepEqual(r.requests[i*3+g].bytes,r.contents[i%2][g]);
  assert.notEqual(r.identities[0][0],r.identities[0][1]);
  assert.equal(r.identities[0][0],r.identities[2][0]);
  assert.equal(r.identities[1][0].byteLength,3);
  assert.deepEqual(r.metrics.confirmed_signal_bytes,[20,6,20]);
  assert.deepEqual(r.metrics.confirmed_payload_bytes,[24,9,24]);
});
test('legacy still allocates distinct buffers with identical accounting',async()=>{
  const r=await exercise('legacy');assert.notEqual(r.identities[0][0],r.identities[2][0]);
  assert.deepEqual(r.metrics.confirmed_signal_bytes,[20,6,20]);
});
test('failed receiver acknowledgement is never counted as completed',async()=>{
  const r=await exercise('reuse',true);assert.equal(r.checks,0);
  assert.deepEqual(r.metrics.completed_batches,[]);assert.deepEqual(r.metrics.confirmed_signal_bytes,[]);
  assert.deepEqual(r.metrics.failed_batches,[1,1,1]);
});
test('fixture short read fails the run rather than silently omitting a batch',async()=>{
  const r=await exercise('reuse',false,true);
  assert.match(String(r.thrown),/short fixture read/);assert.equal(r.requests.length,0);
  assert.deepEqual(r.metrics.failed_batches,[1]);assert.equal(r.checks,0);
});
