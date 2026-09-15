"""Repartition the current three CIFAR-10 raw shards, outside algorithm timing."""
import argparse
import json
from pathlib import Path

import torch


def balanced_sizes(total):
    if total < 3:
        raise ValueError('three nonempty shards are required')
    size, remainder = divmod(total, 3)
    return [size + (index < remainder) for index in range(3)]


def repartition(shards):
    # Preserve the existing sample order and label skew; change quantity only.
    if len(shards) != 3:
        raise ValueError('exactly three source shards are required')
    for shard in shards:
        assert shard['dataset'] == 'cifar10' and shard['split'] == 'train'
        assert shard['x'].dtype == torch.uint8
        assert len(shard['x']) == len(shard['y']) == len(shard['indices'])
    combined = {key: torch.cat([shard[key] for shard in shards]) for key in ('x', 'y', 'indices')}
    assert len(combined['indices'].unique()) == len(combined['indices']), 'duplicate source records'
    offset = 0
    result = []
    for size in balanced_sizes(len(combined['indices'])):
        # Clone slices: torch.save must not serialize the full source backing storage.
        result.append({'dataset': 'cifar10', 'split': 'train', **{
            key: value[offset:offset + size].clone() for key, value in combined.items()}})
        offset += size
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    torch.set_num_threads(1)
    load = lambda path: torch.load(path, weights_only=True, map_location='cpu')
    original = [load(args.source / f'edge-{letter}.pt') for letter in 'abc']
    assert [len(shard['y']) for shard in original] == [8333, 16667, 25000]
    result = repartition(original)
    assert torch.equal(torch.cat([s['indices'] for s in result]).sort().values, torch.arange(50000))
    assert not args.output.exists(), 'refuse to overwrite data/evidence'
    args.output.mkdir(parents=True)
    rows = []
    for letter, shard in zip('abc', result):
        path = args.output / f'edge-{letter}.pt'
        torch.save(shard, path)
        actual = load(path)
        for key in ('x', 'y', 'indices'):
            assert torch.equal(actual[key], shard[key])
            assert actual[key].untyped_storage().nbytes() == actual[key].numel() * actual[key].element_size()
        rows.append(dict(cluster=f'edge-{letter}', samples=len(shard['y']), bytes=path.stat().st_size))
    for key in ('x', 'y', 'indices'):
        assert torch.equal(torch.cat([s[key] for s in original]), torch.cat([s[key] for s in result]))
    manifest = dict(result='PASS', uniqueSamples=50000, partition='equal-size; original label-sorted order preserved', shards=rows)
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    print(json.dumps(manifest))


if __name__ == '__main__':
    main()
