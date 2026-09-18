import test from 'node:test';
import assert from 'node:assert/strict';
import {variant,summarize} from './run.mjs';
import {stringify} from '../../../frontend/node_modules/yaml/dist/index.js';
test('isolated command and output only; preserve inputs, images, dependencies and concurrency',()=>{
 const c=id=>({id,container:{applicationId:id,version:'v1',command:id==='preprocess'?['python','/app/preprocess.py']:['python','/app/linear_app.py',id],outputFiles:['model.pt','cea-measurement.json']}});
 const source={id:'original',inputs:{model:{defaultValue:'linear'},local_epochs:{defaultValue:1},batch_size:{defaultValue:1024},raw_training_dataset:{defaultValue:'cifar10-raw-train/par22-double'}},tasks:[c('init'),{id:'rounds',repeat:{iterations:{value:1}},tasks:[{id:'clients',loop:{concurrency:3,values:{value:[1,2,3]}},tasks:[c('preprocess'),c('train')]},c('aggregate'),c('evaluate')]}]};
 const result=variant(stringify(source),{path:'diagnostics/test.py',revision:1});assert.equal(source.id,'original');assert.equal(result.id,'par24-compute-window');assert.deepEqual(result.inputs,source.inputs);
 const leaves=[result.tasks[0],...result.tasks[1].tasks[0].tasks,...result.tasks[1].tasks.slice(1)];for(const t of leaves){assert.equal(t.container.version,'v1');assert(t.container.outputFiles.includes('compute-profile.json'));assert.deepEqual(t.container.namespaceFiles['compute-profile.py'],{path:'diagnostics/test.py',revision:1});assert(t.container.command.includes(t.id));}
});
test('compute spans use a union, preserve SDK bytes, require every task report',()=>{
 const at=n=>`2026-09-18T00:00:0${n}.000000000Z`,span=(a,b)=>({startedAt:at(a),endedAt:at(b),durationNs:(b-a)*1e9});
 const tasks=['init','preprocess','preprocess','preprocess','train','train','train','aggregate','evaluate'];
 const reports=tasks.map((taskId,i)=>({taskId,taskRunId:String(i),report:{...span(0,4),inputs:[{path:'/in/data',bytes:150}],outputs:[{path:'/out/data',bytes:50}]}}));
 const profiles=tasks.map((taskId,i)=>({taskId,taskRunId:String(i),report:{eagerLoad:true,torchThreads:1,read:span(0,1),compute:span(1,2),write:span(2,3)}}));
 const result=summarize(reports,profiles);assert.equal(result.bytes,1800);assert.equal(result.fullSeconds,4);assert.equal(result.computeSeconds,1);assert.equal(result.computeGBps,1800/1e9);
 assert.throws(()=>summarize(reports,profiles.slice(1)));profiles[0].report.compute.endedAt=at(5);assert.throws(()=>summarize(reports,profiles));
});
