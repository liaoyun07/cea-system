"""Audit every reduced-client result against previously verified full-shard models."""
from pathlib import Path
import json
import torch
from model import build_model, evaluate

torch.set_num_threads(1)
root = Path('/audit')
reference = Path('/baseline')
load = lambda path: torch.load(path, weights_only=True, map_location='cpu')
test_data = load('/datasets/test.pt')
assert len(test_data['y']) == 10000
runs = []
tensors = 0


def same(expected, actual):
    global tensors
    assert expected.keys() == actual.keys()
    for key in expected:
        if key == 'state':
            assert expected[key].keys() == actual[key].keys()
            for name in expected[key]:
                assert torch.equal(expected[key][name], actual[key][name]), name
                tensors += 1
        else:
            assert expected[key] == actual[key], key


for index in range(12):
    trial = json.loads((root / f'trial-{index}.json').read_text())
    clients = trial['clients']
    assert clients in (1, 2, 3) and trial['execution']['state'] == 'SUCCESS'
    candidate = root / 'models' / str(index)
    assert len(list(candidate.glob('*.pt'))) == clients + 2
    same(load(reference / 'init-0.pt'), load(candidate / 'init-0.pt'))
    updates = []
    for item in range(1, clients + 1):
        expected = load(reference / f'train-{item}.pt')
        assert expected['clientId'] == f'edge-{"abc"[item - 1]}1'
        assert expected['samples'] == (8333, 16667, 25000)[item - 1]
        same(expected, load(candidate / f'train-{item}.pt'))
        updates.append(expected)
    total = sum(update['samples'] for update in updates)
    assert total == (8333, 25000, 50000)[clients - 1]
    expected = {key: updates[0][key] for key in ('algorithm', 'dataset', 'model', 'round')}
    expected['state'] = {
        key: sum(update['state'][key] * (update['samples'] / total) for update in updates)
        for key in updates[0]['state']
    }
    same(expected, load(candidate / 'aggregate-1.pt'))
    model = build_model(expected['dataset'], expected['model'])
    model.load_state_dict(expected['state'], strict=True)
    metrics = evaluate(model, test_data, 32)
    reported = trial['metrics']
    assert reported['round'] == 1
    for key in ('accuracy', 'samples'):
        assert metrics[key] == reported[key], (key, metrics[key], reported[key])
    assert abs(metrics['loss'] - reported['loss']) < 1e-8
    runs.append(dict(index=index, clients=clients, processedSamples=total,
                     models=clients + 2, metrics=metrics))
assert sum(run['models'] for run in runs) == 48 and tensors == 192
print(json.dumps(dict(result='PASS', models=48, equalTensors=tensors, runs=runs)))
