"""Independent numerical checks on downloaded live artifacts, not their reported metrics."""
import json
from pathlib import Path

import numpy as np

root = Path("/data")
checks = json.loads((root / "evidence/live-check.json").read_text())
for execution in checks:
    folder = root / "evidence" / execution["executionId"]
    if execution["flowId"] == "hydraulic-local":
        with np.load(root / "terminal/hydraulic.npz") as original, np.load(folder / "clean/cleaned.npz") as cleaned:
            for sensor in original.files:
                np.testing.assert_array_equal(original[sensor], cleaned[sensor])
            summaries = json.loads((folder / "clean/summary.json").read_text())["windows"]
            for row in summaries:
                rate = {"PS1": 100, "FS1": 10, "TS1": 1}[row["sensor"]]
                start = row["window_seconds"] * rate
                values = original[row["sensor"]][row["cycle"], start:start + 10 * rate]
                assert abs(sum(values) / len(values) - row["mean"]) < 1e-10
    elif execution["flowId"] == "bearing-return":
        diagnosis = json.loads((folder / "diagnose/diagnosis.json").read_text())
        baseline = json.loads((root / "bearing-evaluation.json").read_text())
        assert [r["class"] for r in diagnosis["windows"]] == baseline["expected_predictions"]
        receipt = json.loads((root / "evidence" / (execution["executionId"] + ".json")).read_text())
        assert receipt["response"]["result"] == diagnosis
    else:
        inspection = json.loads((folder / "inspect/inspection.json").read_text())
        report = json.loads((folder / "report/report.json").read_text())
        baseline = json.loads((root / "surface-evaluation.json").read_text())
        offline = {x["file"]: x["score"] for x in baseline["test"]}
        for row, source in zip(inspection["images"], baseline["replay"], strict=True):
            assert abs(row["score"] - offline[source]) < 1e-5
        assert report["images"] == len(inspection["images"])
        assert report["rejected"] == sum(i["score"] > inspection["threshold"] for i in inspection["images"])
        assert report["rejection_ratio"] == report["rejected"] / report["images"]
    print(execution["flowId"], "numerical audit PASS")
