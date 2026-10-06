import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {definition,datasets,algorithms,filePath} from './definitions.mjs';
for(const dataset of datasets)for(const algorithm of algorithms)test(`${dataset}/${algorithm}: full 40-round comparison`,()=>{
  const source=algorithm==='gfed-hsam'?undefined:fs.readFileSync(new URL(`../${dataset}-partitions/strong-${algorithm}.yaml`,import.meta.url),'utf8');
  const flow=definition(dataset,algorithm,source);
  assert.equal(flow.inputs.rounds.defaultValue,40);
  assert.equal(flow.inputs.local_epochs.defaultValue,1);
  assert.equal(flow.inputs.training_dataset.defaultValue,`${dataset}-train/strong-noniid-v1`);
  assert.equal(flow.inputs.test_dataset.defaultValue,`${dataset}-test/v1`);
  assert.equal(flow.inputs.model.defaultValue,dataset==='mnist'?'mlp':'cnn');
  assert.equal(flow.inputs.clients.defaultValue.length,3);
  assert.equal(flow.inputs.participation_rate,undefined);
  const repeat=flow.tasks[1],train=repeat.tasks[0].tasks[0];
  assert.deepEqual(train.container.parameters.LOCAL_EPOCHS,{source:'INPUT',name:'local_epochs'});
  for(const task of [flow.tasks[0],train,repeat.tasks[1],repeat.tasks[2]]){
    assert.equal(task.timeout,'PT30M');
    assert(task.container.namespaceFiles);
    if(algorithm==='gfed-hsam')assert.equal(task.container.namespaceFiles['hsam_entry.py'].path,filePath);
  }
});
