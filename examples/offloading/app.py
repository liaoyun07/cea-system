"""Vibration-window features and threshold alerts; synthetic sensor validation, not a trained classifier."""
import json
import math
from pathlib import Path
import statistics


def features(samples, window=1024):
    if not samples or any(not math.isfinite(v) for v in samples):
        raise ValueError("nonempty finite signal required")
    mean = statistics.fmean(samples)
    rms = math.sqrt(statistics.fmean(v * v for v in samples))
    windows = [samples[i:i + window] for i in range(0, len(samples), window)]
    return {"samples": len(samples), "mean": mean, "rms": rms,
            "peak": max(abs(v) for v in samples), "windows": len(windows),
            "alert_windows": sum(max(abs(v) for v in block) > 4 for block in windows)}


if __name__ == "__main__":
    values = [float(line) for line in Path("/cea-work/in/signal.csv").read_text().splitlines()]
    Path("/cea-work/out/result.json").write_text(json.dumps(features(values), allow_nan=False))
