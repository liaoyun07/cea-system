import test from 'node:test';
import assert from 'node:assert/strict';
import {balanced,targets} from './balanced-shards.mjs';
import {stringify} from '../../../frontend/node_modules/yaml/dist/index.js';

test('change only raw dataset reference and its contract; never repartition by client count',()=>{
  for(const [i,id] of targets.entries()){
    const original={id,description:'keep',inputs:{raw_training_dataset:{type:'SELECT',values:['cifar10-raw-train/v1'],defaultValue:'cifar10-raw-train/v1'}},
      tasks:[{id:'init'}, {repeat:{iterations:1},tasks:[{loop:{values:['unchanged'],concurrency:[9,18,1,2,3][i]},tasks:[
        {id:'preprocess',container:{applicationId:'fl-preprocess',version:'par08-v1',parameters:{RAW_DATASET:{source:'INPUT',key:'raw_training_dataset'}}}},
        {id:'train',container:{version:'par08-prepared-v1'}}]}]}]};
    const result=balanced(stringify(original));
    assert.equal(result.inputs.raw_training_dataset.defaultValue,'cifar10-raw-train/v2');
    assert.equal(result.tasks[1].tasks[0].tasks[0].container.version,'par13-v1');
    result.inputs.raw_training_dataset=original.inputs.raw_training_dataset;
    result.tasks[1].tasks[0].tasks[0].container.version='par08-v1';assert.deepEqual(result,original);
  }
});
