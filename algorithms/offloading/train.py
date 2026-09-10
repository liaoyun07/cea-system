"""Offline Q-network fitting for single-placement episodes, not long-horizon congestion control."""
import argparse
import json
from pathlib import Path

import torch

SCHEMA = "terminal-slot-cost-v1"


def dataset(samples):
    rows = [s for s in samples if s.get("strategy") in ("RULE", "DQN")
            and s.get("startedAt") and s.get("finishedAt")
            and s.get("outcome") in ("SUCCESS", "FAILED") and s.get("reward") is not None]
    if not rows:
        raise ValueError("No completed placement observations; cancelled/unstarted tasks are not training samples")
    if len({s["key"] for s in rows}) != len(rows):
        raise ValueError("Duplicate Attempt observations")
    states = torch.tensor([s["state"] for s in rows], dtype=torch.float64)
    actions = torch.tensor([s["action"] for s in rows], dtype=torch.long)
    rewards = torch.tensor([s["reward"] for s in rows], dtype=torch.float64)
    if states.ndim != 2 or states.shape[1] != 13 or not torch.isfinite(states).all() \
            or (states < 0).any() or (states > 1).any() or not torch.isfinite(rewards).all() \
            or (rewards < -10).any() or (rewards > 0).any():
        raise ValueError("Invalid state or reward")
    if set(actions.tolist()) != {0, 1, 2}:
        raise ValueError("Training requires actual TERMINAL, EDGE and CLOUD samples; do not invent missing rewards")
    if not (states[torch.arange(len(rows)), 1 + actions * 4] == 1).all():
        raise ValueError("Observed action was not eligible")
    return states, actions, rewards


def fit(samples, updates=1000, seed=17):
    if updates < 1:
        raise ValueError("updates must be positive")
    states, actions, rewards = dataset(samples)
    torch.manual_seed(seed)
    torch.set_num_threads(1)
    network = torch.nn.Sequential(torch.nn.Linear(13, 16), torch.nn.ReLU(), torch.nn.Linear(16, 3)).double()
    optimizer = torch.optim.Adam(network.parameters(), lr=0.01)
    # Every sample ends its episode: the TD target is its observed reward, with no fabricated next_state.
    with torch.no_grad():
        before = torch.nn.functional.mse_loss(network(states).gather(1, actions[:, None]).squeeze(1), rewards).item()
    for _ in range(updates):
        index = torch.randint(len(states), (min(64, len(states)),))
        q = network(states[index]).gather(1, actions[index, None]).squeeze(1)
        loss = torch.nn.functional.smooth_l1_loss(q, rewards[index])
        optimizer.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(network.parameters(), 10)
        optimizer.step()
    with torch.no_grad():
        after = torch.nn.functional.mse_loss(network(states).gather(1, actions[:, None]).squeeze(1), rewards).item()
    model = {"stateSchema": SCHEMA, "weights1": network[0].weight.detach().tolist(),
             "bias1": network[0].bias.detach().tolist(), "weights2": network[2].weight.detach().tolist(),
             "bias2": network[2].bias.detach().tolist()}
    return model, {"samples": len(states), "beforeMse": before, "afterMse": after,
                   "scope": "single-placement episodes; no performance claim"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("samples", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--updates", type=int, default=1000)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError("Output already exists; choose a new model artifact/version")
    model, report = fit(json.loads(args.samples.read_text(encoding="utf-8-sig")), args.updates)
    args.output.write_text(json.dumps(model, allow_nan=False), encoding="utf-8")
    print(json.dumps(report, allow_nan=False))
