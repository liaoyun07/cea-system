import argparse
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import torch
from cea_measurement import Measurement, REPORT_NAME
from profile_compute import execute, PROFILE_NAME


def same(a, b):
    if isinstance(a, torch.Tensor):
        assert torch.equal(a, b)
    elif isinstance(a, dict):
        assert a.keys() == b.keys()
        for key in a:
            same(a[key], b[key])
    else:
        assert a == b


class ProfileTest(unittest.TestCase):
    def test_stages(self):
        import linear_app
        import app
        linear_app.install()
        torch.set_num_threads(1)
        env = dict(ALGORITHM='fedavg', MODEL='linear', SEED='13', TRAINING_DATASET='cifar10-train/v1',
                   TEST_DATASET='cifar10-test/v1', BATCH_SIZE='16', LOCAL_EPOCHS='1',
                   LEARNING_RATE='0.01', CLIENT_ID='edge-a1', PROX_MU='0')
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, env):
            root = Path(temp)
            torch.manual_seed(17)
            data = dict(dataset='cifar10', split='train', x=torch.randn(33, 3, 32, 32),
                        y=torch.arange(33) % 10, indices=torch.arange(33))
            torch.save(data, root / 'data.pt')
            torch.save({**data, 'split': 'test'}, root / 'test.pt')
            os.environ.update(DATASET_PATH=str(root/'data.pt'), TEST_DATASET_PATH=str(root/'test.pt'))
            for stage in ('init', 'train', 'aggregate', 'evaluate'):
                args = argparse.Namespace(stage=stage, input=str(root/'initial.pt' if stage=='train' else root/'aggregated.pt'),
                    clients_manifest=str(root/'manifest.json'), output=str(root/('metrics.json' if stage=='evaluate' else 'model.pt')))
                with Measurement(root/REPORT_NAME) as measurement:
                    app.run(args, measurement)
                reference = json.loads(Path(args.output).read_text()) if stage=='evaluate' else torch.load(args.output, weights_only=True)
                reference_bytes = json.loads((root/REPORT_NAME).read_text())
                result, profile = execute(args)
                same(reference, result)
                report = json.loads((root/REPORT_NAME).read_text())
                for side in ('inputs', 'outputs'):
                    assert sum(x['bytes'] for x in reference_bytes[side]) == sum(x['bytes'] for x in report[side])
                assert report['startedAt'] <= profile['read']['startedAt'] < profile['compute']['startedAt']
                assert profile['compute']['endedAt'] <= profile['write']['startedAt'] < report['endedAt']
                assert all(not f['path'].endswith(PROFILE_NAME) for f in report['outputs'])
                if stage=='init':
                    torch.save(result, root/'initial.pt')
                elif stage=='train':
                    torch.save(result, root/'client.pt')
                    (root/'manifest.json').write_text(json.dumps([str(root/'client.pt')]))
                elif stage=='aggregate':
                    torch.save(result, root/'aggregated.pt')

    def test_failure_has_no_profile(self):
        with tempfile.TemporaryDirectory() as temp:
            args = argparse.Namespace(stage='train', input='/missing.pt', output=temp+'/model.pt', clients_manifest=None)
            with self.assertRaises(FileNotFoundError):
                execute(args)
            self.assertFalse((Path(temp)/PROFILE_NAME).exists())
            self.assertFalse((Path(temp)/REPORT_NAME).exists())


class PreprocessTest(unittest.TestCase):
    def test_preprocess(self):
        from preprocess import run
        torch.set_num_threads(1)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            torch.manual_seed(13)
            raw = dict(dataset='cifar10', split='train', x=torch.randint(0,256,(33,3,32,32),dtype=torch.uint8),
                       y=torch.arange(33)%10, indices=torch.arange(33))
            torch.save(raw, root/'raw.pt')
            run(root/'raw.pt', root/'prepared.pt')
            reference = torch.load(root/'prepared.pt', weights_only=True)
            args = argparse.Namespace(stage='preprocess', input=str(root/'raw.pt'), output=str(root/'prepared.pt'), clients_manifest=None)
            result, _ = execute(args)
            same(reference, result)


if __name__ == '__main__':
    unittest.main()
