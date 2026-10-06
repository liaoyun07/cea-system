import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parse} from '../../../frontend/node_modules/yaml/dist/index.js';
for(const algorithm of ['fedavg','fedcads'])test(`${algorithm} actual published 300-round configuration`,()=>{
  const flow=parse(fs.readFileSync(new URL(`./${algorithm}.yaml`,import.meta.url),'utf8'));
  assert.equal(flow.id,`cifar300-strong-${algorithm}`);
  assert.equal(flow.inputs.rounds.defaultValue,300);
  assert.equal(flow.inputs.local_epochs.defaultValue,5);
  assert.equal(flow.inputs.model.defaultValue,'lenet');
  assert.equal(flow.inputs.training_dataset.defaultValue,'cifar10-train/strong-noniid-v1');
  assert.equal(flow.inputs.test_dataset.defaultValue,'cifar10-test/v1');
  assert.deepEqual(flow.inputs.clients.defaultValue.map(c=>c.weight),[2500,10000,37500]);
  assert.equal(flow.inputs.batch_size.defaultValue,128);
  assert.equal(flow.inputs.learning_rate.defaultValue,.1);
  const leaves=[flow.tasks[0],flow.tasks[1].tasks[0].tasks[0],...flow.tasks[1].tasks.slice(1)];
  assert(leaves.every(t=>t.container.version==='cifar300-v1'&&t.timeout==='PT30M'));
  if(algorithm==='fedcads'){
    assert.deepEqual(flow.tasks[0].container.parameters.ROUNDS,{source:'INPUT',name:'rounds'});
    assert.equal(flow.inputs.alpha.defaultValue,.001);
    assert.equal(flow.inputs.rho.defaultValue,.1);
  }
});
