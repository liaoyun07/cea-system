"""Repeat the complete input dataset in one Job, not more unique samples."""
import argparse
import os
from pathlib import Path

import numpy as np

from app import GROUPS, edge, fuse, load, write_json
from cea_measurement import Measurement


def run(operation, input_dir, output_dir, passes):
    output_dir.mkdir(parents=True, exist_ok=True)
    metrics = []
    with Measurement(output_dir / "cea-measurement.json") as measurement:
        def read(name):
            with measurement.input(input_dir / name):
                return load(input_dir / name)

        def save(name, arrays):
            path = output_dir / name
            np.savez(path, **arrays)
            measurement.output(path)

        for batch in range(passes):
            if operation == "edge":
                data = read(f"raw-{batch}.npz")
                result = edge(data, os.environ["EDGE_GROUP"])
                del data
                save(f"features-{batch}.npz", result)
                del result
            else:
                parts = []
                for group in GROUPS:
                    data = read(f"{group}-{batch}.npz")
                    parts.append(edge(data, group) if operation == "central" else data)
                    del data
                reference = read("reference.npz")
                result, row = fuse(parts, reference, float(os.environ.get("Z_THRESHOLD", "3")))
                save(f"anomalies-{batch}.npz", result)
                metrics.append(row)
                del parts, reference, result
        if operation != "edge":
            report = {"operation": operation, "metrics": {"datasetPasses": passes,
                "uniqueCycles": metrics[0]["uniqueCycles"],
                "processedCycles": sum(row["cycleCount"] for row in metrics), "batches": metrics}}
            write_json(output_dir / "report.json", report)
            measurement.output(output_dir / "report.json")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=("edge", "central", "fuse"))
    parser.add_argument("--passes", type=int, choices=(1, 5, 10), required=True)
    parser.add_argument("--input", type=Path, default=Path("/cea-work/in"))
    parser.add_argument("--output", type=Path, default=Path("/cea-work/out"))
    args = parser.parse_args()
    run(args.operation, args.input, args.output, args.passes)
