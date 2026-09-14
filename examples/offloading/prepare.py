"""Generate clearly-labelled synthetic terminal sensor input and an independently calculated reference."""
import argparse
import json
import math
from pathlib import Path
import uuid

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    root = Path(args.output)
    root.mkdir(parents=True, exist_ok=True)
    manifest = root.parent / "signal-manifest.json"
    if manifest.exists():
        raise SystemExit("manifest already exists; do not overwrite accepted terminal input")
    file_id = str(uuid.uuid4())
    values = [float(f"{math.sin(i * .07) + .15 * math.sin(i * .51) + (6 if i % 8192 == 0 else 0):.8f}") for i in range(131072)]
    path = root / file_id
    path.write_text("".join(f"{v:.8f}\n" for v in values))
    path.chmod(0o444)
    expected = {"samples": len(values), "mean": sum(values) / len(values),
        "rms": (sum(x*x for x in values) / len(values)) ** .5, "peak": max(map(abs, values)),
        "windows": 128, "alert_windows": 16}
    manifest.write_text(json.dumps({"fileId": file_id, "bytes": path.stat().st_size,
        "source": "synthetic vibration signal; not a measured industrial dataset", "expected": expected}, indent=2))
