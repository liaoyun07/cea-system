import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import numpy as np
from app import anomaly, features, hydraulic, image_tensor, load_samples, report


class AlgorithmTest(unittest.TestCase):
    def test_native_rate_window_means_and_interpolation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            values = {k: np.arange(60 * rate, dtype=float)[None, :] for k, rate in {"PS1": 100, "FS1": 10, "TS1": 1}.items()}
            values["PS1"][0, 20] = np.nan  # Explicit fault fixture, not a fabricated public measurement.
            np.savez(root / "data.npz", **values)
            hydraulic(root / "data.npz", root)
            result = json.loads((root / "summary.json").read_text())
            self.assertEqual(499.5, result["windows"][0]["mean"])
            self.assertEqual(18, len(result["windows"]))
            self.assertEqual(1, json.loads((root / "metrics.json").read_text())["imputed_samples"])

    def test_invalid_cycle(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            np.savez(root / "data.npz", PS1=np.ones((1, 59)))
            with self.assertRaises(ValueError):
                hydraulic(root / "data.npz", root)

    def test_frequency_features_have_meaningful_peak(self):
        t = np.arange(2048) / 12000
        x = np.sin(2 * np.pi * 1000 * t)[None, :]
        value = features(x)[0]
        self.assertAlmostEqual(2 ** -.5, value[0], places=2)
        self.assertEqual(1, value[3:].argmax())
        self.assertAlmostEqual(1, value[3:].sum())
        with self.assertRaises(ValueError):
            features(np.ones((2, 10)))

    def test_report_computes_not_copies_metrics(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "data.json").write_text(json.dumps({"model": "test", "images": [
                {"score": 3, "defect": False}, {"score": 9, "defect": True}]}))
            report(root / "data.json", root)
            value = json.loads((root / "report.json").read_text())
            self.assertEqual(.5, value["rejection_ratio"])
            self.assertEqual(9, value["max_anomaly_score"])

    def test_bad_image_rejected(self):
        with self.assertRaises(Exception):
            image_tensor(b"not a png")

    def test_mahalanobis_distance_independent_closed_form(self):
        import torch
        state = {"indices": None, "mean": np.zeros((1024, 32)),
                 "inverse": np.tile(np.eye(32), (1024, 1, 1))}
        with patch("app.image_tensor", return_value=None), patch("app.embedding", return_value=torch.ones((1, 32, 32, 32))):
            score, heatmap = anomaly(None, state, b"")
        self.assertAlmostEqual(np.sqrt(32), score)
        np.testing.assert_allclose(heatmap, np.sqrt(32))

    def test_sample_archive_limit(self):
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as content:
            for i in range(9):
                content.writestr(str(i), b"x")
        archive.seek(0)
        with self.assertRaises(ValueError):
            load_samples(archive)


if __name__ == "__main__":
    unittest.main()
