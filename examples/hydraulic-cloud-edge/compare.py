"""Identical hydraulic computation, placed centrally or on the three edges."""
import argparse
import os
from pathlib import Path

import numpy as np

from app import GROUPS, edge, fuse, load, write_json
from cea_measurement import Measurement


def calculate_central(paths, reference, threshold):
    # Keep only one raw shard resident at a time; do not handicap the baseline.
    parts = []
    for group, path in zip(GROUPS, paths):
        data = load(path)
        parts.append(edge(data, group))
        del data
    return fuse(parts, reference, threshold)


def run(operation, input_dir, output_dir):
    output_dir.mkdir(parents=True, exist_ok=True)
    with Measurement(output_dir / "cea-measurement.json") as measurement:
        def read(name):
            path = input_dir / name
            with measurement.input(path):
                return load(path)

        def save(name, arrays):
            path = output_dir / name
            np.savez(path, **arrays)
            measurement.output(path)

        if operation == "edge":
            group = os.environ["EDGE_GROUP"]
            save("features.npz", edge(read("raw.npz"), group))
        else:
            parts = []
            for group in GROUPS:
                data = read(f"{group}.npz")
                parts.append(edge(data, group) if operation == "central" else data)
                del data
            reference = read("reference.npz")
            result, metrics = fuse(parts, reference, float(os.environ.get("Z_THRESHOLD", "3")))
            save("anomalies.npz", result)
            write_json(output_dir / "report.json", {"operation": operation, "metrics": metrics})
            measurement.output(output_dir / "report.json")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=("edge", "central", "fuse"))
    parser.add_argument("--input", type=Path, default=Path("/cea-work/in"))
    parser.add_argument("--output", type=Path, default=Path("/cea-work/out"))
    args = parser.parse_args()
    run(args.operation, args.input, args.output)
