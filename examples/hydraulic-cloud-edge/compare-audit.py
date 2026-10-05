"""Independent readback, measurement and preservation checks; outside timed trials."""
import argparse
import json
from pathlib import Path

import numpy as np

from app import GROUPS, RATES, load


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def audit(raw_dir, batch):
    reference = load(raw_dir / "reference.npz")
    expected = {}
    raw_size = 0
    for group, names in GROUPS.items():
        path = raw_dir / f"{group}.npz"
        raw_size += path.stat().st_size
        raw = load(path)
        expected[group] = {"cycle_ids": raw["cycle_ids"]}
        for name in names:
            windows = raw[name].astype(np.float64).reshape(-1, 6, 10 * RATES[name])
            expected[group][name] = np.stack((windows.mean(axis=2), windows.std(axis=2),
                windows.min(axis=2), windows.max(axis=2), np.sqrt((windows ** 2).mean(axis=2))), axis=2)
    environment = read_json(batch / "environment.json")
    assert len(environment["containers"]) == 20
    assert environment["capacity"]["cpuCores"] == 16
    assert environment["containers"] == read_json(batch / "after-containers.json")
    summary = read_json(batch / "summary.json")
    assert summary["beforeFlows"] == summary["afterFlows"]
    prior = read_json(batch.parent / "before.json")["flows"]
    from datetime import datetime
    for old in prior:
        current = next(f for f in summary["afterFlows"] if f["flowId"] == old["flowId"])
        for key, value in old.items():
            if key.endswith("At") and value is not None:
                # PowerShell trims insignificant trailing fractional zeros.
                assert datetime.fromisoformat(value.replace("Z", "+00:00")) == datetime.fromisoformat(current[key].replace("Z", "+00:00"))
            else:
                assert value == current[key]
    assert len(summary["afterFlows"]) == len(prior) + 2
    jobs = [job for cluster in ("cloud", "edge-a", "edge-b", "edge-c")
            for job in read_json(batch / f"jobs-{cluster}.json")]
    assert len(jobs) == 30 and all(job["succeeded"] == 1 for job in jobs)
    digests = {container["image"].split("@", 1)[1] for job in jobs
               for container in job["containers"] if container["name"] == "task"}
    assert len(digests) == 1
    assert all(container["resources"] == {} for job in jobs for container in job["containers"])
    expected_names = {c["name"].removeprefix("/") for c in environment["containers"]} | {
        "pods:cea-cloud", "pods:cea-edge-a", "pods:cea-edge-b", "pods:cea-edge-c"}
    rows = []
    for pair in range(6):
        central = load(batch / f"arrays-pair-{pair}-central" / "anomalies.npz")
        distributed = load(batch / f"arrays-pair-{pair}-distributed" / "anomalies.npz")
        assert set(central) == set(distributed)
        for name in central:
            np.testing.assert_array_equal(central[name], distributed[name])
        parts = []
        features_size = 0
        for group, names in GROUPS.items():
            path = batch / f"arrays-pair-{pair}-distributed" / f"{group}.npz"
            part = load(path)
            features_size += path.stat().st_size
            np.testing.assert_array_equal(part["cycle_ids"], reference["cycle_ids"])
            for name in names:
                np.testing.assert_allclose(part[name], expected[group][name], rtol=1e-5, atol=1e-9)
            parts.extend(part[name] for name in names)
        features = np.stack(parts, axis=2)
        scores = np.abs((features-reference["center"])/reference["scale"]).max(axis=3).astype(np.float32)
        np.testing.assert_array_equal(distributed["sensor_scores"], scores)
        np.testing.assert_array_equal(distributed["window_scores"], scores.max(axis=2))
        np.testing.assert_array_equal(distributed["window_flags"], scores.max(axis=2)>3)
        np.testing.assert_array_equal(distributed["evaluation_mask"],
            reference["stable"] & ~np.isin(reference["cycle_ids"],reference["calibration_ids"]))
        reports=[]
        for mode, size in [("central",raw_size),("distributed",features_size)]:
            trial = read_json(batch / f"pair-{pair}-{mode}.json")
            assert trial["execution"]["state"] == "SUCCESS"
            assert trial["upstreamBytes"] == size
            assert len(trial["reports"]) == (1 if mode == "central" else 4)
            reports.append(trial["report"]["metrics"])
            samples = trial["samples"]
            for sample in samples:
                assert {c["name"] for c in sample["components"]} == expected_names
                assert sample["memoryBytes"] == sum(c["memoryBytes"] for c in sample["components"])
                assert sample["cpuNs"] == sum(c["cpuNs"] for c in sample["components"])
                assert all(c["memoryBytes"]>=0 for c in sample["components"])
            cpu = sum(samples[-1]["components"][i]["cpuNs"]-samples[0]["components"][i]["cpuNs"]
                      for i in range(len(expected_names)))/1e9
            memory = sum((b["atMs"]-a["atMs"])/1000*(a["memoryBytes"]+b["memoryBytes"])/2
                         for a,b in zip(samples,samples[1:]))/2**30
            np.testing.assert_allclose(cpu,trial["resources"]["cpuCoreSeconds"],rtol=1e-10)
            np.testing.assert_allclose(memory,trial["resources"]["memoryGiBSeconds"],rtol=1e-10)
            rows.append({"pair":pair,"mode":mode,"executionId":trial["execution"]["id"],
                         "resources":trial["resources"],"upstreamBytes":size})
        assert reports[0] == reports[1]
    (batch / "audit.json").write_text(json.dumps({"numerical":True,"resourceRecalculation":True,
        "preservedContainersAndFlows":True,"rows":rows},indent=2))
    print("PASS: 12 complete outputs, 18 edge features, 30 same-digest Jobs; independent numerical/bytes/resource recalculation; 20 services and 52 existing flows preserved")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw",type=Path,required=True)
    parser.add_argument("--batch",type=Path,required=True)
    args=parser.parse_args()
    audit(args.raw,args.batch)
