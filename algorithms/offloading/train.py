"""Double DQN from measured continuous-stream batches. Never invent next states."""
import argparse
import copy
import json
import math
from pathlib import Path
import torch

SCHEMA = "measured-offload-log1p-v1"


def network(seed=17):
    torch.manual_seed(seed)
    torch.set_num_threads(1)
    return torch.nn.Sequential(torch.nn.Linear(6, 32), torch.nn.ReLU(), torch.nn.Linear(32, 3)).double()


def export(model):
    return {"stateSchema": SCHEMA, "weights1": model[0].weight.detach().tolist(),
            "bias1": model[0].bias.detach().tolist(), "weights2": model[2].weight.detach().tolist(),
            "bias2": model[2].bias.detach().tolist()}


def dataset(samples):
    if not isinstance(samples, list) or not samples or len(samples) > 10000:
        raise ValueError("a bounded batch of 1..10000 actual samples required")
    indexed = {s["key"]: s for s in samples}
    if len(indexed) != len(samples):
        raise ValueError("duplicate Attempt observations")
    rows = []
    for sample in samples:
        measurement = sample.get("measurement") or {}
        if not measurement.get("trainable") or measurement.get("nextKey") not in indexed:
            continue  # Batch tails are truncations, not absorbing terminal states.
        next_sample = indexed[measurement["nextKey"]]
        next_measurement = next_sample.get("measurement") or {}
        if any(sample.get(k) != next_sample.get(k) for k in ("applicationId", "applicationVersion", "workload")) or any(
            measurement.get(k) != next_measurement.get(k) for k in ("edge", "flowId")
        ):
            raise ValueError("next decision belongs to a different workload stream")
        if measurement.get("nextState") != next_sample.get("state") or measurement.get("nextLegalActions") != next_measurement.get("legalActions"):
            raise ValueError("next state is not the immutable referenced decision")
        for record in (sample, next_sample):
            m = record.get("measurement") or {}
            values, state, legal = m.get("inputs"), record.get("state"), m.get("legalActions")
            if m.get("unavailable") or not isinstance(values, list) or len(values) != 6 or not isinstance(state, list) or len(state) != 6:
                raise ValueError("complete six-state measurement required")
            if any(type(v) not in (int, float) or not math.isfinite(v) or v < 0 for v in values + state):
                raise ValueError("invalid finite nonnegative state")
            if any(not math.isclose(s, math.log1p(v), rel_tol=1e-10, abs_tol=1e-10) for s, v in zip(state, values)):
                raise ValueError("state normalization differs from measured log1p")
            if not isinstance(legal, list) or not legal or len(set(legal)) != len(legal) or any(type(a) is not int or a not in (0, 1, 2) for a in legal):
                raise ValueError("invalid legal layer mask")
        action = sample.get("action")
        reward, elapsed = sample.get("reward"), measurement.get("elapsedSeconds")
        if type(action) is not int or action not in measurement["legalActions"] or not sample.get("finishedAt") or sample.get("outcome") not in ("SUCCESS", "FAILED"):
            raise ValueError("completed actual legal action required")
        if measurement.get("limitSeconds") != 120 or type(elapsed) not in (int, float) or not math.isfinite(elapsed) or elapsed <= 0:
            raise ValueError("measured terminal feedback required")
        outcome = measurement.get("feedbackOutcome")
        expected = -elapsed / 120 if outcome == "SUCCESS" and elapsed <= 120 else -2 if outcome in ("FAILED", "TIMEOUT") else None
        if expected is None or type(reward) not in (int, float) or not math.isfinite(reward) or not math.isclose(reward, expected, rel_tol=1e-10, abs_tol=1e-10):
            raise ValueError("reward differs from actual terminal feedback")
        rows.append(sample)
    if {s["action"] for s in rows} != {0, 1, 2}:
        raise ValueError("actual complete transitions for all three layers required")
    states = torch.tensor([s["state"] for s in rows], dtype=torch.float64)
    actions = torch.tensor([s["action"] for s in rows], dtype=torch.long)
    rewards = torch.tensor([s["reward"] for s in rows], dtype=torch.float64)
    next_states = torch.tensor([s["measurement"]["nextState"] for s in rows], dtype=torch.float64)
    masks = torch.tensor([[a in s["measurement"]["nextLegalActions"] for a in range(3)] for s in rows], dtype=torch.bool)
    return states, actions, rewards, next_states, masks


@torch.no_grad()
def double_target(online, target, next_states, rewards, masks, gamma):
    selected = online(next_states).masked_fill(~masks, -torch.inf).argmax(1)
    evaluated = target(next_states).gather(1, selected[:, None]).squeeze(1)
    return rewards + gamma * evaluated


def fit(samples, updates=1000, seed=17):
    if not 1 <= updates <= 100000:
        raise ValueError("updates must be 1..100000")
    replay = dataset(samples)
    online = network(seed)
    target = copy.deepcopy(online).eval()
    optimizer = torch.optim.Adam(online.parameters(), lr=0.001)
    losses, syncs = [], 0
    for step in range(updates):
        index = torch.randint(len(replay[0]), (min(32, len(replay[0])),))
        states, actions, rewards, next_states, masks = [value[index] for value in replay]
        expected = double_target(online, target, next_states, rewards, masks, 0.95)
        actual = online(states).gather(1, actions[:, None]).squeeze(1)
        loss = torch.nn.functional.smooth_l1_loss(actual, expected)
        optimizer.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(online.parameters(), 10)
        optimizer.step()
        if not torch.isfinite(loss):
            raise ValueError("nonfinite training loss")
        if (step + 1) % 50 == 0:
            target.load_state_dict(online.state_dict())
            syncs += 1
        losses.append(loss.item())
    return export(online), {"algorithm": "Double DQN", "transitions": len(replay[0]), "batchSamples": len(samples),
        "excludedIncompleteOrBoundary": len(samples) - len(replay[0]), "updates": updates, "seed": seed,
        "gamma": 0.95, "targetSyncs": syncs, "replayCapacity": 10000, "batchSize": min(32, len(replay[0])),
        "actionCounts": {str(a): int((replay[1] == a).sum()) for a in range(3)},
        "firstLoss": losses[0], "lastLoss": losses[-1], "scope": "measured offline replay; batch tail truncated; no performance claim"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    initial = commands.add_parser("init", help="untrained exploration-only initial model")
    initial.add_argument("output", type=Path)
    training = commands.add_parser("fit")
    training.add_argument("samples", type=Path)
    training.add_argument("output", type=Path)
    training.add_argument("--updates", type=int, default=1000)
    training.add_argument("--seed", type=int, default=17)
    args = parser.parse_args()
    if args.command == "init":
        model, report = export(network()), {"trained": False, "use": "explicit exploration collection only"}
    else:
        model, report = fit(json.loads(args.samples.read_text(encoding="utf8")), args.updates, args.seed)
    args.output.write_text(json.dumps(model, allow_nan=False), encoding="utf8")
    args.output.with_suffix(".report.json").write_text(json.dumps(report, indent=2), encoding="utf8")
    print(json.dumps(report))
