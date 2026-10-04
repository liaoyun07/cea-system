"""UCI hydraulic window features and cloud fusion; local files only."""
import argparse
import json
import os
from pathlib import Path
import time

import numpy as np
from native_stats import statistics as native_statistics

GROUPS = {
    "edge-a": ("PS1", "PS2", "PS3"),
    "edge-b": ("PS4", "PS5", "PS6"),
    "edge-c": ("EPS1", "FS1", "FS2", "TS1", "TS2", "TS3", "TS4", "VS1", "CE", "CP", "SE"),
}
RATES = {**{f"PS{i}": 100 for i in range(1, 7)}, "EPS1": 100, "FS1": 10, "FS2": 10,
         **{name: 1 for name in GROUPS["edge-c"][3:]}}
CHANNELS = tuple(name for group in GROUPS.values() for name in group)
FEATURES = ("mean", "std", "min", "max", "rms")


def load(path):
    # Eager materialization: no mmap or lazy NPZ access inside core timing.
    with np.load(path, allow_pickle=False) as archive:
        return {name: archive[name] for name in archive.files}


def write_json(path, value):
    Path(path).write_text(json.dumps(value, allow_nan=False), encoding="utf-8")


def window_features(values, rate):
    if values.dtype != np.float32 or values.ndim != 2 or values.shape[1] != 60 * rate:
        raise ValueError("expected float32 native-rate 60-second cycles")
    return native_statistics(values, rate)


def edge(data, group):
    if set(data) != {"cycle_ids", *GROUPS[group]}:
        raise ValueError("data channels must exactly match this edge group")
    ids = data["cycle_ids"]
    if ids.ndim != 1 or len(ids) == 0 or len(np.unique(ids)) != len(ids):
        raise ValueError("expected distinct cycle ids")
    result = {"cycle_ids": ids}
    for name in GROUPS[group]:
        if len(data[name]) != len(ids):
            raise ValueError("cycle count differs between channels")
        result[name] = window_features(data[name], RATES[name])
    return result


def fuse(parts, reference, threshold):
    if not np.isfinite(threshold) or threshold <= 0:
        raise ValueError("Z_THRESHOLD must be positive")
    ids = parts[0]["cycle_ids"]
    features = []
    for group, part in zip(GROUPS, parts):
        if set(part) != {"cycle_ids", *GROUPS[group]} or not np.array_equal(part["cycle_ids"], ids):
            raise ValueError("edge channels or cycle alignment differ")
        features.extend(part[name] for name in GROUPS[group])
    combined = np.stack(features, axis=2)  # cycle, window, sensor, feature
    if combined.shape != (len(ids), 6, len(CHANNELS), len(FEATURES)) or not np.isfinite(combined).all():
        raise ValueError("invalid edge features")
    if (not np.array_equal(reference["cycle_ids"], ids)
            or reference["center"].shape != combined.shape[1:]
            or reference["scale"].shape != combined.shape[1:]
            or np.any(reference["scale"] <= 0)):
        raise ValueError("reference does not match this dataset")
    scores = np.abs((combined - reference["center"]) / reference["scale"]).max(axis=3).astype(np.float32)
    window_scores = scores.max(axis=2)
    flags = window_scores > threshold
    cycle_flags = flags.any(axis=1)
    evaluation = reference["stable"].astype(bool) & ~np.isin(ids, reference["calibration_ids"])
    truth = ~reference["healthy"].astype(bool)
    metrics = {"cycleCount": int(len(ids)), "uniqueCycles": int(reference["unique_cycles"]),
               "calibrationCycles": int(len(reference["calibration_ids"])),
               "heldoutHealthyCycles": int((evaluation & ~truth).sum()),
               "evaluatedStableCycles": int(evaluation.sum()), "anomalyCycles": int(cycle_flags.sum()),
               "truePositives": int((evaluation & truth & cycle_flags).sum()),
               "falsePositives": int((evaluation & ~truth & cycle_flags).sum()),
               "falseNegatives": int((evaluation & truth & ~cycle_flags).sum()),
               "channels": len(CHANNELS), "windowsPerCycle": 6, "zThreshold": threshold}
    result = {"cycle_ids": ids, "sensor_scores": scores, "window_scores": window_scores,
              "window_flags": flags, "evaluation_mask": evaluation}
    return result, metrics


