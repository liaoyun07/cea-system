import unittest
from unittest.mock import patch
from urllib.error import URLError
import scale_benchmark as benchmark


class BenchmarkTests(unittest.TestCase):
    def test_efficiency_and_latency_are_distinct(self):
        rows = [{"mode": mode, "formal": True, "status": "PASS", "durationSeconds": seconds}
                for mode, seconds in [("DEPLOYMENT", 10), ("WARM", 6)] for _ in range(10)]
        result = benchmark.summarize(rows)
        self.assertAlmostEqual(result["latencyReductionPercent"], 40)
        self.assertAlmostEqual(result["efficiencyIncreasePercent"], 66.6666667)
        self.assertTrue(result["efficiencyTarget20Passed"])

    def test_incomplete_or_failed_batch_cannot_pass(self):
        with self.assertRaises(AssertionError):
            benchmark.summarize([])

    def test_kubernetes_metric_units(self):
        self.assertEqual(benchmark.quantity("77Mi"), 77 * 1024 ** 2)
        self.assertAlmostEqual(benchmark.quantity("2000000n"), .002)
        self.assertAlmostEqual(benchmark.quantity("100m"), .1)

    def test_terminating_ready_pod_is_not_available(self):
        pod = {"metadata": {"deletionTimestamp": "now"}, "status": {"conditions": [{"type": "Ready", "status": "True"}]}}
        self.assertFalse(benchmark.ready(pod))

    def test_unclaimed_pod_cannot_count_as_serving(self):
        self.assertFalse(benchmark.serving({"metadata": {"labels": {"app": "warm-grafana"}}}))
        self.assertTrue(benchmark.serving({"metadata": {"labels": {"sandbox.users.io/online": "true"}}}))

    def test_initial_service_waits_for_real_dataplane(self):
        with patch.object(benchmark, "http", side_effect=["new", URLError("timeout")]):
            self.assertFalse(benchmark.base_http_ready("1.2.3.4", "new"))
        with patch.object(benchmark, "http", side_effect=["new", "old"]):
            self.assertFalse(benchmark.base_http_ready("1.2.3.4", "new"))
        with patch.object(benchmark, "http", return_value="new"):
            self.assertTrue(benchmark.base_http_ready("1.2.3.4", "new"))


if __name__ == "__main__":
    unittest.main()
