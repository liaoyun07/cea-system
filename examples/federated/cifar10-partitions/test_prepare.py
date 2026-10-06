import unittest
import torch
from prepare import COUNTS,partition

class PartitionsTest(unittest.TestCase):
    def test_exact_coverage_and_values(self):
        indices=torch.arange(50000)
        x=indices.float().reshape(-1,1)
        y=indices%10
        for counts in COUNTS.values():
            shards=partition(indices,x,y,counts)
            self.assertEqual(tuple(len(s['y']) for s in shards),counts)
            self.assertTrue(torch.equal(torch.cat([s['indices'] for s in shards]).sort().values,indices))
            for s in shards:
                self.assertTrue(torch.equal(s['x'].flatten(),s['indices'].float()))
                self.assertTrue(torch.equal(s['y'],s['indices']%10))
        self.assertTrue(torch.equal(x.flatten(),indices.float()))

if __name__=='__main__':
    unittest.main()
