import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {parse} from '../../../frontend/node_modules/yaml/dist/index.js';
import {connect} from './flows.mjs';
for(const algorithm of ['fedavg','fedcads'])test(`${algorithm} correct partition bindings and unchanged numeric parameters`,()=>{
  const original=parse(fs.readFileSync(new URL(`../flow-duration/${algorithm}.yaml`,import.meta.url),'utf8'));
  const snapshot=structuredClone(original);
  for(const kind of ['equal','strong']){
    const flow=connect(original,algorithm,kind);
    assert.equal(flow.inputs.rounds.defaultValue,40);
    assert.deepEqual(flow.inputs.clients.defaultValue.map(c=>c.weight),kind==='equal'?[1,1,1]:[1,4,15]);
    assert.equal(flow.inputs.training_dataset.values.length,1);
    assert.equal(flow.tasks[1].tasks[0].tasks[0].container.parameters.DATASET.name,'training_dataset');
    assert.equal(flow.tasks[0].container.parameters.TRAINING_DATASET.name,'training_dataset');
    assert.deepEqual(flow.inputs.learning_rate,original.inputs.learning_rate);
    assert.deepEqual(flow.inputs.model,original.inputs.model);
    if(algorithm==='fedcads')assert.deepEqual(flow.tasks[0].container.parameters.ROUNDS,{source:'INPUT',name:'rounds'});
  }
  assert.deepEqual(original,snapshot);
});
