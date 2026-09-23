"""Bounded edge-side model inference only; no placement, workflow state or training."""
import math
import random
import time

SCHEMA = "measured-offload-log1p-v1"


def vector(values, size):
    if not isinstance(values, list) or len(values) != size or any(
        type(v) not in (int, float) or not math.isfinite(v) or abs(v) > 1e6 for v in values
    ):
        raise ValueError("invalid finite vector")
    return values


def predict(model, state):
    if not isinstance(model, dict) or model.get("stateSchema") != SCHEMA:
        raise ValueError("six-state measured model required")
    state = vector(state, 6)
    if min(state) < 0:
        raise ValueError("nonnegative log1p state required")
    bias = model.get("bias1")
    if not isinstance(bias, list) or not 1 <= len(bias) <= 128:
        raise ValueError("invalid hidden size")
    vector(bias, len(bias))
    weights = model.get("weights1")
    output = model.get("weights2")
    if not isinstance(weights, list) or len(weights) != len(bias) or not isinstance(output, list) or len(output) != 3:
        raise ValueError("invalid matrix shape")
    hidden = [max(0, b + sum(w * s for w, s in zip(vector(row, 6), state))) for row, b in zip(weights, bias)]
    return vector([b + sum(w * h for w, h in zip(vector(row, len(hidden)), hidden))
                   for row, b in zip(output, vector(model.get("bias2"), 3))], 3)


def decide(request, rng=random):
    if set(request) != {"model", "state", "legalActions", "exploration"}:
        raise ValueError("bounded decision request required")
    legal = request["legalActions"]
    epsilon = request["exploration"]
    if not isinstance(legal, list) or not legal or len(legal) > 3 or any(type(a) is not int or a not in (0, 1, 2) for a in legal) or len(set(legal)) != len(legal):
        raise ValueError("legal execution layers required")
    if type(epsilon) not in (int, float) or not math.isfinite(epsilon) or not 0 <= epsilon <= 1:
        raise ValueError("exploration must be 0..1")
    started = time.perf_counter_ns()
    q = predict(request["model"], request["state"])
    inference_ms = (time.perf_counter_ns() - started) / 1_000_000
    ordered = sorted(legal)
    action = rng.choice(ordered) if epsilon > 0 and rng.random() < epsilon else max(ordered, key=lambda a: q[a])
    return {"action": action, "inferenceMs": inference_ms}
