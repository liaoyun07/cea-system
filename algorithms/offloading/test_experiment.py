import unittest

# Summary tests do not contact a terminal or collect performance measurements.
from experiment import summary


class SummaryTest(unittest.TestCase):
    def test_failures_and_missing_do_not_disappear(self):
        report = summary([
            {"success": True, "elapsedSeconds": 2},
            {"success": True, "elapsedSeconds": 4},
            {"success": True, "elapsedSeconds": None},
            {"success": False, "elapsedSeconds": 0.1},
        ])
        self.assertEqual(4, report["submitted"])
        self.assertEqual(.75, report["successRate"])
        self.assertEqual(3, report["meanSeconds"])
        self.assertEqual(4, report["p95Seconds"])
        self.assertEqual(1, report["failedOrUnconfirmed"])
        self.assertEqual(1, report["missingSuccessfulMeasurement"])

    def test_nearest_rank_and_empty(self):
        report = summary([{"success": True, "elapsedSeconds": n} for n in range(1, 21)])
        self.assertEqual(19, report["p95Seconds"])
        self.assertIsNone(summary([])["meanSeconds"])
        self.assertIsNone(summary([])["successRate"])
