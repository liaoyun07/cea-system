"""Numerical fixtures, not a benchmark or fabricated production samples."""
import copy
import math
import unittest
import torch
from train import dataset, fit, double_target, export, network


def fixtures():
    rows = []
    for i in range(4):
        raw = [1, i, 0, 0, 0.1, 0.2]
        rows.append({"key": str(i), "applicationId": "fixture", "applicationVersion": "v1", "workload": {},
            "finishedAt": "fixture", "outcome": "SUCCESS", "action": i % 3, "reward": -(i + 1) / 120,
            "state": [math.log1p(v) for v in raw], "measurement": {"inputs": raw, "legalActions": [0, 1, 2],
            "edge": "edge", "flowId": "fixture", "trainable": i < 3, "nextKey": str(i + 1) if i < 3 else None,
            "feedbackOutcome": "SUCCESS", "elapsedSeconds": i + 1, "limitSeconds": 120}})
    for i in range(3):
        rows[i]["measurement"].update(nextState=list(rows[i+1]["state"]), nextLegalActions=[0, 1, 2])
    return rows


class TrainingTest(unittest.TestCase):
    def test_double_target_selects_online_but_evaluates_target_with_mask(self):
        online, target = torch.nn.Linear(6, 3).double(), torch.nn.Linear(6, 3).double()
        with torch.no_grad():
            online.weight.zero_(); online.bias.copy_(torch.tensor([3., 2., 100.]))
            target.weight.zero_(); target.bias.copy_(torch.tensor([4., 9., 999.]))
        result = double_target(online, target, torch.zeros(1, 6).double(), torch.tensor([-1.]).double(), torch.tensor([[True, True, False]]), .5)
        self.assertEqual(result.item(), 1.)
        self.assertFalse(result.requires_grad)

    def test_training_uses_replay_bootstrap_and_target_sync(self):
        model, report = fit(fixtures(), updates=100)
        self.assertEqual(len(model["weights1"][0]), 6)
        self.assertEqual(report["transitions"], 3)
        self.assertEqual(report["targetSyncs"], 2)
        self.assertNotEqual(model, export(network()))
        self.assertTrue(math.isfinite(report["lastLoss"]))

    def test_missing_actions_and_truncated_next_are_not_invented(self):
        with self.assertRaises(ValueError): dataset(fixtures()[:3])
        rows = fixtures(); rows[0]["measurement"]["trainable"] = False
        with self.assertRaises(ValueError): dataset(rows)

    def test_duplicate_and_cross_stream_are_rejected(self):
        with self.assertRaises(ValueError): dataset(fixtures() + fixtures())
        rows = fixtures(); rows[2]["measurement"]["flowId"] = "different"
        with self.assertRaises(ValueError): dataset(rows)

    def test_next_state_is_actual_referenced_decision(self):
        rows = copy.deepcopy(fixtures()); rows[0]["measurement"]["nextState"][0] = 999
        with self.assertRaises(ValueError): dataset(rows)

    def test_invalid_reward_action_and_old_schema_are_rejected(self):
        for key, value in [("reward", -99), ("action", 7), ("state", [0]*13)]:
            rows = fixtures(); rows[0][key] = value
            with self.assertRaises(ValueError): dataset(rows)

    def test_nonfinite_raw_and_normalization_are_rejected(self):
        for value in (float("nan"), -1, 99):
            rows = fixtures(); rows[0]["measurement"]["inputs"][0] = value
            with self.assertRaises(ValueError): dataset(rows)


if __name__ == "__main__":
    unittest.main()
