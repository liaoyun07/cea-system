import json
from pathlib import Path
import tempfile
import unittest
import uuid
from unittest.mock import patch
import compute


class ComputeFeedbackTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.file = self.root / str(uuid.uuid4())
        self.file.write_bytes(b"real local file")
        self.receipt = self.root / "receipt.json"
        self.execution = str(uuid.uuid4())
        self.calls = []

    def tearDown(self):
        self.temp.cleanup()

    def reply(self, config, path, body=None):
        self.calls.append((path, body))
        if path == "/v1/compute":
            return {"executionId": self.execution}
        if path.endswith("/feedback"):
            return {}
        return {"state": "SUCCESS", "result": {"rms": 2.0}}

    def test_same_process_timing_and_identical_feedback_retry(self):
        with patch.object(compute, "request", side_effect=self.reply), patch.object(compute.time, "perf_counter_ns", side_effect=[1000000000, 3500000000]):
            result = compute.run({}, "stats", self.file, self.receipt)
        self.assertEqual("SUCCESS", result["state"])
        saved = json.loads(self.receipt.read_text())
        self.assertEqual({"outcome": "SUCCESS", "elapsedSeconds": 2.5}, saved["feedback"])
        with patch.object(compute, "request", side_effect=self.reply), patch.object(compute.time, "perf_counter_ns", side_effect=AssertionError("must reuse persisted timing")):
            compute.run({}, "stats", self.file, self.receipt)
        self.assertEqual(saved["feedback"], self.calls[-1][1])
        self.assertEqual(1, sum(path == "/v1/compute" for path, _ in self.calls))

    def test_restart_does_not_invent_original_elapsed(self):
        self.receipt.write_text(json.dumps({"requestId": str(uuid.uuid4()), "eventType": "stats",
            "file": {"fileId": self.file.name, "bytes": self.file.stat().st_size}}))
        with patch.object(compute, "request", side_effect=self.reply):
            compute.run({}, "stats", self.file, self.receipt)
        self.assertEqual({"outcome": "UNMEASURED", "elapsedSeconds": None}, self.calls[-1][1])

    def test_lost_feedback_ack_does_not_change_success_or_elapsed(self):
        def reply(config, path, body=None):
            if path.endswith("/feedback"):
                raise TimeoutError()
            return self.reply(config, path, body)
        with patch.object(compute, "request", side_effect=reply):
            self.assertEqual("SUCCESS", compute.run({}, "stats", self.file, self.receipt)["state"])
        saved = json.loads(self.receipt.read_text())
        self.assertFalse(saved["feedbackAccepted"])
        with patch.object(compute, "request", side_effect=self.reply):
            compute.run({}, "stats", self.file, self.receipt)
        self.assertEqual(saved["feedback"], self.calls[-1][1])

    def test_failed_result_and_retry_remain_failed_with_original_feedback(self):
        def reply(config, path, body=None):
            if path != "/v1/compute" and not path.endswith("/feedback"):
                return {"state": "FAILED"}
            return self.reply(config, path, body)
        with patch.object(compute, "request", side_effect=reply):
            with self.assertRaises(RuntimeError):
                compute.run({}, "stats", self.file, self.receipt)
        saved = json.loads(self.receipt.read_text())
        self.assertEqual("FAILED", saved["feedback"]["outcome"])
        with patch.object(compute, "request", side_effect=self.reply):
            with self.assertRaises(RuntimeError):
                compute.run({}, "stats", self.file, self.receipt)
        self.assertEqual(saved["feedback"], self.calls[-1][1])

    def test_client_deadline_reports_full_same_process_elapsed_without_reexecution(self):
        with patch.object(compute, "request", side_effect=self.reply), patch.object(compute.time, "monotonic", side_effect=[0, 241]), patch.object(compute.time, "perf_counter_ns", side_effect=[1000000000, 242000000000]):
            with self.assertRaises(TimeoutError):
                compute.run({}, "stats", self.file, self.receipt)
        saved = json.loads(self.receipt.read_text())
        self.assertEqual({"outcome": "TIMEOUT", "elapsedSeconds": 241.0}, saved["feedback"])
        with patch.object(compute, "request", side_effect=self.reply):
            with self.assertRaises(TimeoutError):
                compute.run({}, "stats", self.file, self.receipt)
        self.assertEqual(1, sum(path == "/v1/compute" for path, _ in self.calls))


if __name__ == "__main__":
    unittest.main()
