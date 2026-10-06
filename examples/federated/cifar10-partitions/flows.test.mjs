import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {parse} from '../../../frontend/node_modules/yaml/dist/index.js';
import {connectCifar,partitions} from './flows.mjs';
for(const algorithm of ['fedavg','fedcads'])test(`${algorithm} CIFAR partition and CNN bindings`,()=>{
  const original=parse(fs.readFileSync(new URL(`../mnist-partitions/strong-${algorithm}.yaml`,import.meta.url),'utf8'));
  const snapshot=structuredClone(original);
  for(const kind of ['equal','strong']){
    const flow=connectCifar(original,algorithm,kind);
    assert.equal(flow.inputs.model.defaultValue,'cnn');
    assert.equal(flow.inputs.rounds.defaultValue,40);
    assert.deepEqual(flow.inputs.training_dataset.values,[`cifar10-train/${partitions[kind].version}`]);
    assert.deepEqual(flow.inputs.clients.defaultValue.map(c=>c.weight),partitions[kind].weights);
    assert.equal(partitions[kind].weights.reduce((a,b)=>a+b),50000);
    for(const k of ['batch_size','local_epochs','learning_rate','seed'])assert.deepEqual(flow.inputs[k],original.inputs[k]);
    const leaves=[flow.tasks[0],flow.tasks[1].tasks[0].tasks[0],...flow.tasks[1].tasks.slice(1)];
    assert(leaves.every(t=>t.container.version==='cifar-part-v1'));
    if(algorithm==='fedcads')assert.deepEqual(flow.tasks[0].container.parameters.ROUNDS,{source:'INPUT',name:'rounds'});
  }
  assert.deepEqual(original,snapshot);
});
