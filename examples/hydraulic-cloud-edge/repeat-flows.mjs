import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {parse,stringify} from '../../frontend/node_modules/yaml/dist/index.js';

const folder=fileURLToPath(new URL('.',import.meta.url));
for(const passes of [1,5,10]) for(const mode of ['central','distributed']) {
  const flow=parse(await fs.readFile(`${folder}flow-${mode}.yaml`,'utf8'));
  flow.id=`hydraulic-${mode}-repeat${passes}`;
  flow.description=`HC-04 ${passes} complete dataset passes, 2205 unique cycles, same one/four Jobs.`;
  const leaves=mode==='central'?flow.tasks:[...flow.tasks[0].tasks,flow.tasks[1]];
  for(const task of leaves) {
    const c=task.container;
    c.version='hc04-v1';
    const operation=c.command.at(-1);
    c.command=['python','/app/repeat.py',operation,'--passes',String(passes)];
    const previous=c.inputFiles;
    c.inputFiles={};
    for(let batch=0;batch<passes;batch++) for(const [name,binding] of Object.entries(previous)) {
      if(name==='reference.npz') {c.inputFiles[name]=binding;continue;}
      const key=name.replace('.npz',`-${batch}.npz`);
      c.inputFiles[key]=binding.source==='TASK_OUTPUT'?{...binding,port:`features-${batch}.npz`}:structuredClone(binding);
    }
    c.outputFiles=[...Array.from({length:passes},(_,i)=>`${operation==='edge'?'features':'anomalies'}-${i}.npz`),
      ...(operation==='edge'?[]:['report.json']),'cea-measurement.json'];
    if(passes===10 && operation!=='edge') {
      // Thirty raw/feature bindings already fill the supported inputFiles slots.
      // Prepare the common reference through the existing dataset parameter path.
      c.version='hc04-reference-v1';
      delete c.inputFiles['reference.npz'];
      c.parameters.REFERENCE={source:'LITERAL',value:'hydraulic-reference/hc01-v1'};
      c.command=['sh','-ec',`ln -s "$REFERENCE_PATH" /cea-work/in/reference.npz; exec python /app/repeat.py ${operation} --passes 10`];
    }
  }
  delete flow.outputs.anomalies;
  flow.outputs.firstBatch={source:'TASK_OUTPUT',taskId:mode==='central'?'central':'fusion',port:'anomalies-0.npz'};
  await fs.writeFile(`${folder}flow-repeat-${mode}-${passes}.yaml`,stringify(flow));
}
