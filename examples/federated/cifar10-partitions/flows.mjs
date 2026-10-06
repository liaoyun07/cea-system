import {connect} from '../mnist-partitions/flows.mjs';
export const partitions={equal:{version:'equal-noniid-v1',weights:[16667,16667,16666]},
  strong:{version:'strong-noniid-v1',weights:[2500,10000,37500]}};
export function connectCifar(original,algorithm,kind){
  const flow=connect(original,algorithm,kind),p=partitions[kind];
  flow.id=`cifar10-${kind}-${algorithm}`;
  flow.description=`CIFAR-10 ${p.version}: full 50000 train, official 10000 test; 40-round CNN baseline, no guarantee of 90%`;
  flow.inputs.model.defaultValue='cnn';
  flow.inputs.training_dataset={type:'SELECT',values:[`cifar10-train/${p.version}`],defaultValue:`cifar10-train/${p.version}`};
  flow.inputs.test_dataset={type:'SELECT',values:['cifar10-test/v1'],defaultValue:'cifar10-test/v1'};
  flow.inputs.clients.defaultValue.forEach((c,i)=>c.weight=p.weights[i]);
  for(const task of [flow.tasks[0],flow.tasks[1].tasks[0].tasks[0],...flow.tasks[1].tasks.slice(1)])task.container.version='cifar-part-v1';
  return flow;
}
