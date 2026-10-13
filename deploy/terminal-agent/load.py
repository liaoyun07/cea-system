"""Terminal-side arrivals and cgroup measurements. Execution remains in CEA."""
import json
import logging
from pathlib import Path
import queue
import random
import threading
import time
import urllib.error
import uuid

from compute import request


class CgroupMeter:
    def __init__(self, root):
        self.root = Path(root)
        self.previous = None

    def read(self):
        usage = dict(line.split() for line in (self.root / "cpu.stat").read_text().splitlines())
        now, cpu = time.monotonic(), int(usage["usage_usec"]) / 1_000_000
        quota, period = (self.root / "cpu.max").read_text().split()
        memory_limit = (self.root / "memory.max").read_text().strip()
        if quota == "max" or memory_limit == "max":
            raise ValueError("a bounded terminal parent cgroup is required")
        delta, interval = (None, 1.0) if self.previous is None else (cpu - self.previous[1], now - self.previous[0])
        self.previous = now, cpu
        return {"cpuSeconds": delta, "sampleSeconds": interval,
                "memoryBytes": int((self.root / "memory.current").read_text()),
                "cpuCores": int(quota) / int(period), "memoryLimitBytes": int(memory_limit)}


def arrivals(seed, terminal):
    return random.Random(f"{seed}:{terminal}:arrivals")


class LoadClient:
    def __init__(self, config):
        self.config = config
        self.meter = CgroupMeter(config["resourceDirectory"])
        self.lock = threading.Lock()
        self.command = None
        self.stop_sending = threading.Event()
        self.pending = 0
        self.reports = queue.Queue()

    def start(self):
        threading.Thread(target=self.sample_loop, daemon=True, name="terminal-resources").start()
        threading.Thread(target=self.report_loop, daemon=True, name="terminal-reports").start()

    def update(self, command):
        with self.lock:
            if not command:
                self.stop_sending.set()
                if self.pending == 0:
                    self.command = None
                return
            if self.command and self.command["runId"] == command["runId"]:
                self.command = command
                if not command["sending"]:
                    self.stop_sending.set()
                return
            if self.pending:
                raise RuntimeError("previous load has not drained")
            self.command = command
            self.stop_sending = threading.Event()
            if command["sending"]:
                threading.Thread(target=self.send_loop, args=(command, self.stop_sending), daemon=True, name="terminal-arrivals").start()
            else:
                self.stop_sending.set()

    def sample_loop(self):
        while True:
            try:
                sample = self.meter.read()
                with self.lock:
                    sample.update(loadRunId=self.command["runId"] if self.command else None,
                                  sending=bool(self.command and not self.stop_sending.is_set()),
                                  pendingRequests=self.pending + self.reports.unfinished_tasks)
                self.update(request(self.config, "/v1/load/resource", sample))
            except Exception as error:
                logging.warning("resource/control unavailable: %s", type(error).__name__)
            time.sleep(1)

    def send_loop(self, command, stopped):
        rng = arrivals(command["seed"], self.config["terminalId"])
        files_rng = random.Random(f'{command["seed"]}:{self.config["terminalId"]}:files')
        files = self.config["files"]
        next_at = time.monotonic()
        while True:
            next_at += rng.expovariate(1 / command["meanIntervalSeconds"])
            if stopped.wait(max(0, next_at - time.monotonic())):
                return
            arrival_started = time.perf_counter()
            size = files_rng.choice(["small", "medium", "large"]) if command["inputSize"] == "mixed" else command["inputSize"]
            descriptor = files[size]
            request_id = str(uuid.uuid4())
            with self.lock:
                # An explicit rejected arrival is counted, never silently thinned or turned into a success.
                saturated = self.pending >= 64
                if not saturated:
                    self.pending += 1
            if saturated:
                self.reports.put({"runId": command["runId"], "requestId": request_id, "outcome": "REJECTED",
                                  "elapsedSeconds": time.perf_counter() - arrival_started, "error": "terminal request capacity reached"})
            else:
                threading.Thread(target=self.execute, args=(command["runId"], request_id, descriptor), daemon=True).start()

    def execute(self, run_id, request_id, descriptor):
        started = time.perf_counter()
        execution_id = None
        outcome, message = "UNKNOWN", None
        try:
            accepted = request(self.config, "/v1/load/requests", {"runId": run_id, "requestId": request_id, "file": descriptor})
            execution_id = accepted["executionId"]
            deadline = time.monotonic() + 240
            while True:
                result = request(self.config, "/v1/executions/" + execution_id)
                if result["state"] in ("SUCCESS", "FAILED", "KILLED"):
                    outcome = {"SUCCESS": "SUCCESS", "FAILED": "FAILED", "KILLED": "CANCELLED"}[result["state"]]
                    break
                if time.monotonic() >= deadline:
                    outcome = "TIMEOUT"
                    break
                time.sleep(0.5)
        except urllib.error.HTTPError as error:
            outcome = "REJECTED" if execution_id is None and error.code in (400, 401, 403, 404, 409, 422, 429) else "UNKNOWN"
            message = f"HTTP {error.code}"
        except Exception as error:
            message = type(error).__name__
        elapsed = time.perf_counter() - started
        self.reports.put({"runId": run_id, "requestId": request_id, "outcome": outcome,
                          "elapsedSeconds": elapsed, "error": message})
        if execution_id and outcome in ("SUCCESS", "FAILED", "CANCELLED", "TIMEOUT"):
            try:
                request(self.config, f"/v1/executions/{execution_id}/feedback", {"outcome": outcome, "elapsedSeconds": elapsed})
            except Exception as error:
                logging.warning("training feedback unavailable: %s", type(error).__name__)
        with self.lock:
            self.pending -= 1

    def report_loop(self):
        while True:
            report = self.reports.get()
            try:
                request(self.config, "/v1/load/report", report)
            except Exception as error:
                # Keep the original duration, not the later delivery time. No task is resubmitted.
                folder = Path(self.config.get("reportDirectory", "/state/load-reports"))
                folder.mkdir(parents=True, exist_ok=True)
                (folder / (report["requestId"] + ".json")).write_text(json.dumps(report))
                logging.warning("load report retained locally: %s", type(error).__name__)
            finally:
                self.reports.task_done()
