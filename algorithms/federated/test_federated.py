import copy
import unittest
import tempfile
from pathlib import Path

import torch
from model import aggregate, build_model, check_data, evaluate, train
from seed import idx


class FederationTest(unittest.TestCase):
    def setUp(self):
        torch.manual_seed(17)
        self.data = {"dataset": "mnist", "x": torch.randn(12, 1, 28, 28),
                     "y": torch.arange(12) % 10}
        self.model = build_model("mnist", "mlp")

    def test_fedavg_and_zero_mu_are_equal_and_nonzero_mu_changes_weights(self):
        average, zero, proximal = (copy.deepcopy(self.model) for _ in range(3))
        train(average, self.data, 2, 4, 0.01, 0, 13)
        train(zero, self.data, 2, 4, 0.01, 0.0, 13)
        train(proximal, self.data, 2, 4, 0.01, 1.0, 13)
        self.assertTrue(all(torch.equal(a, z) for a, z in zip(average.parameters(), zero.parameters())))
        self.assertTrue(any(not torch.equal(a, p) for a, p in zip(average.parameters(), proximal.parameters())))
        distance = lambda model: sum((a - b).square().sum().item()
                                     for a, b in zip(model.parameters(), self.model.parameters()))
        self.assertLess(distance(proximal), distance(average))

    def update(self, client, samples, value):
        return {"algorithm": "fedavg", "dataset": "mnist", "model": "mlp", "round": 1,
                "baseRound": 0, "clientId": client, "samples": samples,
                "state": {k: torch.full_like(v, value) for k, v in self.model.state_dict().items()}}

    def test_weighted_aggregation_is_not_an_unweighted_mean(self):
        result = aggregate([self.update("a", 1, 1), self.update("b", 3, 3)])
        self.assertTrue(all(torch.equal(v, torch.full_like(v, 2.5)) for v in result["state"].values()))

    def test_rejects_duplicate_mixed_round_algorithm_and_invalid_weights(self):
        a, b = self.update("a", 1, 1), self.update("b", 3, 3)
        for key, value in (("round", 2), ("algorithm", "fedprox"), ("samples", 0), ("clientId", "a")):
            with self.subTest(key=key), self.assertRaises(ValueError):
                aggregate([a, dict(b, **{key: value})])
        b["state"][next(iter(b["state"]))].fill_(float("nan"))
        with self.assertRaises(ValueError):
            aggregate([a, b])
        with self.assertRaises(ValueError):
            aggregate([])

    def test_evaluation_is_global_and_read_only(self):
        state = copy.deepcopy(self.model.state_dict())
        metrics = evaluate(self.model, self.data, 4)
        self.assertEqual(12, metrics["samples"])
        self.assertTrue(0 <= metrics["accuracy"] <= 1)
        self.assertGreater(metrics["loss"], 0)
        self.assertTrue(all(torch.equal(v, state[k]) for k, v in self.model.state_dict().items()))

    def test_data_and_hyperparameters_are_validated(self):
        check_data(self.data, {"dataset": "mnist"})
        with self.assertRaises(ValueError):
            check_data(dict(self.data, y=torch.empty(0, dtype=torch.long)), {"dataset": "mnist"})
        with self.assertRaises(ValueError):
            check_data(self.data, {"dataset": "cifar10"})
        for epochs, batch, rate, mu in ((0, 4, .01, 0), (1, 0, .01, 0),
                                       (1, 4, float("nan"), 0), (1, 4, .01, -1)):
            with self.assertRaises(ValueError):
                train(self.model, self.data, epochs, batch, rate, mu, 1)

    def test_supported_models_produce_class_logits(self):
        for dataset, shape in (("mnist", (1, 28, 28)), ("cifar10", (3, 32, 32))):
            for model in ("mlp", "cnn"):
                self.assertEqual((2, 10), tuple(build_model(dataset, model)(torch.zeros(2, *shape)).shape))

    def test_corrupt_mnist_cache_is_rejected_instead_of_used(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "train-images-idx3-ubyte.gz").write_bytes(b"not genuine MNIST")
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                idx(root, "train-images-idx3-ubyte.gz", 2051)


if __name__ == "__main__":
    unittest.main()
