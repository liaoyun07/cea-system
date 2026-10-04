import math
from pathlib import Path
import statistics
import tempfile
import unittest

import numpy as np

from app import CHANNELS, GROUPS, RATES, bytes_of, edge, fuse, interval_union, load, window_features


class HydraulicTest(unittest.TestCase):
    def test_native_windows_against_scalar_reference(self):
        for rate in (1, 10, 100):
            data = (np.arange(120 * rate, dtype=np.float32).reshape(2, -1) * 0.125 + 70)
            actual = window_features(data, rate)
            expected = []
            for row in data:
                windows = []
                for samples in np.split(row, 6):
                    values = [float(v) for v in samples]
                    windows.append([statistics.mean(values), statistics.pstdev(values), min(values), max(values),
                                    math.sqrt(math.fsum(v * v for v in values) / len(values))])
                expected.append(windows)
            np.testing.assert_allclose(actual, expected, rtol=1e-12, atol=1e-12)

    def test_edge_consumes_exact_channels_and_cycles(self):
        data = {name: np.ones((2, 60 * RATES[name]), dtype=np.float32) for name in GROUPS["edge-a"]}
        data["cycle_ids"] = np.arange(2)
        result = edge(data, "edge-a")
        self.assertEqual(set(result), set(data))
        self.assertEqual(bytes_of(result), 16 + 3 * 2 * 6 * 5 * 8)
        data["unused"] = np.zeros(1)
        with self.assertRaisesRegex(ValueError, "exactly"):
            edge(data, "edge-a")

    def test_constant_and_low_variance_statistics(self):
        data = np.full((3, 6000), 700, dtype=np.float32)
        data[1, ::2] += np.float32(0.001)
        data[2, ::3] -= np.float32(0.05)
        actual = window_features(data, 100)
        windows = data.astype(np.float64).reshape(3, 6, 1000)
        np.testing.assert_allclose(actual[:, :, 1], windows.std(axis=2), rtol=1e-4, atol=1e-9)
        self.assertTrue((actual[0, :, 1] == 0).all())

    def test_strided_large_offset_and_random_windows(self):
        rng = np.random.default_rng(2026)
        for rate in (1, 10, 100):
            values = (rng.normal(size=(5, 120 * rate)) * 0.01 + 700).astype(np.float32)[:, ::2]
            self.assertFalse(values.flags.c_contiguous)
            actual = window_features(values, rate)
            windows = values.astype(np.float64).reshape(5, 6, 10 * rate)
            expected = np.stack((windows.mean(axis=2), windows.std(axis=2), windows.min(axis=2),
                                 windows.max(axis=2), np.sqrt((windows ** 2).mean(axis=2))), axis=2)
            np.testing.assert_allclose(actual, expected, rtol=1e-11, atol=1e-12)

    def test_cloud_alignment_scores_and_calibration_exclusion(self):
        parts = [{"cycle_ids": np.arange(2), **{name: np.ones((2, 6, 5)) for name in names}}
                 for names in GROUPS.values()]
        parts[0]["PS1"][1, 0, 0] += 10
        reference = {"cycle_ids": np.arange(2), "center": np.ones((6, 17, 5)),
                     "scale": np.full((6, 17, 5), 2.0), "calibration_ids": np.array([0]),
                     "stable": np.array([True, True]), "healthy": np.array([True, False]),
                     "unique_cycles": np.array(2)}
        result, metrics = fuse(parts, reference, 3)
        self.assertEqual(result["window_scores"][1, 0], 5)
        self.assertEqual(metrics["truePositives"], 1)
        self.assertEqual(metrics["evaluatedStableCycles"], 1)
        self.assertEqual(metrics["falsePositives"], 0)
        parts[1]["cycle_ids"] = np.array([1, 0])
        with self.assertRaisesRegex(ValueError, "alignment"):
            fuse(parts, reference, 3)

    def test_invalid_numbers_fail(self):
        data = np.ones((1, 6000), dtype=np.float32)
        for invalid in (np.nan, np.inf, -np.inf):
            data[0, 0] = invalid
            with self.assertRaisesRegex(ValueError, "non-finite"):
                window_features(data, 100)

    def test_intervals_overlap_once_and_keep_serial_cloud(self):
        profiles = [{"startedNs": a * 10**9, "endedNs": b * 10**9} for a, b in [(1, 4), (2, 6), (10, 12)]]
        self.assertEqual(interval_union(profiles), 7)

    def test_npz_is_fully_loaded(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "input.npz"
            np.savez(path, a=np.arange(10), b=np.ones((2, 3), dtype=np.float32))
            actual = load(path)
            path.unlink()
            self.assertEqual(bytes_of(actual), 104)
            self.assertEqual(actual["a"].sum(), 45)


if __name__ == "__main__":
    unittest.main()
