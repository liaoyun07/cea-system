"""Train five-state Double DQN in simulation, never submit real tasks."""
import argparse
import copy
import json
import random
import statistics
import time
from collections import deque
from pathlib import Path

import numpy as np
import torch
from environment import (SCHEMA, POSITIONS, ROOT, arrivals, calibrate, choose, evaluate,
                         rollout, rule, state_vector, summary)


def export(net):
    return {"stateSchema": SCHEMA, "weights1": net[0].weight.detach().tolist(),
            "bias1": net[0].bias.detach().tolist(), "weights2": net[2].weight.detach().tolist(),
            "bias2": net[2].bias.detach().tolist()}


def inference(model):
    w1, b1, w2, b2 = [np.asarray(model[k], dtype=np.float64) for k in ("weights1", "bias1", "weights2", "bias2")]
    def policy(raw, task):
        h = np.maximum(0, w1 @ state_vector(*raw) + b1)
        return int(np.argmax(w2 @ h + b2))
    return policy


def targets(online, target, next_states, rewards, done, gamma=.95):
    with torch.no_grad():
        actions = online(next_states).argmax(1)
        return rewards + gamma * (1 - done) * target(next_states).gather(1, actions[:, None]).squeeze(1)


def balanced_batch(buckets, rng, count):
    keys = [key for key, rows in buckets.items() if rows]
    return [rng.choice(buckets[rng.choice(keys)]) for _ in range(count)]


def fit(calibration, seed, episodes, output, *, trace_start=1000, validation_start=20000,
        width=64, balanced=False, learning_rate=.001):
    torch.manual_seed(seed)
    rng = random.Random(seed)
    net = torch.nn.Sequential(torch.nn.Linear(5, width), torch.nn.ReLU(), torch.nn.Linear(width, 3))
    target = copy.deepcopy(net).eval()
    optimizer = torch.optim.Adam(net.parameters(), lr=learning_rate)
    replay = deque(maxlen=50_000)
    buckets = {(size, action): deque(maxlen=5500) for size in ("small", "medium", "large") for action in range(3)}
    best, best_score, history, updates, transitions = None, float("inf"), [], 0, 0
    for episode in range(episodes):
        greedy = inference(export(net))
        epsilon = max(.05, 1 - episode / (episodes * .8))
        policy = lambda raw, task: rng.randrange(3) if rng.random() < epsilon else greedy(raw, task)
        interval = rng.choice([6, 8, 10, 12, 15])
        # Disjoint from validation 20000+ and test 30000+.
        trace_seed = trace_start + episode
        states, actions, records = rollout(calibration, arrivals(trace_seed, interval), policy,
                                          scenario=seed * 100000 + episode, randomized=True)
        for i, task in enumerate(records):
            done = i == len(records) - 1
            transition = (states[i], actions[i], -(task["finishedAt"] - task["at"]) / 120,
                          [0.] * 5 if done else states[i + 1], float(done))
            replay.append(transition)
            if balanced:
                buckets[(task["size"], actions[i])].append(transition)
        transitions += len(records)
        # All rewards resolve after drain; s' is the next decision, NOT completion
        # state or an independently fabricated random vector.
        data = list(replay)
        for _ in range(max(1, len(records) // 8)):
            batch = balanced_batch(buckets, rng, 128) if balanced else rng.sample(data, min(128, len(data)))
            s, a, r, ns, done = zip(*batch)
            s, ns = torch.tensor(s), torch.tensor(ns)
            expected = targets(net, target, ns, torch.tensor(r), torch.tensor(done))
            predicted = net(s).gather(1, torch.tensor(a)[:, None]).squeeze(1)
            loss = torch.nn.functional.smooth_l1_loss(predicted, expected)
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), 10)
            optimizer.step()
            updates += 1
            if updates % 200 == 0:
                target.load_state_dict(net.state_dict())
        if (episode + 1) % 50 == 0 or episode + 1 == episodes:
            model = export(net)
            validation = evaluate(calibration, inference(model), range(validation_start, validation_start + 6), (6, 10, 15), True)
            score = statistics.mean(row["meanSeconds"] for row in validation)
            history.append({"episode": episode + 1, "validationMeanSeconds": score, "loss": loss.item(), "epsilon": epsilon})
            if score < best_score:
                best_score, best = score, model
                write(output / f"model-seed-{seed}.json", best)
            print(json.dumps({"trainingSeed": seed, **history[-1], "best": best_score}), flush=True)
    return best, {"seed": seed, "episodes": episodes, "transitions": transitions, "updates": updates,
                  "width": width, "learningRate": learning_rate, "balancedReplay": balanced,
                  "traceStart": trace_start, "validationStart": validation_start,
                  "validationScore": best_score, "history": history}


