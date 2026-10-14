"""Experiment control/reporting only. Never routes individual offload requests."""
from concurrent.futures import ThreadPoolExecutor
import json
import math
import threading
import time
import uuid
from core import Store, TERMINAL, rpc, trace


def summary(tasks):
    successes = [t for t in tasks if t["state"] == "SUCCESS"]
    durations = sorted(t["finishedAt"] - t["requestedAt"] for t in successes)
    stages = {}
    pairs = {"decision": ("requestedAt", "decidedAt"), "uploadWait": ("decidedAt", "uploadStartedAt"),
             "upload": ("uploadStartedAt", "uploadFinishedAt"), "executionWait": ("readyAt", "dispatchedAt")}
    for name, (start, end) in pairs.items():
        values = [t[end] - t[start] for t in successes if start in t and end in t]
        stages[name] = sum(values) / len(values) if values else None
    for name, start, end in [("startup", "submittedAt", "computeStartedAt"), ("compute", "computeStartedAt", "computeFinishedAt")]:
        values = []
        for t in successes:
            merged = {**t, **t["result"]["measurement"]}
            values.append(merged[end] - merged[start])
        stages[name] = sum(values) / len(values) if values else None
    return {"submitted": len(tasks), "completed": len(successes), "failed": sum(t["state"] == "FAILED" for t in tasks),
            "pending": sum(t["state"] not in TERMINAL for t in tasks), "totalTaskSeconds": sum(durations),
            "meanSeconds": sum(durations) / len(durations) if durations else None,
            "p95Seconds": durations[math.ceil(len(durations) * .95) - 1] if durations else None,
            "makespanSeconds": max(t.get("finishedAt", t.get("observedAt", t["requestedAt"])) for t in tasks) - min(t["requestedAt"] for t in tasks) if tasks and all(t["state"] in TERMINAL for t in tasks) else None,
            "destinations": {d: sum(t.get("destination") == d for t in tasks) for d in ["TERMINAL", "EDGE", "CLOUD"]}, "stageMeanSeconds": stages}


