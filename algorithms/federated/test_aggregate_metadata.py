"""FLPAR-16: aggregation validates metadata without materializing validation models."""
import copy
import unittest
from unittest.mock import patch

import torch
from model import aggregate, build_model, model_state_shapes


class AggregateMetadataTest(unittest.TestCase):
    def updates(self, dataset="cifar10", name="mlp", count=3):
        state = build_model(dataset, name).state_dict()
        return [{"algorithm": "fedavg", "dataset": dataset, "model": name, "round": 1,
                 "baseRound": 0, "clientId": str(i), "samples": i + 1,
                 "state": {key: torch.full_like(value, float(i)) for key, value in state.items()}}
                for i in range(count)]

    def test_shapes_follow_all_actual_models(self):
        for dataset in ("mnist", "cifar10", "cifar100"):
            for name in ("mlp", "cnn"):
                with self.subTest(dataset=dataset, model=name):
                    actual = build_model(dataset, name).state_dict()
                    self.assertEqual({k: tuple(v.shape) for k, v in actual.items()}, model_state_shapes(dataset, name))

    def test_exact_result_without_model_build_load_scan_or_input_mutation(self):
        for count in (1, 6, 9, 18):
            updates = self.updates(count=count)
            before = copy.deepcopy(updates)
            total = sum(u["samples"] for u in updates)
            expected = {k: sum(u["state"][k] * (u["samples"] / total) for u in updates)
                        for k in updates[0]["state"]}
            with patch("model.build_model", side_effect=AssertionError("validation allocated a model")), \
                 patch("model.checked_model", side_effect=AssertionError("validation loaded weights")), \
                 patch("torch.isfinite", side_effect=AssertionError("full weight scan")):
                result = aggregate(updates)
            for key in expected:
                self.assertTrue(torch.equal(expected[key], result["state"][key]))
            for a, b in zip(before, updates):
                for key in a["state"]:
                    self.assertTrue(torch.equal(a["state"][key], b["state"][key]))

    def test_invalid_first_and_later_shapes_names_and_types_rejected(self):
        for index in (0, 1):
            for error in ("missing", "extra", "shape", "broadcast", "not_tensor", "dtype"):
                with self.subTest(index=index, error=error):
                    updates = self.updates()
                    state = updates[index]["state"]
                    key = next(iter(state))
                    if error == "missing": del state[key]
                    elif error == "extra": state["unexpected"] = torch.ones(1)
                    elif error == "shape": state[key] = torch.zeros(1, 1)
                    elif error == "broadcast": state[key] = torch.zeros(1)
                    elif error == "not_tensor": state[key] = []
                    elif error == "dtype": state[key] = state[key].double()
                    with self.assertRaises(ValueError): aggregate(updates)

    def test_bad_declared_model_and_same_wrong_shape_in_every_client_rejected(self):
        updates = self.updates()
        for u in updates: u["state"]["1.weight"] = torch.ones(1)
        with self.assertRaises(ValueError): aggregate(updates)
        with self.assertRaises(ValueError): model_state_shapes("cifar10", "unknown")


if __name__ == "__main__":
    unittest.main()
