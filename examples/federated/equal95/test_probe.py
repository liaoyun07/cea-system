import tempfile
import unittest
from pathlib import Path
import torch
from probe import repartition


class PartitionTest(unittest.TestCase):
    def test_equal_disjoint_preserves_original_samples_and_test(self):
        with tempfile.TemporaryDirectory() as folder:
            source=Path(folder)/'source'
            source.mkdir()
            cuts=(0,10000,30000,60000)
            for i,c in enumerate('abc'):
                indices=torch.arange(cuts[i],cuts[i+1])
                torch.save({'indices':indices,'x':indices.float().reshape(-1,1),
                    'y':indices%10,'dataset':'mnist','split':'train'},source/f'edge-{c}.pt')
            test={'x':torch.arange(10000).float().reshape(-1,1),'y':torch.arange(10000)%10,
                'dataset':'mnist','split':'test','indices':torch.arange(10000)}
            torch.save(test,source/'test.pt')
            shards,actual,manifest=repartition(source,Path(folder)/'equal')
            self.assertEqual([len(d['y']) for d in shards],[20000]*3)
            self.assertEqual(len(torch.unique(torch.cat([d['indices'] for d in shards]))),60000)
            for d in shards:
                self.assertTrue(torch.equal(d['x'].flatten(),d['indices'].float()))
                self.assertTrue(torch.equal(d['y'],d['indices']%10))
            self.assertTrue(torch.equal(actual['x'],test['x']))
            self.assertTrue(torch.equal(actual['y'],test['y']))
            self.assertIn('NOT IID',manifest['partition'])
            self.assertEqual(len(torch.load(source/'edge-a.pt',weights_only=True)['y']),10000)


if __name__=='__main__':
    unittest.main()
