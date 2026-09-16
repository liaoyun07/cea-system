import unittest
import torch
from prepare import doubled


class PackagingTest(unittest.TestCase):
    def test_two_real_copies_preserve_values_order_types_and_original(self):
        source = dict(dataset='cifar10', split='train',
                      x=torch.arange(24, dtype=torch.uint8).reshape(2, 3, 2, 2),
                      y=torch.tensor([3, 7]), indices=torch.tensor([11, 29]))
        result = doubled(source)
        for key in ('x', 'y', 'indices'):
            self.assertTrue(torch.equal(result[key][:2], source[key]))
            self.assertTrue(torch.equal(result[key][2:], source[key]))
            self.assertEqual(result[key].dtype, source[key].dtype)
            self.assertEqual(len(source[key]), 2)
            self.assertNotEqual(result[key].data_ptr(), source[key].data_ptr())
        self.assertEqual(result['dataset'], 'cifar10')
        self.assertEqual(result['split'], 'train')


if __name__ == '__main__':
    unittest.main()
