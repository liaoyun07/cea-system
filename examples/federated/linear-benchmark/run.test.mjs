import assert from 'node:assert/strict';
import test from 'node:test';
import {stringify} from '../../../frontend/node_modules/yaml/dist/index.js';
import {sequence,variant} from './run.mjs';

const task=(id,version)=>({id,container:{applicationId:id,version,command:['python','/app/app.py',id],
  parameters:id==='evaluate'?{BATCH_SIZE:{source:'LITERAL',value:32}}:{},outputFiles:['model.pt','cea-measurement.json']}});
const original={id:'original',inputs:{model:{type:'STRING',defaultValue:'mlp'},batch_size:{defaultValue:1024},
  local_epochs:{defaultValue:1},raw_training_dataset:{defaultValue:'cifar10-raw-train/v2'}},tasks:[task('init','par08-v1'),
  {id:'rounds',repeat:{iterations:{source:'LITERAL',value:1}},tasks:[{id:'clients',loop:{concurrency:6,values:{value:Array.from({length:6},(_,i)=>({id:i,clusters:['edge-'+i%3]}))}},
    tasks:[task('preprocess','par18-v1'),task('train','par08-prepared-v1')]},task('aggregate','par16-v1'),task('evaluate','par08-v1')]}]};
test('baseline preserves model, data, layout, versions and evaluation batch',()=>{
  const f=variant(stringify(original),'baseline');
  assert.deepEqual(f.inputs,original.inputs);assert.deepEqual(f.tasks[0],original.tasks[0]);
  assert.deepEqual(f.tasks[1].tasks.slice(1),original.tasks[1].tasks.slice(1));
  assert.deepEqual(f.tasks[1].tasks[0].loop,original.tasks[1].tasks[0].loop);
  assert(f.tasks[1].tasks[0].tasks[1].container.command.includes('OMP_NUM_THREADS=1'));
});
test('candidate changes explicit model, entrypoints and eval batch, not preprocessing or parallelism',()=>{
  const f=variant(stringify(original),'candidate');
  assert.deepEqual(f.inputs.model,{type:'SELECT',values:['linear'],defaultValue:'linear'});
  assert.deepEqual(f.tasks[1].tasks[0].tasks[0],original.tasks[1].tasks[0].tasks[0]);
  assert.deepEqual(f.tasks[1].tasks[0].loop,original.tasks[1].tasks[0].loop);
  for(const t of [f.tasks[0],f.tasks[1].tasks[0].tasks[1],...f.tasks[1].tasks.slice(1)]){
    assert.equal(t.container.version,'par21-v1');assert(t.container.command.includes('/app/linear_app.py'));
  }
  assert.equal(f.tasks[1].tasks[2].container.parameters.BATCH_SIZE.value,1024);
  assert.deepEqual(f.tasks[1].repeat,original.tasks[1].repeat);
});
test('eight bounded attempts, warmups excluded and AB/BA/AB retained',()=>{
  assert.equal(sequence.length,8);assert(sequence.slice(0,2).every(p=>p.warmup));
  assert(sequence.slice(2).every(p=>!p.warmup));
  assert.deepEqual(sequence.slice(2).map(p=>p.kind),['baseline','candidate','candidate','baseline','baseline','candidate']);
});
