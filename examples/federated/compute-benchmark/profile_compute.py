"""FLPAR-24 experiment only: resident-input compute span inside unchanged SDK."""
import argparse
import json
import os
from pathlib import Path
import sys
import time

sys.path.insert(0, '/app')
import torch
from cea_measurement import Measurement, REPORT_NAME, timestamp

PROFILE_NAME = 'compute-profile.json'


def point():
    return time.time_ns(), time.perf_counter_ns()


def span(start, end):
    duration = end[1] - start[1]
    if duration <= 0 or end[0] <= start[0] or abs(end[0] - start[0] - duration) > max(1_000_000, duration // 1000):
        raise ValueError('compute profile clock changed')
    return dict(startedAt=timestamp(start[0]), endedAt=timestamp(end[0]), durationNs=duration)


def execute(args):
    # Imports/install are outside both clocks, just as in the original CLI.
    if args.stage == 'preprocess':
        from preprocess import prepare
    else:
        import linear_app
        import app
        linear_app.install()
    output = Path(args.output)
    profile_path = output.parent / PROFILE_NAME
    profile_path.unlink(missing_ok=True)
    with Measurement(output.parent / REPORT_NAME) as measurement:
        read_start = point()

        def load(path):
            with measurement.input(path):
                # Explicit eager CPU load: no mmap page faults deferred into compute.
                return torch.load(os.fspath(path), map_location='cpu', weights_only=True, mmap=False)

        if args.stage == 'preprocess':
            data = load(args.input or os.environ['RAW_DATASET_PATH'])
        elif args.stage == 'aggregate':
            paths = json.loads(Path(args.clients_manifest).read_text())
            if not isinstance(paths, list) or not paths or not all(isinstance(p, str) for p in paths):
                raise ValueError('client manifest must be a non-empty array of local file paths')
            updates = [load(path) for path in paths]
        elif args.stage in ('train', 'evaluate'):
            previous = load(args.input or '/cea-work/in/global_model')
            data = load(os.environ['DATASET_PATH' if args.stage == 'train' else 'TEST_DATASET_PATH'])
        read_end = point()
        compute_start = point()
        if args.stage == 'preprocess':
            result = prepare(data)
        elif args.stage == 'init':
            algorithm = os.environ['ALGORITHM']
            if algorithm not in ('fedavg', 'fedprox'):
                raise ValueError('ALGORITHM must be fedavg or fedprox')
            torch.manual_seed(int(os.environ['SEED']))
            dataset = app.dataset_from_refs(os.environ['TRAINING_DATASET'], os.environ['TEST_DATASET'])
            name = os.environ['MODEL']
            result = dict(algorithm=algorithm, dataset=dataset, model=name, round=0,
                          state=app.build_model(dataset, name).state_dict())
        elif args.stage == 'aggregate':
            result = app.aggregate(updates)
        else:
            model = app.checked_model(previous)
            app.check_data(data, previous)
            if data['split'] != ('train' if args.stage == 'train' else 'test'):
                raise ValueError('training and global test datasets must not be interchanged')
            if args.stage == 'evaluate':
                result = app.evaluate(model, data, int(os.environ['BATCH_SIZE']))
                result.update(round=previous['round'], algorithm=previous['algorithm'])
            else:
                algorithm = os.environ['ALGORITHM']
                if previous['algorithm'] != algorithm:
                    raise ValueError('client algorithm does not match global model')
                mu = float(os.environ['PROX_MU']) if algorithm == 'fedprox' else 0.0
                app.train(model, data, int(os.environ['LOCAL_EPOCHS']), int(os.environ['BATCH_SIZE']),
                          float(os.environ['LEARNING_RATE']), mu,
                          int(os.environ['SEED']) + previous['round'])
                result = {key: previous[key] for key in ('algorithm', 'dataset', 'model')}
                result.update(round=previous['round'] + 1, baseRound=previous['round'],
                              clientId=os.environ['CLIENT_ID'], samples=len(data['y']), state=model.state_dict())
        compute_end = point()
        write_start = point()
        if args.stage == 'evaluate':
            output.write_text(json.dumps(result, allow_nan=False))
        else:
            torch.save(result, output)
        measurement.output(output)
        write_end = point()
    # Only successful calls publish a profile; neither report counts as business data.
    profile = dict(stage=args.stage, eagerLoad=True, torchThreads=torch.get_num_threads(),
                   read=span(read_start, read_end), compute=span(compute_start, compute_end),
                   write=span(write_start, write_end))
    profile_path.write_text(json.dumps(profile, allow_nan=False))
    return result, profile


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('stage', choices=['preprocess', 'init', 'train', 'aggregate', 'evaluate'])
    parser.add_argument('--input')
    parser.add_argument('--clients-manifest')
    parser.add_argument('--output')
    args = parser.parse_args()
    if not args.output:
        args.output = '/cea-work/out/' + ('prepared.pt' if args.stage == 'preprocess' else 'metrics.json' if args.stage == 'evaluate' else 'model.pt')
    if args.stage == 'train':
        os.environ['DATASET_PATH'] = '/cea-work/in/prepared_data'
    execute(args)
