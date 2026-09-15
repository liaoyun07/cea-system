"""Local diagnostic only. Official CEA A/B runs do NOT include these timing hooks."""
import argparse
import contextlib
import json
import os
from pathlib import Path
import tempfile
import time
from unittest.mock import patch

import torch
from torch.utils.data import DataLoader
import app
import model
from cea_measurement import Measurement
from bulk_loader import bulk_training_loader


def profile(mode, cluster):
    times = {}
    counts = dict(batches=0, samples=0)
    def add(name, elapsed):
        times[name] = times.get(name, 0) + elapsed
    def timed(name, function):
        def invoke(*args, **kwargs):
            start = time.perf_counter_ns()
            try:
                return function(*args, **kwargs)
            finally:
                add(name, time.perf_counter_ns() - start)
        return invoke
    class TimedLoader:
        def __init__(self, delegate):
            self.delegate = delegate
        def __iter__(self):
            start = time.perf_counter_ns()
            iterator = iter(self.delegate)
            add('batch_assembly', time.perf_counter_ns() - start)
            while True:
                start = time.perf_counter_ns()
                try:
                    batch = next(iterator)
                except StopIteration:
                    add('batch_assembly', time.perf_counter_ns() - start)
                    return
                add('batch_assembly', time.perf_counter_ns() - start)
                counts['batches'] += 1
                counts['samples'] += len(batch[1])
                yield batch
    factory = bulk_training_loader if mode == 'bulk' else DataLoader
    def loader(*args, **kwargs):
        return TimedLoader(factory(*args, **kwargs))
    real_load = app.load
    def load(path):
        return timed('load_model' if str(path) == '/audit/init.pt' else 'load_dataset', real_load)(path)
    env = {'ALGORITHM': 'fedavg', 'DATASET_PATH': f'/datasets/{cluster}.pt', 'LOCAL_EPOCHS': '1',
           'BATCH_SIZE': '1024', 'LEARNING_RATE': '0.01', 'SEED': '13', 'CLIENT_ID': cluster}
    with tempfile.TemporaryDirectory() as temporary:
        output = Path(temporary) / 'model.pt'
        args = argparse.Namespace(stage='train', input='/audit/init.pt', output=str(output))
        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.dict(os.environ, env))
            stack.enter_context(patch.object(model, 'DataLoader', loader))
            stack.enter_context(patch.object(app, 'load', load))
            for name, key in [('checked_model', 'model_setup'), ('check_data', 'validation'), ('train', 'train_total')]:
                stack.enter_context(patch.object(app, name, timed(key, getattr(app, name))))
            stack.enter_context(patch.object(torch, 'save', timed('write_model', torch.save)))
            with contextlib.redirect_stdout(None):
                with Measurement(Path(temporary) / 'cea-measurement.json') as measurement:
                    app.run(args, measurement)
        payload = model.load(output)
        report = json.loads((Path(temporary) / 'cea-measurement.json').read_text())
    expected = {'edge-a': 8333, 'edge-b': 16667, 'edge-c': 25000}[cluster]
    assert counts['samples'] == expected and counts['batches'] == (expected + 1023) // 1024
    times['train_compute_and_setup'] = times['train_total'] - times['batch_assembly']
    return {'mode': mode, 'cluster': cluster, **counts,
            'seconds': {key: value / 1e9 for key, value in times.items()},
            'sdkSeconds': report['durationNs'] / 1e9,
            'inputBytes': sum(item['bytes'] for item in report['inputs']),
            'outputBytes': sum(item['bytes'] for item in report['outputs'])}, payload


def main():
    torch.set_num_threads(1)
    rows = []
    for repeat in range(1, 4):
        for cluster in ('edge-a', 'edge-b', 'edge-c'):
            outputs = {}
            for mode in (('baseline', 'bulk') if repeat % 2 else ('bulk', 'baseline')):
                row, outputs[mode] = profile(mode, cluster)
                rows.append(dict(repeat=repeat, **row))
            assert outputs['baseline']['samples'] == outputs['bulk']['samples']
            for key, tensor in outputs['baseline']['state'].items():
                assert torch.equal(tensor, outputs['bulk']['state'][key]), key
    print(json.dumps({'diagnosticOnly': True, 'exactModelEquality': True, 'rows': rows}))


if __name__ == '__main__':
    main()
