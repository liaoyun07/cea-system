"""Poisson producer, one FIFO uploader and one local compute slot per terminal."""
import json
import logging
from pathlib import Path
import queue
import threading
import time
import requests
from core import Ledger, UploadLedger, rpc
from execution import Docker
from legacy_load import CgroupMeter


class PacedFile:
    def __init__(self, path, task, ledger, rate):
        self.stream = open(path, "rb")
        self.length = Path(path).stat().st_size
        self.task, self.ledger, self.rate = task, ledger, rate
        self.started, self.sent = time.monotonic(), 0

    def __len__(self):
        return self.length

    def read(self, size=-1):
        block = self.stream.read(min(size, 256 * 1024) if size > 0 else 256 * 1024)
        self.sent += len(block)
        # Pace actual HTTP body bytes, never retain the full 500 MB file in memory.
        time.sleep(max(0, self.started + self.sent / self.rate - time.monotonic()))
        self.ledger.sent(self.task, len(block))
        return block


class Terminal:
    def __init__(self, config):
        self.config = config
        self.compute, self.upload = queue.Queue(), queue.Queue()
        self.local = Ledger()
        self.link = UploadLedger(config["uploadBytesPerSecond"])
        self.docker = Docker(config)
        self.meter = CgroupMeter(config["resourceDirectory"])
        self.lock, self.command, self.sending, self.pending, self.resource = threading.Lock(), None, False, 0, {}
        self.stopped = threading.Event()
        for target in (self.compute_loop, self.upload_loop, self.samples):
            threading.Thread(target=target, daemon=True).start()

    def call(self, path, data=None, base=None):
        return rpc(base or self.config["gatewayUrl"], self.config["token"], path, data)

    def patch(self, task, **values):
        self.call("/tasks/" + task["id"], values)

    def launch(self, command):
        with self.lock:
            if self.sending or self.pending:
                raise ValueError("terminal has unfinished work")
            self.command, self.sending = command, True
            self.stopped = threading.Event()
        threading.Thread(target=self.arrivals, args=(command,), daemon=True).start()
        return {"started": True}

    def arrivals(self, command):
        try:
            for index, item in enumerate(command["plan"]):
                if self.stopped.wait(max(0, command["startAt"] + item["offset"] - time.time())):
                    break
                task = {"id": f'{command["runId"]}-{self.config["index"]}-{index}', "runId": command["runId"],
                        "terminal": self.config["id"], "seed": command["seed"], "index": index, "size": item["size"],
                        "bytes": self.config["files"][item["size"]]["bytes"], "strategy": self.command["strategy"],
                        "scheduledAt": command["startAt"] + item["offset"], "requestedAt": time.time(),
                        "localBytes": self.local.total(), "uploadWaitSeconds": self.link.wait()}
                with self.lock:
                    self.pending += 1
                try:
                    answer = self.call("/decide", task)
                    task.update(answer)
                    if answer["destination"] == "TERMINAL":
                        self.local.accept(task["id"], task["bytes"])
                        self.patch(task, readyAt=time.time())
                        self.compute.put(task)
                    else:
                        self.link.add(task["id"], task["bytes"], self.config["latencySeconds"][task["destination"]])
                        self.upload.put(task)
                except Exception as error:
                    # Admission errors remain visible; never silently omit a generated request.
                    record = {k: v for k, v in task.items() if k not in ("uploadUrl", "ownerUrl")}
                    self.call("/errors", {**record, "error": type(error).__name__}, base=self.config["controllerUrl"])
                    with self.lock:
                        self.pending -= 1
        finally:
            with self.lock:
                self.sending = False

    def compute_loop(self):
        while True:
            task = self.compute.get()
            try:
                self.patch(task, state="RUNNING", dispatchedAt=time.time())
                result = self.docker.run(task, lambda values: self.patch(task, **values))
                self.patch(task, state="SUCCESS", result=result, finishedAt=result["measurement"]["finishedAt"], observedAt=time.time())
            except Exception as error:
                self.patch(task, state="FAILED", error=str(error)[:500], observedAt=time.time())
            finally:
                self.local.finish(task["id"])
                with self.lock:
                    self.pending -= 1
                self.compute.task_done()

    def upload_loop(self):
        while True:
            task = self.upload.get()
            stream = None
            try:
                self.patch(task, uploadStartedAt=time.time())
                stream = PacedFile(self.config["files"][task["size"]]["path"], task["id"], self.link, self.config["uploadBytesPerSecond"])
                response = requests.put(task["uploadUrl"], data=stream, headers={"Content-Length": str(len(stream))}, timeout=120)
                response.raise_for_status()
                self.link.delaying(task["id"])
                time.sleep(self.config["latencySeconds"][task["destination"]])
                self.patch(task, uploadFinishedAt=time.time())
                self.call("/ready", {"id": task["id"]}, base=task["ownerUrl"])
                # Completion is collected by the controller, not polled by each terminal.
            except Exception as error:
                self.call("/tasks/" + task["id"], {"state": "FAILED", "error": "upload: " + type(error).__name__, "observedAt": time.time()}, base=task["ownerUrl"])
            finally:
                if stream:
                    stream.stream.close()
                self.link.finish(task["id"])
                with self.lock:
                    self.pending -= 1
                self.upload.task_done()

    def samples(self):
        while True:
            try:
                sample = {**self.meter.read(), "terminal": self.config["id"], "gateway": self.config["gateway"],
                          "sampledAt": time.time(), "runId": self.command["runId"] if self.command else None}
                self.resource = sample
                rpc(self.config["controllerUrl"], self.config["token"], "/samples", sample)
            except Exception as error:
                logging.warning("sample: %s", type(error).__name__)
            time.sleep(2)

    def handle(self, method, path, data):
        if path == "/status":
            return {"id": self.config["id"], "gateway": self.config["gateway"], "sending": self.sending,
                    "pending": self.pending, "localBytes": self.local.total(), "uploadWaitSeconds": self.link.wait(), "resource": self.resource}
        if path == "/start":
            return self.launch(data)
        if path == "/stop":
            self.stopped.set()
            return {"stopping": True}
        if path == "/strategy":
            self.command["strategy"] = data["strategy"]
            return {"strategy": data["strategy"]}
        if path == "/cleanup":
            if self.pending or self.sending:
                raise ValueError("terminal still active")
            count = self.docker.cleanup(data["runId"])
            self.command = None
            return {"containers": count}
        raise KeyError(path)
