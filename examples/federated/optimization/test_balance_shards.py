import unittest
import torch
from balance_shards import balanced_sizes, repartition


class BalanceTest(unittest.TestCase):
    def test_counts(self):
        self.assertEqual(balanced_sizes(50000), [16667, 16667, 16666])
        self.assertEqual(balanced_sizes(60000), [20000] * 3)
        with self.assertRaises(ValueError):
            balanced_sizes(2)

    def test_only_boundaries_change(self):
        original = []
        for start, stop in ((0, 2), (2, 6), (6, 12)):
            original.append(dict(dataset='cifar10', split='train', indices=torch.arange(start, stop),
                                 y=torch.arange(start, stop) % 10,
                                 x=torch.arange(start, stop, dtype=torch.uint8).reshape(-1, 1, 1, 1)))
        result = repartition(original)
        self.assertEqual([len(s['y']) for s in result], [4, 4, 4])
        for key in ('x', 'y', 'indices'):
            self.assertTrue(torch.equal(torch.cat([s[key] for s in original]), torch.cat([s[key] for s in result])))
            for shard in result:
                self.assertEqual(shard[key].untyped_storage().nbytes(), shard[key].numel() * shard[key].element_size())
        result[0]['x'].zero_()
        self.assertEqual(original[0]['x'][1].item(), 1)

    def test_duplicate_source_rejected(self):
        shard = dict(dataset='cifar10', split='train', indices=torch.tensor([0]), y=torch.tensor([0]),
                     x=torch.zeros((1, 3, 32, 32), dtype=torch.uint8))
        with self.assertRaises(AssertionError):
            repartition([shard] * 3)


if __name__ == '__main__':
    unittest.main()
