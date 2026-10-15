"""Event simulation for independent offloading; no Docker/API/database calls."""
import heapq
import json
import random
import statistics
import sys
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "deploy/offload-lab"))
from core import SCHEMA, choose, state_vector, trace

POSITIONS = ["TERMINAL", "EDGE", "CLOUD"]
SIZES = {"small": 5_000_000, "medium": 50_000_000, "large": 500_000_000}


def quantile(values, p):
    values = sorted(values)
    x = (len(values) - 1) * p
    lo = int(x)
    return values[lo] + (values[min(lo + 1, len(values) - 1)] - values[lo]) * (x - lo)


def calibrate(folder, primary=None, fallback_file="random-result.json"):
    # Current local/fixed runs, NOT held-out jitter run. Older random run fills
    # missing action/size cells only; its different slots/memory are disclosed.
    primary = primary or ["jitter-LOCAL-result.json", "jitter-TERMINAL_30-result.json"]
    old = fallback_file
    views = {f: json.loads((folder / f).read_text(encoding="utf8")) for f in primary + [old]}
    cells = {}
    for destination in POSITIONS:
        for size in SIZES:
            rows = [(f, t) for f in primary for t in views[f]["tasks"]
                    if t["state"] == "SUCCESS" and t["destination"] == destination and t["size"] == size]
            fallback = not rows
            if fallback:
                rows = [(old, t) for t in views[old]["tasks"]
                        if t["state"] == "SUCCESS" and t["destination"] == destination and t["size"] == size]
            if not rows:
                raise ValueError(f"No calibration evidence for {destination}/{size}")
            service = [t["finishedAt"] - t["dispatchedAt"] for _, t in rows]
            tail = [max(0, t["observedAt"] - t["finishedAt"]) for _, t in rows]
            # Upload is measured separately, never included again in service.
            upload = [(t["uploadFinishedAt"] - t["uploadStartedAt"]) /
                      (t["bytes"] / 12_500_000 + (.01 if destination == "EDGE" else .1))
                      for _, t in rows if destination != "TERMINAL"]
            describe = lambda a: [quantile(a, p) for p in (.1, .5, .9)]
            cells[f"{destination}:{size}"] = {"n": len(rows), "sources": sorted({f for f, _ in rows}),
                "olderConfigurationFallback": fallback and old == "random-result.json", "service": describe(service), "releaseLag": describe(tail),
                "uploadFactor": describe(upload) if upload else [1, 1, 1]}
    return {"stateSchema": SCHEMA, "units": "seconds; bytes; decimal MB", "cells": cells,
            "scope": "Empirical 10/50/90 percentiles, no queue time in service. Pooled timings approximate host contention.",
            "limitations": ["Not a CPU/memory consumption simulator", "Fallback source and configuration must be checked in each cell",
                            "No explicit shared-host contention or SQL saturation model", "Upload-wait observation approximates remaining paced bytes",
                            "Observation lag excludes small unrecorded database-update/ledger-release overhead"]}


def arrivals(seed, interval=10, seconds=90):
    tasks = []
    for terminal in range(30):
        name = f"oil-terminal-{terminal + 1:03d}"
        for index, item in enumerate(trace(seed, name, seconds, interval, list(SIZES), [.60, .38, .02])):
            tasks.append({"terminal": name, "terminalIndex": terminal, "index": index, "seed": seed,
                          "size": item["size"], "bytes": SIZES[item["size"]], "at": item["offset"]})
    return sorted(tasks, key=lambda t: (t["at"], t["terminalIndex"], t["index"]))


