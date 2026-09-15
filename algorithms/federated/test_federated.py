import copy
import unittest
import tempfile
import os
from unittest.mock import patch
from pathlib import Path

import torch
from model import aggregate, build_model, check_data, dataset_from_refs, evaluate, train
from seed import idx, cifar, cifar_records, normalized


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
        for dataset, shape, classes in (("mnist", (1, 28, 28), 10), ("cifar10", (3, 32, 32), 10), ("cifar100", (3, 32, 32), 100)):
            for model in ("mlp", "cnn"):
                self.assertEqual((2, classes), tuple(build_model(dataset, model)(torch.zeros(2, *shape)).shape))

    def test_selected_dataset_pair_controls_init_without_loading_data(self):
        import argparse
        from app import run
        from cea_measurement import Measurement
        for dataset in ("mnist", "cifar10", "cifar100"):
            with self.subTest(dataset=dataset), tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / "model.pt"
                with patch.dict(os.environ, {"ALGORITHM": "fedavg", "TRAINING_DATASET": dataset + "-train/v1",
                                             "TEST_DATASET": dataset + "-test/v1", "MODEL": "mlp", "SEED": "13"}):
                    with Measurement(Path(directory) / "cea-measurement.json") as measurement:
                        run(argparse.Namespace(stage="init", output=str(output)), measurement)
                model = torch.load(output, weights_only=True)
                self.assertEqual(dataset, model["dataset"])
                self.assertEqual(100 if dataset == "cifar100" else 10, model["state"]["3.bias"].shape[0])
        for training, test in (("cifar100-train/v1", "cifar10-test/v1"),
                               ("mnist-train/v2", "mnist-test/v1"), ("unknown", "unknown")):
            with self.assertRaisesRegex(ValueError, "matching supported pair"):
                dataset_from_refs(training, test)

    def test_cifar100_labels_and_both_training_algorithms(self):
        data = {"dataset": "cifar100", "x": torch.randn(6, 3, 32, 32),
                "y": torch.tensor([0, 9, 10, 42, 98, 99])}
        check_data(data, {"dataset": "cifar100"})
        for mu in (0, 0.1):
            model = build_model("cifar100", "mlp")
            previous = copy.deepcopy(model.state_dict())
            train(model, data, 1, 3, .01, mu, 13)
            metrics = evaluate(model, data, 3)
            self.assertEqual(6, metrics["samples"])
            self.assertTrue(0 <= metrics["accuracy"] <= 1)
            self.assertTrue(any(not torch.equal(v, previous[k]) for k, v in model.state_dict().items()))
        for invalid in (-1, 100):
            with self.assertRaisesRegex(ValueError, "invalid dataset values"):
                check_data(dict(data, y=torch.full((6,), invalid)), {"dataset": "cifar100"})
        with self.assertRaisesRegex(ValueError, "does not match"):
            check_data(data, {"dataset": "cifar10"})

    def test_cifar_binary_channels_and_fine_labels(self):
        pixels = bytes([0]) * 1024 + bytes([127]) * 1024 + bytes([255]) * 1024
        for header, label_bytes, classes, expected in ((bytes([9]), 1, 10, 9), (bytes([7, 99]), 2, 100, 99)):
            x, y = cifar_records(header + pixels, label_bytes, classes, 1)
            self.assertEqual((1, 3, 32, 32), tuple(x.shape))
            self.assertEqual(expected, int(y[0]))
            self.assertEqual([0, 127, 255], x[0, :, 0, 0].tolist())
            scaled = normalized(x, "cifar100")
            self.assertEqual(-1, float(scaled[0, 0, 0, 0]))
            self.assertEqual(1, float(scaled[0, 2, 0, 0]))
        with self.assertRaisesRegex(ValueError, "record length"):
            cifar_records(b"bad", 2, 100, 1)
        with self.assertRaisesRegex(ValueError, "class label"):
            cifar_records(bytes([0, 100]) + pixels, 2, 100, 1)

    def test_corrupt_cifar_archives_rejected_before_parsing(self):
        for dataset, filename in (("cifar10", "cifar-10-binary.tar.gz"), ("cifar100", "cifar-100-binary.tar.gz")):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / filename).write_bytes(b"not genuine CIFAR")
                with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                    cifar(root, dataset)

    def test_corrupt_mnist_cache_is_rejected_instead_of_used(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "train-images-idx3-ubyte.gz").write_bytes(b"not genuine MNIST")
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                idx(root, "train-images-idx3-ubyte.gz", 2051)


if __name__ == "__main__":
    unittest.main()
