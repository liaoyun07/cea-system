import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from app import GROUPS, RATES, load
from repeat import run


class RepeatTest(unittest.TestCase):
    def test_every_pass_reads_writes_and_matches_central(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            source = base / "source"
            source.mkdir()
            reference = {"cycle_ids": np.arange(2), "center": np.zeros((6, 17, 5)),
                "scale": np.ones((6, 17, 5)), "calibration_ids": np.array([0]),
                "stable": np.ones(2, dtype=bool), "healthy": np.zeros(2, dtype=bool),
                "unique_cycles": np.array(2)}
            np.savez(source / "reference.npz", **reference)
            fusion = base / "fusion"
            fusion.mkdir()
            np.savez(fusion / "reference.npz", **reference)
            for group, names in GROUPS.items():
                edge_source = base / f"source-{group}"
                edge_source.mkdir()
                for batch in range(5):
                    # Distinct contents prevent a fake repeat returning only the last batch.
                    data = {"cycle_ids": np.arange(2), **{n: np.full((2, 60 * RATES[n]), batch+1, dtype=np.float32) for n in names}}
                    np.savez(source / f"{group}-{batch}.npz", **data)
                    np.savez(edge_source / f"raw-{batch}.npz", **data)
                output = base / f"output-{group}"
                with patch.dict(os.environ, EDGE_GROUP=group):
                    run("edge", edge_source, output, 5)
                for batch in range(5):
                    np.savez(fusion / f"{group}-{batch}.npz", **load(output / f"features-{batch}.npz"))
            central, distributed = base / "central", base / "distributed"
            run("central", source, central, 5)
            run("fuse", fusion, distributed, 5)
            import json
            for batch in range(5):
                a, b = load(central / f"anomalies-{batch}.npz"), load(distributed / f"anomalies-{batch}.npz")
                for key in a:
                    np.testing.assert_array_equal(a[key], b[key])
                self.assertEqual(a["window_scores"][1, 0], batch+1)
            report = json.loads((central / "report.json").read_text())
            self.assertEqual(report["metrics"]["processedCycles"], 10)
            self.assertEqual(report["metrics"]["uniqueCycles"], 2)
            measurement = json.loads((central / "cea-measurement.json").read_text())
            self.assertEqual(len(measurement["inputs"]), 16)
            self.assertEqual(len(measurement["outputs"]), 6)


if __name__ == "__main__":
    unittest.main()
