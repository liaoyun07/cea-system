"""One queue owner per edge/cloud; gateways decide before any execution is created."""
from datetime import timedelta
import queue
import threading
import time
from core import Ledger, Store, choose, rpc, state_vector
from execution import Kubernetes


class Node:
    def __init__(self, config):
        from minio import Minio
        self.config, self.store = config, Store(config["database"])
        self.ledger, self.queue, self.ready_ids = Ledger(), queue.Queue(), set()
        self.lock = threading.Lock()
        storage = config["storage"]
        self.storage = Minio(storage["endpoint"], access_key=storage["accessKey"], secret_key=storage["secretKey"], secure=False, region="us-east-1")
        self.kube = Kubernetes(config["execution"])
        # Restart never guesses or replays the fate of an accepted request.
        rows = self.store.sql("SELECT id FROM offlab_tasks WHERE owner=%s AND state NOT IN ('SUCCESS','FAILED','CANCELLED')", (config["id"],))
        if rows:
            raise RuntimeError("unfinished accepted tasks exist; reconcile original Jobs before restarting this queue")
        for _ in range(config["slots"]):
            threading.Thread(target=self.work, daemon=True).start()

    def key(self, task, filename):
        return f'lab/offload-lab/{task["runId"]}/{task["id"]}/{filename}'

    def url(self, task, method, filename):
        return self.storage.get_presigned_url(method, self.config["storage"]["bucket"], self.key(task, filename), expires=timedelta(hours=12))

    def accept(self, task):
        task = {**task, "owner": self.config["id"], "state": "UPLOADING", "acceptedAt": time.time()}
        self.ledger.accept(task["id"], task["bytes"])
        try:
            self.store.add(task)
            return {"ownerUrl": self.config["publicUrl"], "uploadUrl": self.url(task, "PUT", "input")}
        except Exception:
            self.ledger.finish(task["id"])
            raise

    def decide(self, request):
        begin = time.perf_counter()
        cloud = rpc(self.config["cloudUrl"], self.config["token"], "/backlog")["bytes"]
        raw = [request["bytes"], request["localBytes"], request["uploadWaitSeconds"], self.ledger.total(), cloud]
        destination = choose(request["strategy"], request, raw, self.config.get("model"))
        task = {**request, "destination": destination, "gateway": self.config["id"], "rawState": raw,
                "stateVector": state_vector(*raw), "decisionSeconds": time.perf_counter() - begin, "decidedAt": time.time()}
        if destination == "TERMINAL":
            self.store.add({**task, "owner": request["terminal"], "state": "QUEUED"})
            return {"destination": destination}
        reservation = self.accept(task) if destination == "EDGE" else rpc(self.config["cloudUrl"], self.config["token"], "/accept", task)
        return {"destination": destination, **reservation}

    def ready(self, request):
        task = self.store.task(request["id"])
        if task["owner"] != self.config["id"]:
            raise ValueError("wrong queue owner")
        with self.lock:
            if task["id"] not in self.ready_ids:
                self.store.patch(task["id"], {"state": "QUEUED", "readyAt": time.time()})
                self.ready_ids.add(task["id"])
                self.queue.put(task)
        return {"accepted": True}

    def work(self):
        while True:
            task = self.queue.get()
            try:
                self.store.patch(task["id"], {"state": "RUNNING", "dispatchedAt": time.time()})
                result = self.kube.run(task, self.url(task, "GET", "input"), self.url(task, "PUT", "result.json"),
                                       lambda values: self.store.patch(task["id"], values))
                self.store.patch(task["id"], {"state": "SUCCESS", "result": result, "finishedAt": result["measurement"]["finishedAt"], "observedAt": time.time()})
            except Exception as error:
                self.store.patch(task["id"], {"state": "FAILED", "error": str(error)[:500], "observedAt": time.time()})
            finally:
                self.ledger.finish(task["id"])
                self.queue.task_done()

    def cleanup(self, run):
        tasks = self.store.tasks(run)
        if any(t["state"] not in ("SUCCESS", "FAILED", "CANCELLED") for t in tasks):
            raise ValueError("experiment still active")
        jobs = self.kube.cleanup(run)
        prefix = "lab/offload-lab/" + run + "/"
        if "/" in run or not run.startswith("oil-"):
            raise ValueError("invalid experiment prefix")
        bucket = self.config["storage"]["bucket"]
        count = 0
        for obj in self.storage.list_objects(bucket, prefix=prefix, recursive=True):
            self.storage.remove_object(bucket, obj.object_name)
            count += 1
        with self.lock:
            self.ready_ids.difference_update(t["id"] for t in tasks)
        return {"jobs": jobs, "objects": count}

    def handle(self, method, path, data):
        if path == "/backlog":
            return {"bytes": self.ledger.total(), "slots": self.config["slots"]}
        if path == "/decide" and self.config["role"] == "gateway":
            return self.decide(data)
        if path == "/accept":
            return self.accept(data)
        if path == "/ready":
            return self.ready(data)
        if path.startswith("/tasks/"):
            key = path.split("/")[-1]
            if method == "POST":
                self.store.patch(key, data)
                if data.get("state") in ("FAILED", "CANCELLED"):
                    self.ledger.finish(key)
                return {"updated": True}
            return self.store.task(key)
        if path == "/cleanup":
            return self.cleanup(data["runId"])
        raise KeyError(path)
