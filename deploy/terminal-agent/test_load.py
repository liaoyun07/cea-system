import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
from load import CgroupMeter, LoadClient, arrivals


class LoadTest(unittest.TestCase):
    def test_parent_cgroup_usage_and_quota(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for key, value in {"cpu.stat": "usage_usec 1000000\n", "cpu.max": "50000 100000", "memory.max": "536870912", "memory.current": "268435456"}.items():
                (root / key).write_text(value)
            meter = CgroupMeter(root)
            with patch("load.time.monotonic", side_effect=[10, 12]):
                self.assertIsNone(meter.read()["cpuSeconds"])
                (root / "cpu.stat").write_text("usage_usec 1500000\n")
                result = meter.read()
            self.assertEqual(0.5, result["cpuSeconds"])
            self.assertEqual(2, result["sampleSeconds"])
            self.assertEqual(0.5, result["cpuCores"])
            self.assertEqual(268435456, result["memoryBytes"])

    def test_arrivals_replay_and_independent_terminals(self):
        def trace(terminal):
            rng = arrivals(31, terminal)
            return [rng.expovariate(0.2) for _ in range(20)]
        self.assertEqual(trace("t1"), trace("t1"))
        self.assertNotEqual(trace("t1"), trace("t2"))
        self.assertGreater(len(set(trace("t1"))), 1)

    def test_stop_does_not_discard_pending(self):
        client = LoadClient({"resourceDirectory": "/unused"})
        command = {"runId": "r", "sending": False}
        client.update(command)
        client.pending = 2
        client.update(None)
        self.assertEqual("r", client.command["runId"])
        client.pending = 0
        client.update(None)
        self.assertIsNone(client.command)

    def test_real_elapsed_and_result_not_feedback_classification(self):
        client = LoadClient({"resourceDirectory": "/unused"})
        client.pending = 1
        with patch("load.request", side_effect=[{"executionId": "e"}, {"state": "SUCCESS", "result": {"rms": 1}}, {}]), \
             patch("load.time.perf_counter", side_effect=[10, 140]):
            client.execute("r", "q", {"fileId": "f", "bytes": 10})
        report = client.reports.get_nowait()
        self.assertEqual("SUCCESS", report["outcome"])
        self.assertEqual(130, report["elapsedSeconds"])
        self.assertEqual(0, client.pending)

    def test_network_error_not_algorithm_failure(self):
        client = LoadClient({"resourceDirectory": "/unused"})
        client.pending = 1
        with patch("load.request", side_effect=TimeoutError()):
            client.execute("r", "q", {"fileId": "f", "bytes": 10})
        self.assertEqual("UNKNOWN", client.reports.get_nowait()["outcome"])


if __name__ == "__main__":
    unittest.main()
