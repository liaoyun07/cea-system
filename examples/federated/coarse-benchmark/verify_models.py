"""Outside all timings: independently train with old SGD / ordinary DataLoader."""
import json
from pathlib import Path
import torch
from torch import nn
from model import train, evaluate
from seed import normalized

torch.set_num_threads(1)
root = Path('/audit')
load = lambda path: torch.load(path, weights_only=True, map_location='cpu')
torch.manual_seed(13)
net = nn.Sequential(nn.Flatten(), nn.Linear(3072, 10))
initial = dict(dataset='cifar10', model='linear', algorithm='fedavg', round=0, state=net.state_dict())
references = {}
for factor in (1, 2):
    for letter in 'abc':
        original = load(Path('/reference/raw') / f'edge-{letter}.pt')
        data = {**original, **{key: torch.cat([original[key]] * factor) for key in ('x', 'y', 'indices')}}
        data['x'] = normalized(data['x'], 'cifar10')
        net = nn.Sequential(nn.Flatten(), nn.Linear(3072, 10))
        net.load_state_dict(initial['state'])
        train(net, data, epochs=1, batch_size=1024, learning_rate=.01, mu=0, seed=13)
        references[factor, letter] = dict(dataset='cifar10', model='linear', algorithm='fedavg',
            round=1, baseRound=0, samples=len(data['y']), state=net.state_dict())

equal_tensors = 0


def same(expected, actual):
    global equal_tensors
    assert expected.keys() == actual.keys()
    for key in expected:
        if key == 'state':
            assert expected[key].keys() == actual[key].keys()
            for name in expected[key]:
                assert torch.equal(expected[key][name], actual[key][name]), name
                equal_tensors += 1
        else:
            assert expected[key] == actual[key], key


test = load('/test.pt')
runs, failures = [], []
for index in range(8):
    row = json.loads((root / f'trial-{index}.json').read_text())
    if row['execution']['state'] != 'SUCCESS':
        failures.append(row['execution']['id'])
        continue
    factor, clients = (1, 6) if row['kind'] == 'baseline' else (2, 3)
    directory = root / 'models' / str(index)
    assert len(list(directory.glob('*.pt'))) == clients + 2
    same(initial, load(directory / 'init-0.pt'))
    updates = []
    for item in range(1, clients + 1):
        letter = 'abc'[(item - 1) % 3]
        expected = {**references[factor, letter], 'clientId': f'edge-{letter}{(item-1)//3+1}'}
        actual = load(directory / f'train-{item}.pt')
        same(expected, actual)
        updates.append(actual)
    total = sum(u['samples'] for u in updates)
    assert total == 100000
    first = updates[0]
    expected = {k: first[k] for k in ('dataset', 'model', 'algorithm', 'round')}
    expected['state'] = {key: sum(u['state'][key] * (u['samples'] / total) for u in updates) for key in first['state']}
    same(expected, load(directory / 'aggregate-1.pt'))
    net = nn.Sequential(nn.Flatten(), nn.Linear(3072, 10))
    net.load_state_dict(expected['state'])
    metrics = evaluate(net, test, 1024)
    assert metrics['samples'] == row['metrics']['samples'] == 10000
    assert metrics['accuracy'] == row['metrics']['accuracy']
    assert abs(metrics['loss'] - row['metrics']['loss']) < 1e-8
    runs.append(dict(index=index, clients=clients, models=clients+2, processedSamples=total, metrics=metrics))
assert runs
result = dict(result='PASS', scope='successful executions only', models=sum(r['models'] for r in runs),
              equalTensors=equal_tensors, runs=runs, failures=failures)
with (root / 'models-audit.json').open('x') as file:
    json.dump(result, file, indent=2)
print(json.dumps(result))
