"""FLPAR-10: audit saved outputs after timing, against known nine-client results."""
from pathlib import Path
import json
import torch
from model import build_model, evaluate

torch.set_num_threads(1)
root = Path('/audit')
load = lambda path: torch.load(path, weights_only=True, map_location='cpu')
reference = root / 'baseline'
candidate = root / 'candidate'
assert len(list(candidate.glob('*.pt'))) == 20
tensors = 0


def same(before, after):
    global tensors
    assert before.keys() == after.keys()
    for key in before:
        if key == 'state':
            assert before[key].keys() == after[key].keys()
            for name in before[key]:
                assert torch.equal(before[key][name], after[key][name]), name
                tensors += 1
        else:
            assert before[key] == after[key], key


same(load(reference / 'init-0.pt'), load(candidate / 'init-0.pt'))
updates = []
for item in range(1, 19):
    before = load(reference / f'train-{(item - 1) % 9 + 1}.pt')
    before['clientId'] = f'edge-{"abc"[(item - 1) % 3]}{(item - 1) // 3 + 1}'
    actual = load(candidate / f'train-{item}.pt')
    same(before, actual)
    updates.append(before)
assert len({u['clientId'] for u in updates}) == 18
total = sum(u['samples'] for u in updates)
assert total == 300000
expected = {key: updates[0][key] for key in ('algorithm', 'dataset', 'model', 'round')}
expected['state'] = {key: sum(u['state'][key] * (u['samples'] / total) for u in updates)
                     for key in updates[0]['state']}
same(expected, load(candidate / 'aggregate-1.pt'))
model = build_model(expected['dataset'], expected['model'])
model.load_state_dict(expected['state'], strict=True)
metrics = evaluate(model, load('/datasets/test.pt'), 32)
reported = json.loads((root / 'trial-0.json').read_text())['metrics']
for key in ('loss', 'accuracy', 'samples'):
    assert metrics[key] == reported[key], (key, metrics[key], reported[key])
print(json.dumps(dict(result='PASS', clients=18, processedSamples=total, models=20,
                     equalTensors=tensors, metrics=metrics)))
