import copy
import unittest
from unittest.mock import patch

import torch
from torch.utils.data import DataLoader, TensorDataset
import model
from bulk_loader import BulkTensorDataset, bulk_training_loader


class BulkTest(unittest.TestCase):
    def setUp(self):
        torch.set_num_threads(1)
        torch.manual_seed(13)

    def test_identical_batches_and_rng_state_across_epochs_and_remainder(self):
        for count, batch in ((1, 32), (17, 4), (17, 17), (17, 32), (1031, 1024)):
            with self.subTest(count=count, batch=batch):
                data = TensorDataset(torch.randn(count, 3, 4, 4), torch.arange(count))
                ga, gb = (torch.Generator().manual_seed(13) for _ in range(2))
                original = DataLoader(data, batch_size=batch, shuffle=True, generator=ga)
                candidate = bulk_training_loader(data, batch_size=batch, shuffle=True, generator=gb)
                for _ in range(3):
                    before, after = list(original), list(candidate)
                    self.assertEqual(len(before), len(after))
                    for a, b in zip(before, after):
                        self.assertTrue(all(torch.equal(x, y) for x, y in zip(a, b)))
                    self.assertTrue(torch.equal(ga.get_state(), gb.get_state()))

    def test_fetch_does_not_call_per_item_getitem(self):
        loader = bulk_training_loader(TensorDataset(torch.arange(19), torch.arange(19)),
                                      batch_size=8, shuffle=True)
        with patch.object(BulkTensorDataset, '__getitem__', side_effect=AssertionError('per-item fetch')):
            self.assertEqual(19, sum(len(y) for _, y in loader))

    def test_numerical_updates_match_for_both_algorithms_and_models(self):
        for dataset, shape in (('mnist', (1, 28, 28)), ('cifar10', (3, 32, 32)), ('cifar100', (3, 32, 32))):
            for name in ('mlp', 'cnn'):
                for mu in (0, 0.1):
                    with self.subTest(dataset=dataset, model=name, mu=mu):
                        data = {'x': torch.randn(9, *shape), 'y': torch.arange(9)}
                        original = model.build_model(dataset, name)
                        candidate = copy.deepcopy(original)
                        model.train(original, data, 2, 4, 0.01, mu, 13)
                        with patch.object(model, 'DataLoader', bulk_training_loader):
                            model.train(candidate, data, 2, 4, 0.01, mu, 13)
                        self.assertTrue(all(torch.equal(a, b) for a, b in zip(original.parameters(), candidate.parameters())))

    def test_evaluation_loader_is_unchanged(self):
        dataset = TensorDataset(torch.randn(12, 1, 28, 28), torch.arange(12) % 10)
        loader = bulk_training_loader(dataset, batch_size=4)
        self.assertIs(dataset, loader.dataset)
        network = model.build_model('mnist', 'mlp')
        data = dict(x=dataset.tensors[0], y=dataset.tensors[1])
        expected = model.evaluate(network, data, 4)
        with patch.object(model, 'DataLoader', bulk_training_loader):
            self.assertEqual(expected, model.evaluate(network, data, 4))


if __name__ == '__main__':
    unittest.main()
