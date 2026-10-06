import copy
import json
import os
from argparse import Namespace
from contextlib import nullcontext
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import torch
from torch.nn import functional as F

import gfed_hsam as core
import gfed_hsam_app as app
from model import checked_model, evaluate, train as sgd


CLIENTS = [{"id": "edge-a"}, {"id": "edge-b"}, {"id": "edge-c"}]


def data(seed=1, split="train", dataset="mnist"):
    channels, size = (1, 28) if dataset == "mnist" else (3, 32)
    return {"dataset": dataset, "split": split,
            "x": torch.randn(6, channels, size, size, generator=torch.Generator().manual_seed(seed)),
            "y": torch.arange(6, dtype=torch.long)}


def local(previous, client="edge-a", **kwargs):
    options = dict(epochs=1, batch_size=3, learning_rate=.01, phi=.001,
                   rho0=.05, rho1=.05, alpha=.5, beta=.5, gamma=1., seed=31)
    options.update(kwargs)
    return core.train(previous, data(), client, **options)


class Files:
    def input(self, path):
        return nullcontext(path)

    def output(self, path):
        self.last = path


class GfedHsamTest(unittest.TestCase):
    def test_four_real_gradients_match_independent_calculation(self):
        # Tiny non-linear classifier, no stochastic layers; four distinct points.
        model = torch.nn.Sequential(torch.nn.Linear(2, 3), torch.nn.Tanh(), torch.nn.Linear(3, 2))
        x, y = torch.tensor([[.2, -.4], [1., .6]]), torch.tensor([0, 1])
        base = core.flat(model)
        dual = torch.linspace(-.01, .01, len(base))
        global_s = torch.linspace(.01, -.005, len(base))
        rho0, rho1, alpha, beta, gamma = .04, .08, .3, .6, .7
        reference = copy.deepcopy(model)

        def gradient(vector):
            torch.nn.utils.vector_to_parameters(vector, reference.parameters())
            return torch.cat([g.reshape(-1) for g in torch.autograd.grad(
                F.cross_entropy(reference(x), y), tuple(reference.parameters()))]).detach()

        def normalized(v):
            return v / v.norm().clamp_min(1e-12)

        g0 = gradient(base)
        s0 = rho0 * normalized(g0 - dual - global_s)
        g1 = gradient(base + s0)
        s1 = rho1 * normalized(g1 - g0 - dual - global_s)
        g2 = gradient(base + s1)
        g3 = gradient(base + s1 + rho1 * normalized(g2))
        expected = g3 + beta * (alpha * g1 + (1-alpha) * g3 - gamma * (beta*g0 + (1-beta)*g2))
        actual, disturbance, next_dual = core.hsam_gradient(
            model, x, y, global_s, dual, rho0, rho1, alpha, beta, gamma)
        torch.testing.assert_close(actual, expected)
        torch.testing.assert_close(disturbance, s0 + s1)
        torch.testing.assert_close(next_dual, dual + s0 + s1 - global_s)
        torch.testing.assert_close(core.flat(model), base)
        self.assertGreater(float((g1 - g0).norm()), 0)
        self.assertGreater(float((g3 - g2).norm()), 0)

    def test_zero_radius_no_regularizer_reduces_to_existing_sgd(self):
        initial = core.initialize("mnist", "mlp", CLIENTS, 31)
        reference = checked_model(initial)
        sgd(reference, data(), 1, 3, .01, 0, 31)
        actual = local(initial, rho0=0, rho1=0, phi=0)
        torch.testing.assert_close(core.flat(checked_model(actual)), core.flat(reference))

    def test_radii_and_cross_round_states_actually_change_training(self):
        initial = core.initialize("mnist", "mlp", CLIENTS, 31)
        base = local(initial)
        candidates = [local(initial, rho0=.2), local(initial, rho1=.2)]
        changed = copy.deepcopy(initial)
        changed["globalPerturbation"] = torch.linspace(-.05, .05, len(changed["globalDrift"]))
        candidates.append(local(changed))
        changed = copy.deepcopy(initial)
        changed["perturbationDual"]["edge-a"].fill_(.1)
        candidates.append(local(changed))
        changed = copy.deepcopy(initial)
        changed["clientDrift"]["edge-a"].fill_(.2)
        candidates.append(local(changed, phi=.1))
        for result in candidates:
            self.assertFalse(torch.equal(core.flat(checked_model(base)), core.flat(checked_model(result))))
        self.assertEqual(initial["round"], 0)
        self.assertEqual(float(initial["perturbationDual"]["edge-a"].norm()), 0)

    def test_two_rounds_serialized_state_and_server_equations(self):
        current = core.initialize("mnist", "mlp", CLIENTS, 31)
        with tempfile.TemporaryDirectory() as folder:
            for r in range(2):
                previous = copy.deepcopy(current)
                updates = [local(previous, client["id"]) for client in CLIENTS]
                anchor = core.flat(checked_model(previous))
                mean = torch.stack([core.flat(checked_model(u)) for u in updates]).mean(0)
                expected_drift = previous["globalDrift"] + anchor - mean
                expected_s = .05 * core.unit(torch.stack([u["perturbationResidual"] for u in updates]).mean(0))
                current = core.aggregate(previous, updates, .05)
                torch.testing.assert_close(core.flat(checked_model(current)), mean - expected_drift)
                torch.testing.assert_close(current["globalDrift"], expected_drift)
                torch.testing.assert_close(current["globalPerturbation"], expected_s)
                for u in updates:
                    client = u["clientId"]
                    torch.testing.assert_close(current["clientDrift"][client],
                        previous["clientDrift"][client] + anchor - core.flat(checked_model(u)))
                    torch.testing.assert_close(current["perturbationDual"][client], u["perturbationDual"])
                file = Path(folder) / "model.pt"
                torch.save(current, file)
                current = torch.load(file, weights_only=True)
                self.assertEqual(current["round"], r + 1)
            self.assertGreater(float(current["globalPerturbation"].norm()), 0)
            self.assertEqual(evaluate(checked_model(current), data(split="test"), 3)["samples"], 6)

    def test_wrong_round_duplicate_or_missing_client_rejected(self):
        initial = core.initialize("mnist", "mlp", CLIENTS, 31)
        updates = [local(initial, client["id"]) for client in CLIENTS]
        for invalid in [updates[:2], [updates[0], updates[0], updates[2]]]:
            with self.assertRaisesRegex(ValueError, "exactly one"):
                core.aggregate(initial, invalid, .05)
        updates[0]["baseRound"] = 8
        with self.assertRaisesRegex(ValueError, "current round"):
            core.aggregate(initial, updates, .05)

    def test_cnn_and_lenet_reuse_platform_models(self):
        for dataset, name in [("mnist", "cnn"), ("cifar10", "cnn"), ("cifar10", "lenet"), ("cifar100", "mlp")]:
            initial = core.initialize(dataset, name, CLIENTS[:1], 31)
            result = core.train(initial, data(dataset=dataset), "edge-a", 1, 6, .001, .001,
                                .05, .05, .5, .5, 1., 31)
            final = core.aggregate(initial, [result], .05)
            self.assertEqual(evaluate(checked_model(final), data(dataset=dataset, split="test"), 6)["samples"], 6)

    def test_cli_file_protocol(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            initial = folder / "initial.pt"
            args = Namespace(stage="init", input="", clients_manifest=None, output=str(initial))
            env = {"MODEL": "mlp", "CLIENTS": json.dumps(CLIENTS), "SEED": "31",
                   "TRAINING_DATASET": "mnist-train/strong-noniid-v1", "TEST_DATASET": "mnist-test/v1"}
            with patch.dict(os.environ, env):
                app.run(args, Files())
            paths = []
            for i, client in enumerate(CLIENTS):
                dataset, output = folder / f"data-{i}.pt", folder / f"client-{i}.pt"
                torch.save(data(i), dataset)
                args = Namespace(stage="train", input=str(initial), clients_manifest=None, output=str(output))
                with patch.dict(os.environ, {"CLIENT_ID": client["id"], "DATASET_PATH": str(dataset),
                        "LOCAL_EPOCHS": "1", "BATCH_SIZE": "3", "LEARNING_RATE": ".01", "PHI": ".001",
                        "RHO_0": ".05", "RHO_1": ".05", "HSAM_ALPHA": ".5", "HSAM_BETA": ".5",
                        "HSAM_GAMMA": "1", "SEED": "31"}):
                    app.run(args, Files())
                paths.append(str(output))
            manifest, output = folder / "clients.json", folder / "global.pt"
            manifest.write_text(json.dumps(paths))
            with patch.dict(os.environ, {"RHO_0": ".05"}):
                app.run(Namespace(stage="aggregate", input=str(initial), clients_manifest=str(manifest), output=str(output)), Files())
            dataset, metrics = folder / "test.pt", folder / "metrics.json"
            torch.save(data(split="test"), dataset)
            with patch.dict(os.environ, {"TEST_DATASET_PATH": str(dataset), "BATCH_SIZE": "3"}):
                app.run(Namespace(stage="evaluate", input=str(output), output=str(metrics)), Files())
            self.assertEqual(json.loads(metrics.read_text())["round"], 1)


if __name__ == "__main__":
    unittest.main()
