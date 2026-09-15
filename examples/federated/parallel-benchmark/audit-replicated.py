"""FLPAR-02/03 output audit; repeated source samples are deliberate and reported explicitly."""
import json
import sys
from pathlib import Path

import torch

sys.path.insert(0, '/app')
from model import checked_model, evaluate, load, train

torch.set_num_threads(1)
root = Path('/audit')
case = json.loads((root / 'result.json').read_text())
assert case['workload'] == 'REPEATED_SOURCE' and case['algorithm'] == 'fedavg'
assert case['clients'] in (3, 6, 9, 12) and case['uniqueTrainSamples'] == 50000
shards = {f'edge-{letter}': load(f'/datasets/edge-{letter}.pt') for letter in 'abc'}
indices = torch.cat([data['indices'] for data in shards.values()])
assert torch.equal(indices.sort().values, torch.arange(50000))
assert all(data['split'] == 'train' and data['dataset'] == 'cifar10' for data in shards.values())
assert len({item['id'] for item in case['items']}) == case['clients']
for cluster in shards:
    assert sum(item['clusters'] == [cluster] for item in case['items']) == case['clients'] // 3
test = load('/datasets/test.pt')
assert len(test['y']) == 10000 and test['split'] == 'test'
previous = load(root / 'init.pt')
assert previous['round'] == 0 and previous['algorithm'] == 'fedavg'
metrics = []
rounds, batch_size = case.get('rounds', 2), case.get('batchSize', 32)
assert rounds in (1, 2) and batch_size in (32, 256, 1024, 16384)
evaluation_batch = case.get('evaluationBatchSize', 32)
assert evaluation_batch == 32
for round_no in range(1, rounds + 1):
    # Recompute each distinct full shard once, then check EVERY submitted client result.
    expected_states = {}
    for cluster, data in shards.items():
        expected = checked_model(previous)
        train(expected, data, 1, batch_size, 0.01, 0, 13 + round_no - 1)
        expected_states[cluster] = expected.state_dict()
    updates = []
    for item in case['items']:
        update = load(root / f"client-{item['id'][5:]}-r{round_no}.pt")
        cluster = item['clusters'][0]
        assert update['clientId'] == item['id'] and update['algorithm'] == 'fedavg'
        assert update['samples'] == len(shards[cluster]['y'])
        assert update['baseRound'] == round_no - 1 and update['round'] == round_no
        for key, value in expected_states[cluster].items():
            torch.testing.assert_close(update['state'][key], value, rtol=1e-5, atol=1e-6)
        updates.append(update)
    total = sum(update['samples'] for update in updates)
    assert total == case['processedTrainSamplesPerRound'] == 50000 * case['clients'] // 3
    merged = load(root / f'aggregate-r{round_no}.pt')
    assert merged['round'] == round_no and merged['algorithm'] == 'fedavg'
    for key, value in merged['state'].items():
        expected = sum(update['state'][key].double() * update['samples'] for update in updates) / total
        torch.testing.assert_close(value.double(), expected, rtol=1e-5, atol=1e-6)
    actual = json.loads((root / f'evaluate-r{round_no}.json').read_text())
    reference = evaluate(checked_model(merged), test, evaluation_batch)
    assert actual['round'] == round_no and actual['samples'] == 10000
    assert abs(actual['loss'] - reference['loss']) < 1e-6
    assert actual['accuracy'] == reference['accuracy']
    metrics.append(actual)
    previous = merged
print(json.dumps({'numericalAudit': 'PASS', 'workload': 'REPEATED_SOURCE', 'uniqueTrainSamples': 50000,
                  'processedTrainSamplesPerRound': total, 'clients': case['clients'], 'rounds': metrics}))
