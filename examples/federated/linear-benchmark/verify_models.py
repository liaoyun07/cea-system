"""After timing only: independent old SGD, eager load, original sample loader."""
import json
from pathlib import Path
import torch
from torch import nn
from model import train, evaluate
from seed import normalized

torch.set_num_threads(1)
root, reference = Path('/audit'), Path('/reference')
load = lambda path: torch.load(path, weights_only=True, map_location='cpu')
initial_mlp = load(reference / 'models/init-0.pt')
mlp_clients = [load(reference / f'models/train-{i}.pt') for i in range(1, 4)]
torch.manual_seed(13)
linear = nn.Sequential(nn.Flatten(), nn.Linear(3072, 10))
initial_linear = dict(dataset='cifar10', model='linear', algorithm='fedavg', round=0,
                      state=linear.state_dict())
linear_clients = []
for shard in range(3):
    data = load(reference / f'raw/edge-{"abc"[shard]}.pt')
    data['x'] = normalized(data['x'], 'cifar10')
    net = nn.Sequential(nn.Flatten(), nn.Linear(3072, 10))
    net.load_state_dict(initial_linear['state'], strict=True)
    # model.train in this par07 reference image uses torch.optim.SGD and ordinary DataLoader.
    train(net, data, epochs=1, batch_size=1024, learning_rate=.01, mu=0, seed=13)
    linear_clients.append(dict(dataset='cifar10', model='linear', algorithm='fedavg',
                               round=1, baseRound=0, samples=len(data['y']), state=net.state_dict()))
test = load('/test.pt')
equal_tensors = 0


def same(expected, actual):
    global equal_tensors
    assert expected.keys() == actual.keys(), (expected.keys(), actual.keys())
    for key in expected:
        if key == 'state':
            assert expected[key].keys() == actual[key].keys()
            for name in expected[key]:
                assert torch.equal(expected[key][name], actual[key][name]), name
                equal_tensors += 1
        else:
            assert expected[key] == actual[key], key


runs, failures = [], []
for index in range(8):
    row = json.loads((root / f'trial-{index}.json').read_text())
    if row['execution']['state'] != 'SUCCESS':
        failures.append(row['execution']['id'])
        continue
    directory = root / 'models' / str(index)
    assert len(list(directory.glob('*.pt'))) == 8
    candidate = row['kind'] == 'candidate'
    same(initial_linear if candidate else initial_mlp, load(directory / 'init-0.pt'))
    updates = []
    for item in range(1, 7):
        shard = (item - 1) % 3
        expected = {**(linear_clients if candidate else mlp_clients)[shard],
                    'clientId': f'edge-{"abc"[shard]}{(item-1)//3+1}'}
        actual = load(directory / f'train-{item}.pt')
        same(expected, actual)
        updates.append(actual)
    total = sum(u['samples'] for u in updates)
    first = updates[0]
    expected = {k: first[k] for k in ('dataset', 'model', 'algorithm', 'round')}
    expected['state'] = {key: sum(u['state'][key] * (u['samples'] / total) for u in updates)
                         for key in first['state']}
    same(expected, load(directory / 'aggregate-1.pt'))
    if candidate:
        net = nn.Sequential(nn.Flatten(), nn.Linear(3072, 10))
    else:
        net = nn.Sequential(nn.Flatten(), nn.Linear(3072, 128), nn.ReLU(), nn.Linear(128, 10))
    net.load_state_dict(expected['state'], strict=True)
    metrics = evaluate(net, test, 1024 if candidate else 32)
    assert metrics['samples'] == row['metrics']['samples'] == 10000
    assert metrics['accuracy'] == row['metrics']['accuracy']
    assert abs(metrics['loss'] - row['metrics']['loss']) < 1e-8
    runs.append(dict(index=index, kind=row['kind'], models=8, metrics=metrics))
assert runs
print(json.dumps(dict(result='PASS', scope='successful executions only', models=len(runs)*8,
                      equalTensors=equal_tensors, runs=runs, failures=failures)))
