"""Offline storage readback and real smoke model validation; never inside the SDK interval."""
import argparse
import json
from pathlib import Path

import torch
from model import build_model, train, aggregate, evaluate
from seed import normalized


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['data', 'models'])
    args = parser.parse_args()
    torch.set_num_threads(1)
    root = Path('/audit')
    load = lambda path: torch.load(path, weights_only=True, map_location='cpu')
    shards = []
    for letter, size in zip('abc', (16667, 16667, 16666)):
        prepared = load(root / f'raw/edge-{letter}.pt')
        fetched = load(root / f'readback/edge-{letter}.pt')
        assert prepared.keys() == fetched.keys()
        for key in ('x', 'y', 'indices'):
            assert torch.equal(prepared[key], fetched[key])
        for key in ('dataset', 'split'):
            assert prepared[key] == fetched[key]
        assert len(fetched['y']) == size
        shards.append(fetched)
    assert torch.equal(torch.cat([s['indices'] for s in shards]).sort().values, torch.arange(50000))
    if args.mode == 'data':
        print(json.dumps(dict(result='PASS', samples=[len(s['y']) for s in shards], uniqueSamples=50000, exactStorageReadback=True)))
        return
    trial = json.loads((root / 'smoke.json').read_text())
    assert trial['execution']['state'] == 'SUCCESS'
    initial = load(root / 'models/init-0.pt')
    assert (initial['algorithm'], initial['dataset'], initial['model'], initial['round']) == ('fedavg', 'cifar10', 'mlp', 0)
    torch.manual_seed(13)
    expected_init = build_model('cifar10', 'mlp').state_dict()
    tensors = 0

    def same_state(expected, actual):
        nonlocal tensors
        assert expected.keys() == actual.keys()
        for key in expected:
            assert torch.equal(expected[key], actual[key]), key
            tensors += 1

    same_state(expected_init, initial['state'])
    updates = []
    for index, data in enumerate(shards, 1):
        model = build_model('cifar10', 'mlp')
        model.load_state_dict(initial['state'], strict=True)
        data = {**data, 'x': normalized(data['x'], 'cifar10')}
        # Run the previously verified par07 image implementation as the reference.
        train(model, data, 1, 1024, .01, 0, 13)
        actual = load(root / f'models/train-{index}.pt')
        assert actual['samples'] == len(data['y']) and actual['clientId'] == f'edge-{"abc"[index-1]}1'
        assert actual['round'] == 1 and actual['baseRound'] == 0
        same_state(model.state_dict(), actual['state'])
        updates.append(actual)
    assert sum(u['samples'] for u in updates) == 50000
    expected = aggregate(updates)
    actual = load(root / 'models/aggregate-1.pt')
    same_state(expected['state'], actual['state'])
    model = build_model('cifar10', 'mlp')
    model.load_state_dict(actual['state'], strict=True)
    metrics = evaluate(model, load('/test.pt'), 32)
    assert metrics['samples'] == trial['metrics']['samples'] == 10000
    assert metrics['accuracy'] == trial['metrics']['accuracy']
    assert abs(metrics['loss'] - trial['metrics']['loss']) < 1e-8
    print(json.dumps(dict(result='PASS', uniqueSamples=50000, samples=[len(s['y']) for s in shards],
                         models=5, equalTensors=tensors, metrics=metrics, exactStorageReadback=True)))


if __name__ == '__main__':
    main()
