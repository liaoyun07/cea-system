import unittest
import torch
from prepare import COUNTS,partition


class PartitionTest(unittest.TestCase):
    def test_both_versions_equal_coverage_and_values(self):
        indices=torch.arange(60000)
        x=indices.float().reshape(-1,1)
        y=indices%10
        for version,counts in COUNTS.items():
            with self.subTest(version=version):
                shards=partition(indices,x,y,counts)
                self.assertEqual(tuple(len(d['y']) for d in shards),counts)
                self.assertTrue(torch.equal(torch.cat([d['indices'] for d in shards]).sort().values,indices))
                for shard in shards:
                    self.assertTrue(torch.equal(shard['x'].flatten(),shard['indices'].float()))
                    self.assertTrue(torch.equal(shard['y'],shard['indices']%10))
                self.assertEqual(set(shards[0]['y'].tolist()),{0} if version=='strong-noniid-v1' else {0,1,2,3})
        self.assertTrue(torch.equal(x.flatten(),indices.float()))


if __name__=='__main__':
    unittest.main()
