import copy
import random
import json
import tempfile
from pathlib import Path
import unittest
import torch
from environment import Environment, POSITIONS, SIZES, arrivals, choose, rollout, rule, calibrate
from train_sim import export, inference, targets, balanced_batch


def calibration(service=2, lag=1):
    return {"cells": {f"{p}:{s}": {"service": [service] * 3, "releaseLag": [lag] * 3,
                                  "uploadFactor": [1] * 3} for p in POSITIONS for s in SIZES}}


def task(at=0, index=0, terminal=0, size="small"):
    return {"at": at, "index": index, "terminalIndex": terminal, "terminal": f"oil-terminal-{terminal + 1:03d}",
            "size": size, "bytes": SIZES[size], "seed": 31}


class SimulationTest(unittest.TestCase):
    def test_mixed_calibration_does_not_pool_fast_local_baseline(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            def row(p, s, duration):
                return {"state": "SUCCESS", "destination": p, "size": s, "bytes": SIZES[s],
                        "dispatchedAt": 10, "finishedAt": 10+duration, "observedAt": 11+duration,
                        "uploadStartedAt": 0, "uploadFinishedAt": SIZES[s]/12_500_000+.1}
            mixed = [row(p,s,37) for p in POSITIONS for s in SIZES if (p,s) != ("TERMINAL","large")]
            (folder/'mixed.json').write_text(json.dumps({"tasks":mixed}))
            (folder/'local.json').write_text(json.dumps({"tasks":[row("TERMINAL",s,19) for s in SIZES]}))
            cells = calibrate(folder, ['mixed.json'], 'local.json')['cells']
            self.assertEqual(37, cells['TERMINAL:medium']['service'][1])
            self.assertEqual(['mixed.json'], cells['TERMINAL:medium']['sources'])
            self.assertEqual(19, cells['TERMINAL:large']['service'][1])
            self.assertFalse(cells['TERMINAL:large']['olderConfigurationFallback'])

    def test_balanced_replay_covers_rare_size_action_cells(self):
        buckets = {(size, action): [(size, action)] * (100 if size == "small" else 1)
                   for size in SIZES for action in range(3)}
        batch = balanced_batch(buckets, random.Random(31), 900)
        self.assertEqual(set(buckets), set(batch))
        self.assertTrue(all(60 < batch.count(key) < 140 for key in buckets))
    def test_trace_matches_existing_277(self):
        rows = arrivals(31)
        self.assertEqual(277, len(rows))
        self.assertEqual([167, 103, 7], [sum(t["size"] == s for t in rows) for s in SIZES])

    def test_frozen_baselines_match_measured_allocation(self):
        for name, counts in (("TERMINAL_30", [78, 192, 7]), ("TERMINAL_30_RANDOM10", [81, 181, 15])):
            actions = [rule(name)([], t) for t in arrivals(31)]
            self.assertEqual(counts, [actions.count(a) for a in range(3)])

    def test_local_queue_and_release_lag(self):
        env = Environment(calibration(), [task(), task(.5, 1)])
        self.assertEqual([5e6, 0, 0, 0, 0], env.state())
        env.act(0)
        self.assertEqual(5e6, env.state()[1])
        env.act(0)
        rows = env.finish()
        self.assertEqual([0, 3], [t["dispatchedAt"] for t in rows])
        self.assertEqual([2, 5], [t["finishedAt"] for t in rows])
        self.assertEqual([0] * 34, env.backlog)

    def test_upload_serial_but_compute_independent(self):
        env = Environment(calibration(), [task(), task(.1, 1), task(.2, 2)])
        env.state(); env.act(1)
        self.assertAlmostEqual(.31, env.state()[2]); env.act(2)
        env.state(); env.act(0)
        rows = env.finish()
        self.assertAlmostEqual(.41, rows[1]["uploadStartedAt"])
        self.assertAlmostEqual(.91, rows[1]["readyAt"])
        self.assertEqual(.2, rows[2]["dispatchedAt"])

    def test_remote_order_is_upload_ready_not_request(self):
        tasks = [task(size="large"), task(.1, terminal=1)]
        env = Environment(calibration(), tasks)
        env.capacity[30] = 1
        env.state(); env.act(1)
        self.assertEqual(500e6, env.state()[3]); env.act(1)
        a, b = env.finish()
        self.assertLess(b["dispatchedAt"], a["dispatchedAt"])

    def test_four_slots_release_only_after_observation(self):
        tasks = [task(terminal=i) for i in range(5)]
        _, _, rows = rollout(calibration(), tasks, lambda *_: 1)
        self.assertAlmostEqual(.41, rows[3]["dispatchedAt"])
        self.assertAlmostEqual(3.41, rows[4]["dispatchedAt"])

    def test_no_future_leakage_and_reproducibility(self):
        a = Environment(calibration(), [task(), task(100, 1)], 7, True)
        b = Environment(calibration(), [task(), task(1, 1, size="large")], 7, True)
        self.assertEqual(a.state(), b.state())
        a.act(1); b.act(1)
        self.assertEqual(a.records[0], b.records[0])
        for e in (a, b):
            e.finish()

    def test_terminal_transition_stops_bootstrap(self):
        net = torch.nn.Linear(5, 3)
        target = copy.deepcopy(net)
        with torch.no_grad():
            net.weight.zero_(); net.bias.copy_(torch.tensor([3., 2., 1.]))
            target.weight.zero_(); target.bias.copy_(torch.tensor([4., 9., 2.]))
        out = targets(net, target, torch.zeros(2, 5), torch.tensor([-1., -1.]), torch.tensor([0., 1.]), .5)
        self.assertEqual([1., -1.], out.tolist())

    def test_export_matches_gateway(self):
        torch.manual_seed(2)
        net = torch.nn.Sequential(torch.nn.Linear(5, 64), torch.nn.ReLU(), torch.nn.Linear(64, 3))
        model = export(net)
        for raw in ([5e6, 0, 0, 0, 0], [500e6, 5e8, 20, 2e9, 1e9]):
            action = inference(model)(raw, {})
            self.assertEqual(POSITIONS[action], choose("DQN", {}, raw, model))


if __name__ == "__main__":
    unittest.main()
