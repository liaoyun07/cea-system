"""Synthetic numerical fixtures only. Real execution-to-training coverage lives in ImageDistributionTest."""
import unittest
from train import dataset, fit


def fixtures():
    return [{"key": str(a), "strategy": "RULE", "startedAt": "fixture", "finishedAt": "fixture",
             "outcome": "SUCCESS", "reward": -1 - a, "action": a,
             "state": [0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]} for a in range(3)]


class TrainingTest(unittest.TestCase):
    def test_fit_uses_rewards_and_exports_java_shape(self):
        model, report = fit(fixtures(), updates=250)
        self.assertLess(report["afterMse"], report["beforeMse"] * 0.1)
        self.assertEqual(len(model["weights1"][0]), 13)
        self.assertEqual(len(model["weights2"]), 3)

    def test_missing_actions_are_not_fabricated(self):
        with self.assertRaises(ValueError):
            dataset(fixtures()[:2])

    def test_cancellation_and_incomplete_are_excluded(self):
        values = fixtures()
        values[0]["outcome"] = "CANCELLED"
        with self.assertRaises(ValueError):
            dataset(values)

    def test_invalid_mask_is_rejected(self):
        values = fixtures()
        values[0]["state"][1] = 0
        with self.assertRaises(ValueError):
            dataset(values)

    def test_duplicate_attempt_is_rejected(self):
        with self.assertRaises(ValueError):
            dataset(fixtures() + fixtures())


if __name__ == "__main__":
    unittest.main()
