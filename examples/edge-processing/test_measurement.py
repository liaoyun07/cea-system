import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import numpy as np


class WholeArchiveTest(unittest.TestCase):
    def run_cli(self, extra=False, operation="hydraulic"):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        fields = {name: np.ones((1, rate * 60)) for name, rate in {"PS1":100,"FS1":10,"TS1":1}.items()}
        if operation == "bearing":
            fields = {"signal": np.ones((1, 2048)), "sample_rate": 12000}
        if extra:
            fields["unused"] = np.ones(1000)
        source = root / "data.npz"
        np.savez_compressed(source, **fields)
        result = subprocess.run(["python", "/app/app.py", operation, "--input", str(source), "--output", str(root)], capture_output=True, text=True)
        return root, source, result

    def test_complete_archive_and_all_outputs_match_file_lengths(self):
        root, source, result = self.run_cli()
        self.assertEqual(0, result.returncode, result.stderr)
        report = json.loads((root / "cea-measurement.json").read_text())
        self.assertEqual(source.stat().st_size, report["inputs"][0]["bytes"])
        self.assertEqual(3, len(report["outputs"]))
        for item in report["outputs"]:
            self.assertEqual(Path(item["path"]).stat().st_size, item["bytes"])

    def test_unused_members_cannot_inflate_whole_file_count(self):
        for operation in ("hydraulic", "bearing"):
            root, _, result = self.run_cli(extra=True, operation=operation)
            self.assertNotEqual(0, result.returncode)
            self.assertIn("exactly the algorithm's input fields", result.stderr)
            self.assertFalse((root / "cea-measurement.json").exists())


if __name__ == "__main__":
    unittest.main()
