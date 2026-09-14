"""Create private probes using existing EP-01 data and original algorithm outputs.

Run in the existing edge-processing image; no training/download or production writes.
"""
import base64
import json
from pathlib import Path
import tempfile
import zipfile
import numpy as np
import app as original

root = Path("/data")
out = Path("/evidence")
out.mkdir(parents=True, exist_ok=True)


def save(kind, body, expected):
    (out / f"{kind}.json").write_text(json.dumps({"body": base64.b64encode(body).decode(), "expected": expected}, allow_nan=False))


# Real held-out CWRU segment. Expected scalar statistics do not call the new server.
with np.load(root / "terminal/bearing.npz", allow_pickle=False) as data:
    samples = data["signal"][0].astype(float)
save("signal", json.dumps({"samples": samples.tolist()}).encode(),
     {"samples": len(samples), "mean": float(sum(samples) / len(samples)),
      "rms": float(np.sqrt(sum(samples * samples) / len(samples))), "peak": float(max(abs(samples))),
      "windows": 2, "alert_windows": sum(bool(max(abs(block)) > 4) for block in np.array_split(samples, 2))})

with tempfile.TemporaryDirectory() as directory:
    work = Path(directory)
    original.bearing(root / "terminal/bearing.npz", root / "models/bearing.joblib", work)
    save("bearing", (root / "terminal/bearing.npz").read_bytes(), json.loads((work / "diagnosis.json").read_text()))
    original.surface(root / "terminal/surface.zip", root / "models/tile.pt", work)
    expected = json.loads((work / "inspection.json").read_text())["images"][0]
    with zipfile.ZipFile(root / "terminal/surface.zip") as archive:
        save("surface", archive.read(archive.namelist()[0]), expected)

print("Prepared three probes from existing held-out samples; no model retraining")
