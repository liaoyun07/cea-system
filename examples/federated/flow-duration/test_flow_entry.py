import argparse
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import torch
import app
from cea_measurement import Measurement
from flow_entry import FilesWithoutTiming


class FlowEntryTest(unittest.TestCase):
    def equal(self,a,b):
        if torch.is_tensor(a):
            self.assertTrue(torch.equal(a,b))
        elif isinstance(a,dict):
            self.assertEqual(a.keys(),b.keys())
            for k,v in a.items():self.equal(v,b[k])
        elif isinstance(a,list):
            self.assertEqual(len(a),len(b))
            for x,y in zip(a,b):self.equal(x,y)
        else:self.assertEqual(a,b)

    def test_original_init_weights_identical_and_no_fake_report(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for algorithm in ('fedavg','fedcads'):
                environment={'ALGORITHM':algorithm,'SEED':'41','MODEL':'mlp',
                    'TRAINING_DATASET':'mnist-train/v1','TEST_DATASET':'mnist-test/v1',
                    'CLIENTS':'[{"id":"edge-a","weight":1},{"id":"edge-b","weight":2},{"id":"edge-c","weight":3}]','ROUNDS':'12'}
                with patch.dict(os.environ,environment):
                    args=argparse.Namespace(stage='init',input=None,clients_manifest=None,output=str(root/'measured.pt'))
                    with Measurement(root/'report.json') as measurement:
                        app.run(args,measurement)
                    args.output=str(root/'flow.pt')
                    app.run(args,FilesWithoutTiming())
                a=torch.load(root/'measured.pt',weights_only=True);b=torch.load(root/'flow.pt',weights_only=True)
                self.equal(a,b)
                assert not (root/'cea-measurement.json').exists()

    def test_business_failure_is_not_swallowed(self):
        with self.assertRaises(FileNotFoundError):
            app.run(argparse.Namespace(stage='evaluate',input='/nonexistent',output='/unused'),FilesWithoutTiming())


if __name__=='__main__':unittest.main()