def bytes_of(data):
    return sum(value.nbytes for value in data.values())


def interval_union(profiles):
    spans = sorted((p["startedNs"], p["endedNs"]) for p in profiles)
    total, start, end = 0, None, None
    for left, right in spans:
        if right <= left:
            raise ValueError("invalid compute interval")
        if start is None:
            start, end = left, right
        elif left > end:
            total += end - start
            start, end = left, right
        else:
            end = max(end, right)
    return (total + end - start) / 1e9


def timed(function, input_bytes):
    started = time.time_ns()
    monotonic = time.perf_counter_ns()
    result = function()
    elapsed = time.perf_counter_ns() - monotonic
    ended = time.time_ns()
    if elapsed <= 0 or abs(ended - started - elapsed) > max(1_000_000, elapsed // 1000):
        raise ValueError("compute clock changed")
    return result, {"startedNs": started, "endedNs": ended, "durationNs": elapsed,
                    "inputBytes": input_bytes}


def run(args):
    from cea_measurement import Measurement
    output = args.output
    output.mkdir(parents=True, exist_ok=True)
    with Measurement(output / "cea-measurement.json") as measurement:
        if args.operation == "edge":
            source = Path(os.environ["DATASET_PATH"])
            with measurement.input(source):
                data = load(source)
            result, profile = timed(lambda: edge(data, os.environ["EDGE_GROUP"]), bytes_of(data))
            profile["outputBytes"] = bytes_of(result)
            np.savez(output / "features.npz", **result)
            measurement.output(output / "features.npz")
            metrics = {"cycleCount": len(result["cycle_ids"]), "channels": len(result) - 1,
                       "computeSeconds": profile["durationNs"] / 1e9,
                       "computeGBps": (profile["inputBytes"] + profile["outputBytes"]) / profile["durationNs"]}
        else:
            parts, profiles = [], []
            for group in GROUPS:
                with measurement.input(args.input / f"{group}.npz"):
                    parts.append(load(args.input / f"{group}.npz"))
                profiles.append(json.loads((args.input / f"{group}-profile.json").read_text()))
            with measurement.input(Path(os.environ["REFERENCE_PATH"])):
                reference = load(os.environ["REFERENCE_PATH"])
            (result, metrics), profile = timed(
                lambda: fuse(parts, reference, float(os.environ["Z_THRESHOLD"])),
                sum(bytes_of(part) for part in parts) + bytes_of(reference))
            profile["outputBytes"] = bytes_of(result)
            all_profiles = profiles + [profile]
            seconds = interval_union(all_profiles)
            size = sum(p["inputBytes"] + p["outputBytes"] for p in all_profiles)
            metrics.update(computeGBps=size / seconds / 1e9, computeSeconds=seconds, effectiveBytes=size,
                           computeSpanSeconds=(max(p["endedNs"] for p in all_profiles)
                                               - min(p["startedNs"] for p in all_profiles)) / 1e9)
            report = {"dataset": "UCI 447", "algorithm": "window features + reference Z-score fusion",
                      "featureNames": FEATURES, "sensorNames": CHANNELS, "edgeGroups": GROUPS,
                      "metrics": metrics, "computeProfiles": all_profiles,
                      "throughputScope": "resident-array inputs+outputs / all compute interval union",
                      "referenceNote": "5 unique stable healthy calibration cycles; no component classifier"}
            np.savez(output / "anomalies.npz", **result)
            write_json(output / "report.json", report)
            measurement.output(output / "anomalies.npz")
            measurement.output(output / "report.json")
        write_json(output / "metrics.json", metrics)
        measurement.output(output / "metrics.json")
        write_json(output / "compute-profile.json", profile)
    print(json.dumps(metrics, allow_nan=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=("edge", "fuse"))
    parser.add_argument("--input", type=Path, default=Path("/cea-work/in"))
    parser.add_argument("--output", type=Path, default=Path("/cea-work/out"))
    run(parser.parse_args())
