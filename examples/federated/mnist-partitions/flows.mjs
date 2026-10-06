export const partitions={
  equal:{version:'equal-noniid-v1',weights:[1,1,1]},
  strong:{version:'strong-noniid-v1',weights:[1,4,15]},
};
export function connect(original,algorithm,kind){
  const flow=structuredClone(original),p=partitions[kind];
  flow.id=`mnist-${kind}-${algorithm}`;
  flow.description=`MNIST ${p.version}: full 60000 training, 10000 test, fixed partition weights, original numerical core`;
  flow.inputs.rounds.defaultValue=40;
  flow.inputs.training_dataset={type:'SELECT',values:[`mnist-train/${p.version}`],defaultValue:`mnist-train/${p.version}`};
  flow.inputs.test_dataset={type:'SELECT',values:['mnist-test/v1'],defaultValue:'mnist-test/v1'};
  flow.inputs.clients={type:'ARRAY',defaultValue:'abc'.split('').map((c,i)=>({id:`edge-${c}`,clusters:[`edge-${c}`],weight:p.weights[i]}))};
  flow.tasks[1].tasks[0].loop.values={source:'INPUT',name:'clients'};
  const leaves=[flow.tasks[0],flow.tasks[1].tasks[0].tasks[0],...flow.tasks[1].tasks.slice(1)];
  for(const task of leaves)task.container.version='mnist-part-v1';
  if(algorithm==='fedcads')flow.tasks[0].container.parameters.ROUNDS={source:'INPUT',name:'rounds'};
  return flow;
}
