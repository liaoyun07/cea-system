"""Reevaluate actual first-95 artifacts; no training or workflow submission."""
import json
from pathlib import Path

import torch
import model
import fedcads


def audit(root=Path('/audit'), test_path=Path('/test.pt')):
    torch.set_num_threads(1)
    protocol = json.loads((root / 'protocol.json').read_text())
    assert protocol['id'] == 'FL-RESOURCE95-01'
    assert protocol['seed'] == 31 and protocol['cadsSchedule'] == 40
    assert protocol['targetAccuracy'] == 0.95 and protocol['batchSize'] == 128
    initial = {a: model.load(root / f'{a}-init.pt') for a in ('fedavg', 'fedcads')}
    assert initial['fedavg']['algorithm'] == 'fedavg'
    assert initial['fedcads']['algorithm'] == 'fedcads'
    for payload in initial.values():
        assert payload['round'] == 0 and payload['dataset'] == 'mnist' and payload['model'] == 'mlp'
    assert all(torch.equal(value, initial['fedcads']['state']['base.' + key])
               for key, value in initial['fedavg']['state'].items())
    assert initial['fedcads']['totalRounds'] == 40
    assert initial['fedcads']['clientWeights'] == {'edge-a': .15, 'edge-b': .6, 'edge-c': 2.25}

    test = model.load(test_path)
    assert test['dataset'] == 'mnist' and len(test['y']) == 10000
    results = []
    for algorithm in ('fedavg', 'fedcads'):
        trial = json.loads((root / f'{algorithm}.json').read_text())
        execution = trial['execution']
        assert trial['algorithm'] == algorithm
        assert execution['state'] == 'SUCCESS'
        assert execution['flowId'] == f'mnist-strong-{algorithm}' and execution['flowRevision'] == 1
        assert execution['inputs']['seed'] == 31 and execution['inputs']['rounds'] == 40
        assert execution['inputs']['training_dataset'] == 'mnist-train/strong-noniid-v1'
        assert execution['inputs']['test_dataset'] == 'mnist-test/v1'
        evaluations = sorted(trial['evaluations'], key=lambda entry: entry['round'])
        assert [entry['round'] for entry in evaluations] == list(range(1, 41))
        assert all(entry['samples'] == 10000 for entry in evaluations)
        first = next(entry for entry in evaluations if entry['accuracy'] >= .95)
        payload = model.load(root / f'{algorithm}-first95.pt')
        assert payload['algorithm'] == algorithm and payload['round'] == first['round']
        assert payload['dataset'] == 'mnist' and payload['model'] == 'mlp'
        if algorithm == 'fedcads':
            assert payload['totalRounds'] == 40
            assert payload['clientWeights'] == initial[algorithm]['clientWeights']
        network = fedcads.checked_model(payload) if algorithm == 'fedcads' else model.checked_model(payload)
        model.check_data(test, payload)
        score = model.evaluate(network, test, 128)
        assert score['samples'] == first['samples']
        assert score['accuracy'] == first['accuracy']
        assert score['loss'] == first['loss']
        results.append({'algorithm': algorithm, 'executionId': execution['id'],
                        'first95Round': first['round'], **score})
    return {'passed': True, 'sameMainInitialWeights': True, 'cadsSchedule': 40,
            'normalizedClientWeights': initial['fedcads']['clientWeights'],
            'modelFiles': 4, 'first95Reevaluation': results}


if __name__ == '__main__':
    print(json.dumps(audit(), indent=2))
