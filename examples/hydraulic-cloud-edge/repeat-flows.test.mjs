import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {parse} from '../../frontend/node_modules/yaml/dist/index.js';

for(const passes of [1,5,10]) for(const mode of ['central','distributed']) {
  test(`${mode}: ${passes} real file passes in fixed Job topology`, async()=>{
    const source=await fs.readFile(new URL(`flow-repeat-${mode}-${passes}.yaml`,import.meta.url),'utf8');
    assert.doesNotMatch(source, /[&*]a\d+/);
    const flow=parse(source);
    assert.equal(flow.id,`hydraulic-${mode}-repeat${passes}`);
    const tasks=mode==='central'?flow.tasks:[...flow.tasks[0].tasks,flow.tasks[1]];
    assert.equal(tasks.length,mode==='central'?1:4);
    for(const task of tasks) {
      const c=task.container;
      const edge=task.id.startsWith('edge_');
      assert.equal(c.version,passes===10&&!edge?'hc04-reference-v1':'hc04-v1');
      assert.equal(Object.keys(c.inputFiles).length,edge?passes:3*passes+(passes===10?0:1));
      assert.ok(Object.keys(c.inputFiles).length<=30);
      assert.equal(c.outputFiles.length,passes+(edge?1:2));
      for(let i=0;i<passes;i++) {
        assert.ok(c.outputFiles.includes(`${edge?'features':'anomalies'}-${i}.npz`));
        for(const group of edge?['raw']:['edge-a','edge-b','edge-c']) {
          const binding=c.inputFiles[`${group}-${i}.npz`];
          assert.ok(binding);
          if(binding.source==='TASK_OUTPUT') assert.equal(binding.port,`features-${i}.npz`);
          else assert.ok(binding.value.endsWith(`${group==='raw'?task.id.replace('_','-'):group}.npz`));
        }
      }
      if(passes===10&&!edge) assert.equal(c.parameters.REFERENCE.value,'hydraulic-reference/hc01-v1');
    }
    assert.equal(flow.outputs.firstBatch.port,'anomalies-0.npz');
  });
}
