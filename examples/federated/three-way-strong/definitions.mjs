import {parse} from '../../../frontend/node_modules/yaml/dist/index.js';
import {definition as hsamDefinition} from '../gfed-hsam/definitions.mjs';

export const datasets = ['mnist', 'cifar10'];
export const algorithms = ['fedavg', 'fedcads', 'gfed-hsam'];
export const filePath = 'experiments/three-way-strong/hsam_entry.py';
export function definition(dataset, algorithm, source) {
  const flow = algorithm === 'gfed-hsam' ? hsamDefinition() : parse(source);
  flow.id = `compare40-${dataset}-${algorithm}`;
  flow.description = `${dataset} strong-noniid-v1; ${algorithm}; 40 rounds, full local epoch=1, seed=31`;
  const defaults = {rounds:40, model:dataset === 'mnist' ? 'mlp' : 'cnn',
    training_dataset:`${dataset}-train/strong-noniid-v1`, test_dataset:`${dataset}-test/v1`,
    local_epochs:1, batch_size:128, learning_rate:.1, seed:31};
  for (const [key,value] of Object.entries(defaults)) flow.inputs[key].defaultValue=value;
  const repeat=flow.tasks[1];
  for (const task of [flow.tasks[0],repeat.tasks[0].tasks[0],repeat.tasks[1],repeat.tasks[2]]) {
    task.timeout='PT30M';
    if (algorithm==='gfed-hsam') {
      task.container.command[1]='/cea-work/in/hsam_entry.py';
      task.container.namespaceFiles={'hsam_entry.py':{path:filePath,revision:1}};
    }
  }
  return flow;
}
