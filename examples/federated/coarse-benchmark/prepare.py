"""FLPAR-22 workload packaging only; duplicate real tensors, never byte counters."""
import json
import sys
from pathlib import Path
import torch


def doubled(data):
    assert set(data) == {'dataset', 'split', 'indices', 'x', 'y'}
    return {**data, **{key: torch.cat([data[key], data[key]], dim=0)
                       for key in ('x', 'y', 'indices')}}


def main(mode):
    torch.set_num_threads(1)
    source, output = Path('/reference/raw'), Path('/audit')
    rows, all_indices = [], []
    if mode == 'prepare':
        (output / 'raw').mkdir(parents=True, exist_ok=False)
    for letter, count in zip('abc', (16667, 16667, 16666)):
        original = torch.load(source / f'edge-{letter}.pt', weights_only=True)
        assert len(original['y']) == count
        assert original['dataset'] == 'cifar10' and original['split'] == 'train'
        path = output / ('raw' if mode == 'prepare' else 'readback') / f'edge-{letter}.pt'
        if mode == 'prepare':
            torch.save(doubled(original), path)
        actual = torch.load(path, weights_only=True)
        assert actual.keys() == original.keys()
        for key in ('dataset', 'split'):
            assert actual[key] == original[key]
        for key in ('x', 'y', 'indices'):
            assert actual[key].dtype == original[key].dtype
            assert actual[key].shape == (count * 2, *original[key].shape[1:])
            assert torch.equal(actual[key][:count], original[key])
            assert torch.equal(actual[key][count:], original[key])
        all_indices.append(actual['indices'])
        rows.append(dict(cluster=f'edge-{letter}', samples=count * 2, bytes=path.stat().st_size))
    unique, counts = torch.cat(all_indices).unique(return_counts=True)
    assert torch.equal(unique, torch.arange(50000)) and torch.all(counts == 2)
    result = dict(result='PASS', processedSamples=100000, uniqueSamples=50000,
                  copiesPerSample=2, shards=rows)
    with (output / f'{mode}-audit.json').open('x') as file:
        json.dump(result, file, indent=2)
    print(json.dumps(result))


if __name__ == '__main__':
    assert sys.argv[1] in ('prepare', 'readback')
    main(sys.argv[1])
