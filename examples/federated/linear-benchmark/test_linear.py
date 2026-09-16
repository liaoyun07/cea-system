import copy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset
import model
import linear_app as candidate


class LinearTest(unittest.TestCase):
    def test_model_shapes_and_size(self):
        net = candidate.build_model('cifar10', 'linear')
        self.assertEqual(sum(p.numel() for p in net.parameters()), 30730)
        self.assertEqual({k: tuple(v.shape) for k, v in net.state_dict().items()},
                         candidate.model_shapes('cifar10', 'linear'))
        self.assertEqual(tuple(net(torch.zeros(2, 3, 32, 32)).shape), (2, 10))

    def test_mmap_preserves_all_saved_tensors(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'data.pt'
            saved = dict(dataset='cifar10', x=torch.rand(13, 3, 32, 32),
                         y=torch.arange(13) % 10, indices=torch.arange(13))
            torch.save(saved, path)
            loaded = candidate.mapped_load(path)
            for key, value in saved.items():
                if isinstance(value, torch.Tensor):
                    self.assertTrue(torch.equal(value, loaded[key]))
                else:
                    self.assertEqual(value, loaded[key])

    def test_batch_order_tail_rng_and_all_samples(self):
        data = TensorDataset(torch.arange(17).reshape(-1, 1), torch.arange(17))
        for batch_size in (1, 4, 32):
            for shuffle in (True, False):
                a_gen, b_gen = (torch.Generator().manual_seed(13) for _ in range(2))
                a = DataLoader(data, batch_size=batch_size, shuffle=shuffle, generator=a_gen)
                b = candidate.batch_loader(data, batch_size=batch_size, shuffle=shuffle, generator=b_gen)
                for _ in range(2):
                    seen = []
                    for old, new in zip(a, b, strict=True):
                        for x, y in zip(old, new, strict=True):
                            self.assertTrue(torch.equal(x, y))
                        seen.extend(new[1].tolist())
                    self.assertEqual(sorted(seen), list(range(17)))
                    self.assertTrue(torch.equal(a_gen.get_state(), b_gen.get_state()))

    def test_training_matches_independent_original_sgd(self):
        torch.set_num_threads(1)
        torch.manual_seed(5)
        data = {'x': torch.rand(35, 3, 32, 32), 'y': torch.arange(35) % 10}
        for mu in (0, .1):
            torch.manual_seed(13)
            expected = nn.Sequential(nn.Flatten(), nn.Linear(3072, 10))
            actual = copy.deepcopy(expected)
            anchors = [p.detach().clone() for p in expected.parameters()]
            optimizer = torch.optim.SGD(expected.parameters(), lr=.01)
            loader = DataLoader(TensorDataset(data['x'], data['y']), batch_size=8,
                                shuffle=True, generator=torch.Generator().manual_seed(13))
            for _ in range(2):
                for x, y in loader:
                    optimizer.zero_grad(set_to_none=True)
                    loss = nn.functional.cross_entropy(expected(x), y)
                    if mu:
                        loss += mu / 2 * sum((p-a).square().sum()
                                             for p, a in zip(expected.parameters(), anchors))
                    loss.backward()
                    optimizer.step()
            with patch.object(model, 'DataLoader', candidate.batch_loader):
                model.train(actual, data, 2, 8, .01, mu, 13)
            for a, b in zip(actual.parameters(), expected.parameters()):
                self.assertTrue(torch.equal(a, b))

    def test_aggregate_and_evaluation(self):
        torch.set_num_threads(1)
        a = candidate.build_model('cifar10', 'linear')
        b = candidate.build_model('cifar10', 'linear')
        common = dict(dataset='cifar10', model='linear', algorithm='fedavg', round=1, baseRound=0)
        updates = [{**common, 'clientId': str(i), 'samples': n, 'state': net.state_dict()}
                   for i, (net, n) in enumerate(((a, 3), (b, 7)))]
        with patch.object(model, 'model_state_shapes', candidate.model_shapes):
            result = model.aggregate(updates)
        for key in result['state']:
            self.assertTrue(torch.equal(result['state'][key],
                                        a.state_dict()[key] * .3 + b.state_dict()[key] * .7))
        data = {'x': torch.rand(41, 3, 32, 32), 'y': torch.arange(41) % 10}
        old = model.evaluate(a, data, 16)
        with patch.object(model, 'DataLoader', candidate.batch_loader):
            new = model.evaluate(a, data, 16)
            larger = model.evaluate(a, data, 1024)
        self.assertEqual(old, new)
        self.assertEqual(old['accuracy'], larger['accuracy'])
        self.assertAlmostEqual(old['loss'], larger['loss'], places=5)


if __name__ == '__main__':
    unittest.main()
