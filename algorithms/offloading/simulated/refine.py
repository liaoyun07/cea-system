"""Second calibration/training iteration. Preserve v1 and use fresh holdout seeds."""
import argparse
import json
import statistics
import time
from pathlib import Path
import torch
from environment import ROOT, calibrate, evaluate, choose, POSITIONS, arrivals, rollout, summary
from train_sim import fit, inference, write
from environment import rule


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(1)
    started = time.monotonic()
    folder = ROOT / ".local/cea/terminal-load/offload-lab"
    # Mixed-load timings match deployment; local-only large is the sole missing
    # cell. Do not pool fast LOCAL small/medium timings into mixed-load service.
    calibration = calibrate(folder, ["jitter-TERMINAL_30-result.json", "jitter-TERMINAL_30_RANDOM10-result.json",
                                     "dqn-live-result.json"], "jitter-LOCAL-result.json")
    calibration["scope"] = "Current 64MiB/four-slot mixed-load service calibration; local large fallback from current LOCAL."
    calibration["limitations"].append("LOCAL baseline service differs under no-upload contention; mixed-load simulation is not a faithful LOCAL resource model")
    write(args.output / "calibration.json", calibration)
    old = json.loads((ROOT / ".local/cea/offload-sim-dqn/model.json").read_text())
    check = []
    for name, file in [("TERMINAL_30", "jitter-TERMINAL_30-result.json"), ("OLD_DQN", "dqn-live-result.json")]:
        policy = inference(old) if name == "OLD_DQN" else rule(name)
        _, _, rows = rollout(calibration, arrivals(31), policy)
        v = json.loads((folder / file).read_text())
        check.append({"policy": name, "simulated": summary(rows), "real": v["summary"], "inSampleCalibration": True})
    write(args.output / "calibration-check.json", check)
    trials = []
    for seed in (17, 29, 43):
        model, report = fit(calibration, seed, 800, args.output, trace_start=5000, validation_start=40000,
                            width=128, balanced=True, learning_rate=.0005)
        trials.append((model, report))
        write(args.output / f"training-seed-{seed}.json", report)
    model, selected = min(trials, key=lambda t: t[1]["validationScore"])
    model["training"] = {"source": "simulated-calibrated-with-first-live-DQN", "algorithm": "Double DQN",
                         "seed": selected["seed"], "reward": "-endToEndSeconds/120", "gamma": .95,
                         "selectedBy": "validation seeds 40000..40005 mean task delay", "balancedReplay": "size x action"}
    write(args.output / "model.json", model)
    validation = {}
    policies = {name: rule(name) for name in ("LOCAL", "RANDOM", "TERMINAL_30", "TERMINAL_30_RANDOM10")}
    policies.update(OLD_DQN=inference(old), DQN=inference(model))
    for name, policy in policies.items():
        validation[name] = evaluate(calibration, policy, range(40000, 40006), (6, 10, 15), True)
    # Fresh test seed family, frozen selection. No test-driven checkpoint choice.
    tests = {name: evaluate(calibration, policy, range(50000, 50020), (6, 10, 15), True)
             for name, policy in policies.items()}
    write(args.output / "test-runs.json", tests)
    probes = [[size, local, upload, edge, cloud] for size in (5e6, 50e6, 500e6)
              for local in (0, 50e6, 500e6) for upload in (0, 10, 60)
              for edge in (0, 500e6, 2e9) for cloud in (0, 1e9, 4e9)]
    for raw in probes:
        assert POSITIONS[policies["DQN"](raw, {})] == choose("DQN", {}, raw, model)
    write(args.output / "behavior.json", [{"rawState": raw, "action": POSITIONS[policies["DQN"](raw, {})]} for raw in probes])
    average = lambda rows: {k: statistics.mean(r[k] for r in rows) for k in ("meanSeconds", "makespanSeconds", "p95Seconds")}
    report = {"source": "SIMULATION_ONLY", "selectedTrainingSeed": selected["seed"], "training": [r for _, r in trials],
              "trainingSeeds": [5000,5799], "validationSeeds": [40000,40005], "testSeeds": [50000,50019],
              "validation": {k: average(v) for k,v in validation.items()}, "testSummary": {k: average(v) for k,v in tests.items()},
              "inferenceParityCases": len(probes), "wallSeconds": time.monotonic()-started, "deployed": False}
    write(args.output / "report.json", report)
    print(json.dumps(report["testSummary"]), flush=True)


if __name__ == "__main__":
    main()
