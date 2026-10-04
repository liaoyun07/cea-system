"""Independent numerical and interval audit, outside benchmark timing."""
import argparse
from datetime import datetime
import json
from pathlib import Path
import time

import numpy as np

from app import GROUPS, RATES, CHANNELS, edge, load


def arrays_bytes(data):
    return sum(a.size * a.dtype.itemsize for a in data.values())


def union(profiles):
    # Independent event sweep, not the production interval merge.
    events = sorted([(p["startedNs"], 1) for p in profiles] + [(p["endedNs"], -1) for p in profiles])
    active, total, previous = 0, 0, events[0][0]
    for timestamp, change in events:
        if active:
            total += timestamp - previous
        active += change
        previous = timestamp
    assert active == 0
    return total / 1e9


def main(root, batch):
    raw = {g: load(root / "full" / f"{g}.npz") for g in GROUPS}
    reference = load(root / "full" / "reference.npz")
    expected = {}
    local_seconds = {}
    for group, data in raw.items():
        started = time.perf_counter()
        actual = edge(data, group)
        local_seconds[group] = time.perf_counter() - started
        expected[group] = {"cycle_ids": data["cycle_ids"]}
        for name in GROUPS[group]:
            windows = data[name].astype(np.float64).reshape(-1, 6, 10 * RATES[name])
            independent = np.stack((np.average(windows, axis=2), np.std(windows, axis=2),
                                    np.minimum.reduce(windows, axis=2), np.maximum.reduce(windows, axis=2),
                                    np.sqrt(np.average(np.square(windows), axis=2))), axis=2)
            np.testing.assert_allclose(actual[name], independent, rtol=1e-5, atol=1e-9)
            expected[group][name] = independent
    cal = reference["calibration_ids"]
    assert cal.tolist() == [1787, 1788, 1789, 1790, 1791]
    independent_features = np.stack([expected[g][n] for g in GROUPS for n in GROUPS[g]], axis=2)
    np.testing.assert_allclose(reference["center"], independent_features[cal].mean(axis=0), rtol=1e-10, atol=1e-9)
    np.testing.assert_allclose(reference["scale"], np.maximum(independent_features[cal].std(axis=0), 1e-6), rtol=1e-5, atol=1e-9)
    print("PASS: all 17 channels, 2205 cycles, 6 windows, 5 statistics; calibration split; local seconds", local_seconds)
    if batch is None:
        return
    rows = []
    for trial in range(4):
        evidence = json.loads((batch / f"trial-{trial}.json").read_text(encoding="utf-8-sig"))
        assert evidence["execution"]["state"] == "SUCCESS"
        folder = batch / f"arrays-{trial}"
        parts = {g: load(folder / f"{g}.npz") for g in GROUPS}
        for group in GROUPS:
            np.testing.assert_array_equal(parts[group]["cycle_ids"], raw[group]["cycle_ids"])
            for name in GROUPS[group]:
                np.testing.assert_allclose(parts[group][name], expected[group][name], rtol=1e-5, atol=1e-9)
        features = np.stack([parts[g][n] for g in GROUPS for n in GROUPS[g]], axis=2)
        independent_scores = np.maximum.reduce(np.abs((features - reference["center"]) / reference["scale"]), axis=3).astype(np.float32)
        anomaly = load(folder / "anomalies.npz")
        np.testing.assert_array_equal(anomaly["cycle_ids"], reference["cycle_ids"])
        np.testing.assert_array_equal(anomaly["sensor_scores"], independent_scores)
        np.testing.assert_array_equal(anomaly["window_scores"], independent_scores.max(axis=2))
        np.testing.assert_array_equal(anomaly["window_flags"], independent_scores.max(axis=2) > 3)
        evaluation = reference["stable"] & ~np.isin(reference["cycle_ids"], cal)
        np.testing.assert_array_equal(anomaly["evaluation_mask"], evaluation)
        profiles = evidence["profiles"]
        assert len(profiles) == 4
        expected_inputs = [arrays_bytes(raw[g]) for g in GROUPS] + [sum(arrays_bytes(p) for p in parts.values()) + arrays_bytes(reference)]
        expected_outputs = [arrays_bytes(parts[g]) for g in GROUPS] + [arrays_bytes(anomaly)]
        assert [p["inputBytes"] for p in profiles] == expected_inputs
        assert [p["outputBytes"] for p in profiles] == expected_outputs
        size = sum(expected_inputs + expected_outputs)
        seconds = union(profiles)
        metrics = evidence["report"]["metrics"]
        cycle_flags = anomaly["window_flags"].any(axis=1)
        truth = ~reference["healthy"]
        assert metrics["truePositives"] == int((evaluation & truth & cycle_flags).sum())
        assert metrics["falsePositives"] == int((evaluation & ~truth & cycle_flags).sum())
        assert metrics["falseNegatives"] == int((evaluation & truth & ~cycle_flags).sum())
        assert metrics["heldoutHealthyCycles"] == int((evaluation & ~truth).sum())
        assert size == metrics["effectiveBytes"]
        assert abs(seconds - metrics["computeSeconds"]) < 1e-9
        assert abs(size / seconds / 1e9 - metrics["computeGBps"]) < 1e-12
        for profile, report in zip(profiles, evidence["sdkReports"]):
            assert not any(f["path"].endswith("compute-profile.json") for f in report["inputs"] + report["outputs"])
            def ns(text):
                seconds, fraction = text.removesuffix("Z").split(".")
                return int(datetime.fromisoformat(seconds + "+00:00").timestamp()) * 10**9 + int(fraction.ljust(9, "0"))
            assert ns(report["startedAt"]) <= profile["startedNs"] < profile["endedNs"] <= ns(report["endedAt"])
        e = evidence["execution"]
        elapsed = (datetime.fromisoformat(e["endedAt"].replace("Z", "+00:00")) - datetime.fromisoformat(e["createdAt"].replace("Z", "+00:00"))).total_seconds()
        rows.append({"trial": trial, "executionId": e["id"], "coreGBps": metrics["computeGBps"],
                     "coreUnionSeconds": seconds, "coreSpanSeconds": metrics["computeSpanSeconds"],
                     "wholeSDKGBps": evidence["measurement"]["bytesPerSecond"] / 1e9, "endToEndSeconds": elapsed,
                     "edgeSeconds": [p["durationNs"] / 1e9 for p in profiles[:3]]})
    (batch / "audit.json").write_text(json.dumps({"allNumericalChecks": True, "trials": rows}, indent=2))
    print(json.dumps(rows, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--batch", type=Path)
    args = parser.parse_args()
    main(args.root, args.batch)