class Controller:
    def __init__(self, config):
        self.config, self.store = config, Store(config["database"])
        self.lock, self.latest, self.active = threading.RLock(), {}, None
        self.pool = ThreadPoolExecutor(max_workers=10)
        # Preserve interrupted experiments; no automatic replay or speculative cleanup.
        for row in self.store.sql("SELECT payload FROM offlab_runs"):
            run = json.loads(row["payload"])
            if run["state"] in ("SENDING", "DRAINING"):
                run.update(state="INTERRUPTED", error="controller restarted; inspect original task records")
                self.store.save_run(run)

    def fleet(self, path, data=None):
        def call(terminal):
            return rpc(terminal["url"], self.config["token"], path, data)
        return list(self.pool.map(call, self.config["terminals"]))

    def start(self, data):
        if data["strategy"] not in ("LOCAL", "RANDOM"):
            raise ValueError("this experiment enables LOCAL and RANDOM; DQN needs a five-state trained model")
        seconds, interval = float(data.get("seconds", 90)), float(data.get("interval", 10))
        if not 0 < seconds <= 3600 or interval <= 0:
            raise ValueError("positive duration (max 3600s) and interval required")
        with self.lock:
            if self.active:
                raise ValueError("previous experiment has not drained")
            if self.store.sql("SELECT id FROM offlab_tasks WHERE state NOT IN ('SUCCESS','FAILED','CANCELLED') LIMIT 1"):
                raise ValueError("unfinished tasks from an earlier experiment")
            states = self.fleet("/status")
            if any(t["sending"] or t["pending"] for t in states):
                raise ValueError("terminals have unfinished work")
            if any(rpc(node, self.config["token"], "/backlog")["bytes"] for node in self.config["nodes"]):
                raise ValueError("execution queues have unfinished work")
            run = {"id": "oil-" + uuid.uuid4().hex[:12], "state": "SENDING", "strategy": data["strategy"],
                   "seed": int(data.get("seed", 31)), "seconds": seconds, "interval": interval,
                   "createdAt": time.time(), "startAt": time.time() + 8, "changes": [], "cleanup": "PENDING"}
            run["plans"] = {t["id"]: trace(run["seed"], t["id"], seconds, interval, ["small", "medium", "large"], [.60, .38, .02]) for t in self.config["terminals"]}
            run["expected"] = sum(len(x) for x in run["plans"].values())
            self.store.save_run(run)
            self.active = run
        threading.Thread(target=self.drive, args=(run,), daemon=True).start()
        return run

    def drive(self, run):
        try:
            def launch(t):
                command = {"runId": run["id"], "strategy": run["strategy"], "seed": run["seed"], "startAt": run["startAt"], "plan": run["plans"][t["id"]]}
                return rpc(t["url"], self.config["token"], "/start", command)
            list(self.pool.map(launch, self.config["terminals"]))
            while True:
                states = self.fleet("/status")
                tasks = self.store.tasks(run["id"])
                if all(not t["sending"] for t in states):
                    run["state"] = "DRAINING"
                    self.store.save_run(run)
                    if all(not t["pending"] for t in states) and all(t["state"] in TERMINAL for t in tasks):
                        if not run.get("stopRequestedAt") and len(tasks) != run["expected"]:
                            raise RuntimeError("not all planned arrivals were recorded; keep experiment artifacts")
                        break
                time.sleep(2)
            run.update(state="FINISHED", endedAt=time.time(), summary=summary(tasks))
            # Persist observations before destructive cleanup. Files are not result records.
            self.store.save_run(run)
            cleanup = {"terminals": self.fleet("/cleanup", {"runId": run["id"]}), "nodes": []}
            for node in self.config["nodes"]:
                cleanup["nodes"].append(rpc(node, self.config["token"], "/cleanup", {"runId": run["id"]}, timeout=120))
            run.update(cleanup="DONE", cleanupCounts=cleanup)
            self.store.save_run(run)
        except Exception as error:
            run.update(state="ERROR", error=str(error)[:500])
            self.store.save_run(run)
        finally:
            with self.lock:
                self.active = None

    def handle(self, method, path, data):
        if path == "/devices":
            return [{"id": t["id"], "gateway": t["gateway"], "resource": self.latest.get(t["id"])} for t in self.config["terminals"]]
        if path == "/samples":
            self.latest[data["terminal"]] = data
            if data.get("runId"):
                self.store.sql("INSERT INTO offlab_samples(run_id,terminal_id,sampled_at,payload) VALUES(%s,%s,%s,%s)",
                               (data["runId"], data["terminal"], data["sampledAt"], json.dumps(data)))
            return {"accepted": True}
        if path == "/errors":
            existing = self.store.sql("SELECT id FROM offlab_tasks WHERE id=%s", (data["id"],))
            if existing:
                self.store.patch(data["id"], {"state": "FAILED", "error": data["error"], "observedAt": time.time()})
            else:
                self.store.add({**data, "owner": data["terminal"], "state": "FAILED", "observedAt": time.time()})
            return {"accepted": True}
        if path == "/runs":
            if method == "POST":
                return self.start(data)
            return [json.loads(r["payload"]) for r in self.store.sql("SELECT payload FROM offlab_runs ORDER BY JSON_EXTRACT(payload,'$.createdAt') DESC LIMIT 50")]
        if path.startswith("/runs/"):
            parts = path.split("/")
            run = self.store.run(parts[2])
            if method == "GET":
                tasks = self.store.tasks(run["id"])
                samples = [json.loads(r["payload"]) for r in self.store.sql("SELECT payload FROM offlab_samples WHERE run_id=%s ORDER BY sampled_at", (run["id"],))]
                return {"run": run, "tasks": tasks, "summary": summary(tasks), "samples": samples}
            if not self.active or self.active["id"] != run["id"]:
                raise ValueError("experiment is not active")
            if parts[-1] == "stop":
                with self.lock:
                    self.active["stopRequestedAt"] = time.time()
                    self.store.save_run(self.active)
                self.fleet("/stop", {})
                return {"stopping": True}
            if parts[-1] == "strategy":
                if data["strategy"] not in ("LOCAL", "RANDOM"):
                    raise ValueError("unsupported strategy")
                self.fleet("/strategy", data)
                with self.lock:
                    self.active["strategy"] = data["strategy"]
                    self.active["changes"].append({"at": time.time(), "strategy": data["strategy"]})
                    self.store.save_run(self.active)
                return self.active
        raise KeyError(path)
