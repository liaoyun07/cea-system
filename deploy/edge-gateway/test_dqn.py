import random
import unittest
from unittest.mock import patch
from dqn import SCHEMA, decide, predict


def request():
    return {"model": {"stateSchema": SCHEMA, "weights1": [[2, 0, 0, 0, 0, 0]], "bias1": [-1],
            "weights2": [[1], [2], [3]], "bias2": [1, 1, 1]},
            "state": [1, 0, 0, 0, 0, 0], "legalActions": [0, 1], "exploration": 0}


class DqnTest(unittest.TestCase):
    def test_real_weights_relu_and_legal_mask(self):
        body = request()
        self.assertEqual(predict(body["model"], body["state"]), [2, 3, 4])
        with patch("dqn.time.perf_counter_ns", side_effect=[100000, 150000]):
            self.assertEqual(decide(body), {"action": 1, "inferenceMs": 0.05})
        body["legalActions"] = [0]
        self.assertEqual(decide(body)["action"], 0)

    def test_exploration_is_explicit_and_only_legal(self):
        body = request(); body["exploration"] = 1
        rng = random.Random(19)
        self.assertEqual({decide(body, rng)["action"] for _ in range(100)}, {0, 1})

    def test_old_or_malformed_network_and_state_rejected(self):
        for value in ([], [0]*13, [float("nan")]*6, [-1]*6):
            body = request(); body["state"] = value
            with self.assertRaises(ValueError): decide(body)
        for key, value in (("stateSchema", "terminal-slot-cost-v1"), ("weights1", [[0]*13]), ("bias2", [float("inf")]*3)):
            body = request(); body["model"][key] = value
            with self.assertRaises(ValueError): decide(body)

    def test_bad_masks_epsilon_or_extra_fields_rejected(self):
        for key, value in (("legalActions", []), ("legalActions", [0, 0]), ("legalActions", [True]),
                           ("legalActions", [3]), ("exploration", -1), ("exploration", 2), ("exploration", float("nan"))):
            body = request(); body[key] = value
            with self.assertRaises(ValueError): decide(body)
        body = request(); body["cluster"] = "not-an-offloading-decision"
        with self.assertRaises(ValueError): decide(body)


if __name__ == "__main__":
    unittest.main()
