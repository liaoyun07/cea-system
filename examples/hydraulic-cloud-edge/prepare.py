"""Offline conversion of all UCI 447 channels. Replay does not add unique samples."""
import argparse
import json
from pathlib import Path
import zipfile

import numpy as np

from app import CHANNELS, GROUPS, RATES, window_features


def prepare(source, output, replay):
    if replay < 1:
        raise ValueError("replay must be positive")
    output.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(source) as archive:
        labels = np.loadtxt(archive.open("profile.txt"), dtype=np.int16)
        if labels.shape != (2205, 5):
            raise ValueError("expected complete UCI 447 labels")
        stable = labels[:, 4] == 0
        healthy = np.all(labels[:, :4] == [100, 100, 0, 130], axis=1)
        normal = np.flatnonzero(stable & healthy)
        if len(normal) != 10:
            raise ValueError("expected 10 stable healthy source cycles")
        calibration = normal[:5]
        ids = np.arange(len(labels) * replay, dtype=np.int64)
        centers, scales = {}, {}
        for group, names in GROUPS.items():
            data = {"cycle_ids": ids}
            for name in names:
                values = np.loadtxt(archive.open(name + ".txt"), dtype=np.float32)
                if values.shape != (len(labels), 60 * RATES[name]) or not np.isfinite(values).all():
                    raise ValueError(f"invalid full source channel {name}")
                features = window_features(values[calibration], RATES[name])
                centers[name] = features.mean(axis=0)
                scales[name] = np.maximum(features.std(axis=0), 1e-6)
                data[name] = np.tile(values, (replay, 1)) if replay > 1 else values
            np.savez(output / f"{group}.npz", **data)
            print(group, "cycles", len(ids), "effective bytes", sum(v.nbytes for v in data.values()), flush=True)
        np.savez(output / "reference.npz", center=np.stack([centers[n] for n in CHANNELS], axis=1),
                 scale=np.stack([scales[n] for n in CHANNELS], axis=1), cycle_ids=ids,
                 calibration_ids=np.concatenate([calibration + i * len(labels) for i in range(replay)]),
                 healthy=np.tile(healthy, replay), stable=np.tile(stable, replay), unique_cycles=np.array(len(labels)))
        (output / "source.json").write_text(json.dumps({
            "source": "https://archive.ics.uci.edu/dataset/447/condition+monitoring+of+hydraulic+systems",
            "uniqueCycles": len(labels), "replay": replay, "processedCycles": len(ids),
            "calibrationSourceCycles": calibration.tolist(), "heldoutHealthySourceCycles": normal[5:].tolist(),
            "groupChannels": GROUPS, "sampleRatesHz": RATES, "dtype": "float32", "compressed": False
        }), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--replay", type=int, default=1)
    args = parser.parse_args()
    prepare(args.source, args.output, args.replay)