class Environment:
    def __init__(self, calibration, tasks, scenario=0, randomized=False):
        self.calibration, self.tasks = calibration, [dict(t) for t in tasks]
        self.events, self.serial, self.cursor, self.now = [], 0, 0, 0.0
        self.backlog = [0] * 34  # 30 terminals, 3 edges, one cloud
        self.busy = [0] * 34
        self.capacity = [1] * 30 + [4] * 4
        self.queues = [deque() for _ in range(34)]
        self.upload_end = [0.0] * 30
        self.upload_items = [[] for _ in range(30)]
        self.records = []
        self.scenario, self.randomized = scenario, randomized
        rng = random.Random(f"scenario:{scenario}")
        # Parameter uncertainty, not fitted to any desired improvement threshold.
        self.scales = [rng.uniform(.8, 1.2) for _ in range(4)] if randomized else [1] * 4

    def event(self, when, kind, task):
        self.serial += 1
        heapq.heappush(self.events, (when, self.serial, kind, task))

    def advance(self, until):
        while self.events and self.events[0][0] <= until:
            self.now, _, kind, task = heapq.heappop(self.events)
            node = task["node"]
            if kind == "ready":
                self.queues[node].append(task)
            else:
                self.busy[node] -= 1
                self.backlog[node] -= task["bytes"]
                task["releasedAt"] = self.now
            while self.queues[node] and self.busy[node] < self.capacity[node]:
                self.start(self.queues[node].popleft())
        self.now = until

    def start(self, task):
        node = task["node"]
        self.busy[node] += 1
        task["dispatchedAt"] = self.now
        task["finishedAt"] = self.now + task["service"]
        self.event(task["finishedAt"] + task["lag"], "release", task)

    def state(self):
        if self.cursor == len(self.tasks):
            return None
        task = self.tasks[self.cursor]
        self.advance(task["at"])
        terminal = task["terminalIndex"]
        wait = 0.0
        for start, end, nominal in self.upload_items[terminal]:
            if end > self.now:
                wait += nominal * min(1, (end - self.now) / (end - start))
        raw = [task["bytes"], self.backlog[terminal], wait,
               self.backlog[30 + terminal // 10], self.backlog[33]]
        return raw

    def durations(self, task, action):
        cell = self.calibration["cells"][f"{POSITIONS[action]}:{task['size']}"]
        rng = random.Random(f"{self.scenario}:{task['terminal']}:{task['index']}:{action}")
        def draw(key):
            low, mid, high = cell[key]
            return rng.triangular(low, max(low + 1e-9, high), mid) if self.randomized else mid
        return draw("service") * self.scales[action], draw("releaseLag"), draw("uploadFactor") * self.scales[3]

    def act(self, action):
        task = self.tasks[self.cursor]
        terminal = task["terminalIndex"]
        node = terminal if action == 0 else 30 + terminal // 10 if action == 1 else 33
        service, lag, factor = self.durations(task, action)
        task.update(action=action, node=node, service=service, lag=lag)
        self.backlog[node] += task["bytes"]
        ready = task["at"]
        if action:
            start = max(ready, self.upload_end[terminal])
            nominal = task["bytes"] / 12_500_000 + (.01 if action == 1 else .1)
            ready = start + nominal * factor
            self.upload_end[terminal] = ready
            self.upload_items[terminal].append((start, ready, nominal))
            task.update(uploadStartedAt=start, uploadFinishedAt=ready)
        task["readyAt"] = ready
        self.event(ready, "ready", task)
        self.records.append(task)
        self.cursor += 1

    def finish(self):
        self.advance(float("inf"))
        return self.records


def summary(records):
    delays = [t["finishedAt"] - t["at"] for t in records]
    return {"tasks": len(records), "meanSeconds": statistics.mean(delays), "p95Seconds": quantile(delays, .95),
            "makespanSeconds": max(t["finishedAt"] for t in records) - min(t["at"] for t in records),
            "destinations": {p: sum(t["action"] == i for t in records) for i, p in enumerate(POSITIONS)},
            "bySize": {s: {p: sum(t["size"] == s and t["action"] == i for t in records)
                           for i, p in enumerate(POSITIONS)} for s in SIZES}}


def rollout(calibration, tasks, policy, scenario=0, randomized=False):
    env = Environment(calibration, tasks, scenario, randomized)
    states, actions = [], []
    while (raw := env.state()) is not None:
        task = env.tasks[env.cursor]
        action = policy(raw, task)
        states.append(state_vector(*raw))
        actions.append(action)
        env.act(action)
    records = env.finish()
    return states, actions, records


def rule(name):
    # Freeze the measured fixed baseline in this experiment. It must not change
    # when a future production scheduling policy changes.
    def policy(raw, task):
        if name in ("TERMINAL_30", "TERMINAL_30_RANDOM10"):
            if name == "TERMINAL_30_RANDOM10":
                rng = random.Random(f'{task["seed"]}:{task["terminal"]}:{task["index"]}:perturb10')
                if rng.random() < .1:
                    return rng.randrange(3)
            if task["bytes"] <= 5_000_000:
                return (int(task["terminal"].rsplit("-", 1)[-1]) + task["index"]) % 2
            return 2 if task["bytes"] >= 500_000_000 else 1
        return POSITIONS.index(choose(name, task, raw))
    return policy


def evaluate(calibration, policy, seeds, intervals=(10,), randomized=False):
    rows = []
    for interval in intervals:
        for seed in seeds:
            _, _, records = rollout(calibration, arrivals(seed, interval), policy, seed, randomized)
            rows.append({"seed": seed, "interval": interval, **summary(records)})
    return rows
