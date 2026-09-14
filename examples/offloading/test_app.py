import math
import unittest
from app import features


class FeaturesTest(unittest.TestCase):
    def test_known_signal(self):
        result = features([1, 2, 3, 4], window=2)
        self.assertEqual(4, result["samples"])
        self.assertEqual(2.5, result["mean"])
        self.assertAlmostEqual(math.sqrt(7.5), result["rms"])
        self.assertEqual(0, result["alert_windows"])
        self.assertEqual(2, result["windows"])

    def test_alert_is_per_window_not_per_sample(self):
        result = features([5, 6, 0, 0, 7], window=2)
        self.assertEqual(2, result["alert_windows"])
        self.assertEqual(3, result["windows"])

    def test_empty_and_nonfinite_are_errors(self):
        for value in ([], [math.nan], [math.inf]):
            with self.assertRaises(ValueError):
                features(value)


if __name__ == "__main__":
    unittest.main()
