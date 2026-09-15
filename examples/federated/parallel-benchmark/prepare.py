"""FLPAR-01: split each existing client in two; never duplicate underlying tensor storage."""
import argparse
import json
from pathlib import Path
import torch


def prepare(source, target):
    target.mkdir(parents=True, exist_ok=True)
    result = []
    all_indices = []
    for letter in 'abc':
        original = torch.load(source / f'edge-{letter}.pt', weights_only=True)
        count = len(original['y'])
        cuts = (0, count // 2, count)
        halves = []
        for part in (1, 2):
            begin, end = cuts[part - 1:part + 1]
            # torch.save otherwise serializes the full backing storage of a view.
            value = {key: tensor[begin:end].clone() if isinstance(tensor, torch.Tensor) else tensor
                     for key, tensor in original.items()}
            path = target / f'edge-{letter}{part}.pt'
            if path.exists():
                raise ValueError(f'refuse to overwrite {path}')
            torch.save(value, path)
            checked = torch.load(path, weights_only=True)
            for key in ('x', 'y', 'indices'):
                assert torch.equal(checked[key], original[key][begin:end])
                assert checked[key].untyped_storage().nbytes() == checked[key].numel() * checked[key].element_size()
            all_indices.append(checked['indices'])
            halves.append(checked)
            result.append({'client': f'edge-{letter}{part}', 'cluster': f'edge-{letter}',
                           'part': part, 'samples': end - begin, 'bytes': path.stat().st_size})
        for key in ('x', 'y', 'indices'):
            assert torch.equal(torch.cat([half[key] for half in halves]), original[key])
    indices = torch.cat(all_indices)
    assert len(indices) == 50000 and torch.equal(indices.sort().values, torch.arange(50000))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    args = parser.parse_args()
    torch.set_num_threads(1)
    for dataset in ('cifar10', 'cifar100'):
        target = args.root / 'par01' / dataset
        result = prepare(args.root / dataset, target)
        (target / 'manifest.json').write_text(json.dumps(result, indent=2))
        print(json.dumps({'dataset': dataset, 'samples': 50000, 'disjointExactPartition': 'PASS', 'files': result}), flush=True)