def write(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False), encoding="utf8")


def replay_check(calibration, folder):
    rows = []
    for name in ("LOCAL", "TERMINAL_30", "TERMINAL_30_RANDOM10"):
        view = json.loads((folder / f"jitter-{name}-result.json").read_text(encoding="utf8"))
        # Same planned trace, not actual request timestamps: exposes missing
        # producer/HTTP/host contention rather than hiding it in replay.
        _, _, records = rollout(calibration, arrivals(31), rule(name))
        predicted = summary(records)
        actual_mean = statistics.mean(t["finishedAt"] - t["requestedAt"] for t in view["tasks"])
        actual_span = max(t["finishedAt"] for t in view["tasks"]) - min(t["requestedAt"] for t in view["tasks"])
        rows.append({"policy": name, "heldOutRealRun": name == "TERMINAL_30_RANDOM10",
                     "simMeanSeconds": predicted["meanSeconds"], "realMeanSeconds": actual_mean,
                     "simMakespanSeconds": predicted["makespanSeconds"], "realMakespanSeconds": actual_span,
                     "meanRelativeError": predicted["meanSeconds"] / actual_mean - 1,
                     "spanRelativeError": predicted["makespanSeconds"] / actual_span - 1})
    return rows


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--records", type=Path, default=ROOT / ".local/cea/terminal-load/offload-lab")
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--episodes", type=int, default=500)
    args = p.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(1)
    started = time.monotonic()
    calibration = calibrate(args.records)
    write(args.output / "calibration.json", calibration)
    check = replay_check(calibration, args.records)
    write(args.output / "calibration-check.json", check)
    print(json.dumps({"calibrationCheck": check}), flush=True)
    trials = []
    for seed in (17, 29, 43):
        model, report = fit(calibration, seed, args.episodes, args.output)
        trials.append((model, report))
        write(args.output / f"training-seed-{seed}.json", report)
    model, selected = min(trials, key=lambda t: t[1]["validationScore"])
    model["training"] = {"source": "simulated", "algorithm": "Double DQN", "seed": selected["seed"],
                         "reward": "-endToEndSeconds/120", "gamma": .95,
                         "selectedBy": "mean delay on validation seeds 20000..20005; never test scores"}
    write(args.output / "model.json", model)
    # Check exact exported production inference, not just PyTorch training output.
    policy = inference(model)
    probes = [[size, local, upload, edge, cloud] for size in (5e6, 50e6, 500e6)
              for local in (0, 50e6, 500e6) for upload in (0, 10, 60)
              for edge in (0, 500e6, 2e9) for cloud in (0, 1e9, 4e9)]
    for raw in probes:
        assert POSITIONS[policy(raw, {})] == choose("DQN", {}, raw, model)
    write(args.output / "behavior.json", [{"rawState": raw, "action": POSITIONS[policy(raw, {})]} for raw in probes])
    tests = {}
    for randomize in (False, True):
        key = "nominal" if not randomize else "parameter-uncertainty"
        tests[key] = {}
        for name in ("LOCAL", "RANDOM", "TERMINAL_30", "TERMINAL_30_RANDOM10", "DQN"):
            tests[key][name] = evaluate(calibration, policy if name == "DQN" else rule(name),
                                       range(30000, 30020), (6, 10, 15), randomize)
    write(args.output / "test-runs.json", tests)
    aggregate = {case: {name: {k: statistics.mean(r[k] for r in rows)
                              for k in ("meanSeconds", "p95Seconds", "makespanSeconds")}
                       for name, rows in policies.items()} for case, policies in tests.items()}
    report = {"source": "SIMULATION_ONLY", "selectedTrainingSeed": selected["seed"], "training": [r for _, r in trials],
              "architecture": [5, 64, 3], "reward": "-task end-to-end seconds/120", "gamma": .95,
              "trainingTraceSeeds": [1000, 1000 + args.episodes - 1], "validationSeeds": [20000, 20005],
              "testSeeds": [30000, 30019], "testIntervalsSeconds": [6, 10, 15],
              "calibrationCheck": check, "testSummary": aggregate, "inferenceParityCases": len(probes),
              "wallSeconds": time.monotonic() - started, "deployed": False}
    write(args.output / "report.json", report)
    print(json.dumps({"final": aggregate, "wallSeconds": report["wallSeconds"]}), flush=True)


if __name__ == "__main__":
    main()
