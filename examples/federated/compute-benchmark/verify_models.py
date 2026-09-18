"""Post-benchmark independent full-data audit using original SGD/DataLoader."""
import json
from pathlib import Path
import torch
from torch import nn
from model import train, evaluate
from seed import normalized

torch.set_num_threads(1)
root = Path('/audit')
load = lambda p: torch.load(p, weights_only=True, map_location='cpu')
torch.manual_seed(13)
net = nn.Sequential(nn.Flatten(), nn.Linear(3072, 10))
initial = dict(dataset='cifar10', model='linear', algorithm='fedavg', round=0, state=net.state_dict())
references = {}
for letter in 'abc':
    original = load(Path('/reference/raw') / f'edge-{letter}.pt')
    data = {**original, **{key: torch.cat([original[key]] * 2) for key in ('x', 'y', 'indices')}}
    raw = data['x']
    pixels = torch.empty(raw.shape, dtype=torch.float32)
    for begin in range(0, len(raw), 4096):
        pixels[begin:begin+4096] = normalized(raw[begin:begin+4096], 'cifar10')
    data['x'] = pixels
    del raw, pixels
    net = nn.Sequential(nn.Flatten(), nn.Linear(3072, 10))
    net.load_state_dict(initial['state'])
    train(net, data, epochs=1, batch_size=1024, learning_rate=.01, mu=0, seed=13)
    references[letter] = dict(dataset='cifar10', model='linear', algorithm='fedavg',
                             round=1, baseRound=0, samples=len(data['y']),
                             clientId=f'edge-{letter}1', state=net.state_dict())

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
for index in range(4):
    row = json.loads((root/f'trial-{index}.json').read_text())
    if row['execution']['state'] != 'SUCCESS':
        failures.append(row['execution']['id'])
        continue
    directory = root/'models'/str(index)
    assert len(list(directory.glob('*.pt'))) == 5
    same(initial, load(directory/'init-0.pt'))
    updates = []
    for item, letter in enumerate('abc', 1):
        actual = load(directory/f'train-{item}.pt')
        same(references[letter], actual)
        updates.append(actual)
    total = sum(u['samples'] for u in updates)
    assert total == 100000
    expected = {key: updates[0][key] for key in ('dataset', 'model', 'algorithm', 'round')}
    expected['state'] = {key: sum(u['state'][key]*(u['samples']/total) for u in updates) for key in updates[0]['state']}
    same(expected, load(directory/'aggregate-1.pt'))
    net = nn.Sequential(nn.Flatten(), nn.Linear(3072,10))
    net.load_state_dict(expected['state'])
    metrics = evaluate(net, test, 1024)
    assert metrics['samples'] == row['metrics']['samples'] == 10000
    assert metrics['accuracy'] == row['metrics']['accuracy']
    assert abs(metrics['loss']-row['metrics']['loss']) < 1e-8
    runs.append(dict(index=index, models=5, processedSamples=total, metrics=metrics))
assert runs
print(json.dumps(dict(result='PASS',scope='successful executions only',models=len(runs)*5,equalTensors=equal_tensors,runs=runs,failures=failures)))
