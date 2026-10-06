import unittest
from model import dataset_from_refs


class DatasetRefsTest(unittest.TestCase):
    def test_both_new_partitions_and_old_series(self):
        for version in ('v1','equal-noniid-v1','strong-noniid-v1'):
            self.assertEqual(dataset_from_refs(f'mnist-train/{version}','mnist-test/v1'),'mnist')
        for dataset in ('cifar10','cifar100'):
            self.assertEqual(dataset_from_refs(f'{dataset}-train/v1',f'{dataset}-test/v1'),dataset)

    def test_mismatch_and_unknown_versions_rejected(self):
        for train,test in [('mnist-train/strong-noniid-v1','cifar10-test/v1'),
            ('mnist-train/missing','mnist-test/v1'),('mnist-train/equal-noniid-v1','mnist-test/v2'),
            ('cifar10-train/strong-noniid-v1','cifar10-test/v1')]:
            with self.subTest(train=train,test=test),self.assertRaises(ValueError):
                dataset_from_refs(train,test)


if __name__=='__main__':
    unittest.main()
