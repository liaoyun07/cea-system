import tempfile
import unittest
from pathlib import Path

import numpy as np

from app import GROUPS, RATES, edge, fuse
from compare import calculate_central


class CompareTest(unittest.TestCase):
    def test_same_raw_shards_produce_identical_results(self):
        rng = np.random.default_rng(20261005)
        ids = np.arange(4)
        raw = [{"cycle_ids": ids, **{n: rng.normal(size=(4, 60 * RATES[n])).astype(np.float32)
                                    for n in names}} for names in GROUPS.values()]
        reference = {"cycle_ids": ids, "center": np.zeros((6, 17, 5)),
                     "scale": np.ones((6, 17, 5)), "calibration_ids": np.array([0]),
                     "stable": np.ones(4, dtype=bool), "healthy": np.zeros(4, dtype=bool),
                     "unique_cycles": np.array(4)}
        distributed, metrics = fuse([edge(data, group) for group, data in zip(GROUPS, raw)], reference, 3)
        with tempfile.TemporaryDirectory() as directory:
            paths = [Path(directory) / f"{g}.npz" for g in GROUPS]
            for path, data in zip(paths, raw):
                np.savez(path, **data)
            central, other_metrics = calculate_central(paths, reference, 3)
        self.assertEqual(metrics, other_metrics)
        for name in distributed:
            np.testing.assert_array_equal(distributed[name], central[name])


if __name__ == "__main__":
    unittest.main()
