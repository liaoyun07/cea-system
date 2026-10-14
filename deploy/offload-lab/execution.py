"""Direct k3s/Docker execution adapters. No Flow, Worker, or admission lock."""
import base64
import json
from pathlib import Path
import tempfile
import time


def result_from_logs(logs):
    for line in reversed(logs.splitlines()):
        if line.startswith("OFFLAB_RESULT="):
            return json.loads(line.removeprefix("OFFLAB_RESULT="))
    raise RuntimeError("worker completed without a result")


class Kubernetes:
    def __init__(self, config):
        import requests
        import yaml
        self.config = config
        source = yaml.safe_load(Path(config["kubeconfig"]).read_text())
        context = next(x["context"] for x in source["contexts"] if x["name"] == source["current-context"])
        cluster = next(x["cluster"] for x in source["clusters"] if x["name"] == context["cluster"])
        user = next(x["user"] for x in source["users"] if x["name"] == context["user"])
        self.base = cluster["server"].rstrip("/")
        self.session = requests.Session()
        self.temp = tempfile.TemporaryDirectory()

        def material(key, owner):
            if key + "-data" in owner:
                path = Path(self.temp.name) / key
                path.write_bytes(base64.b64decode(owner[key + "-data"]))
                return str(path)
            return owner.get(key)

        self.session.verify = material("certificate-authority", cluster) or True
        if user.get("token"):
            self.session.headers["Authorization"] = "Bearer " + user["token"]
        else:
            self.session.cert = (material("client-certificate", user), material("client-key", user))
        self.ns = config["namespace"]

    def call(self, method, path, data=None, text=False):
        response = self.session.request(method, self.base + path, json=data, timeout=30)
        response.raise_for_status()
        return response.text if text else response.json()

    def run(self, task, input_url, output_url, started):
        name = "oil-" + task["id"].replace("_", "-").lower()
        labels = {"cea.offload-lab": "true", "cea.offload-run": task["runId"]}
        spec = {"apiVersion": "batch/v1", "kind": "Job", "metadata": {"name": name, "labels": labels},
                "spec": {"backoffLimit": 0, "activeDeadlineSeconds": self.config["taskTimeoutSeconds"],
                         "template": {"metadata": {"labels": labels}, "spec": {
                             "restartPolicy": "Never", "automountServiceAccountToken": False,
                             "containers": [{"name": "work", "image": self.config["image"], "imagePullPolicy": "IfNotPresent",
                                             "env": [{"name": "INPUT_URL", "value": input_url}, {"name": "OUTPUT_URL", "value": output_url},
                                                     {"name": "TERMINATION_MESSAGE_PATH", "value": "/dev/termination-log"}],
                                             "resources": {"requests": {"cpu": str(self.config["cpuPerJob"]), "memory": "64Mi"},
                                                           "limits": {"cpu": str(self.config["cpuPerJob"]), "memory": self.config["memory"]}},
                                             "securityContext": {"allowPrivilegeEscalation": False, "capabilities": {"drop": ["ALL"]}}}]
                         }}}}
        base = f"/apis/batch/v1/namespaces/{self.ns}/jobs"
        self.call("POST", base, spec)
        started({"jobName": name, "submittedAt": time.time()})
        deadline = time.monotonic() + self.config["taskTimeoutSeconds"] + 60
        while time.monotonic() < deadline:
            status = self.call("GET", base + "/" + name).get("status", {})
            if status.get("failed") or status.get("succeeded"):
                pods = self.call("GET", f"/api/v1/namespaces/{self.ns}/pods?labelSelector=job-name%3D{name}")["items"]
                terminated = next((c.get("state", {}).get("terminated", {}) for p in pods for c in p.get("status", {}).get("containerStatuses", []) if c["name"] == "work"), {})
                if status.get("failed"):
                    raise RuntimeError("Job failed: " + str(terminated.get("reason", "unknown")) + ": " + terminated.get("message", "")[-400:])
                if not terminated.get("message"):
                    raise RuntimeError("Job completed without a result summary in Pod status")
                return json.loads(terminated["message"])
            time.sleep(1)
        raise TimeoutError("Job observation deadline exceeded")

    def cleanup(self, run):
        base = f"/apis/batch/v1/namespaces/{self.ns}/jobs"
        jobs = self.call("GET", base + "?labelSelector=cea.offload-run%3D" + run)["items"]
        for job in jobs:
            if job["metadata"].get("labels", {}).get("cea.offload-lab") != "true":
                raise RuntimeError("unexpected Job owner")
            if not any(c.get("type") in ("Complete", "Failed") and c.get("status") == "True" for c in job.get("status", {}).get("conditions", [])):
                raise RuntimeError("Job has not reached a terminal condition; retain its files")
            self.call("DELETE", base + "/" + job["metadata"]["name"], {"propagationPolicy": "Foreground"})
        return len(jobs)


class Docker:
    def __init__(self, config):
        import docker
        self.client, self.config = docker.from_env(), config

    def run(self, task, started):
        folder = Path(self.config["work"]) / task["runId"] / task["id"]
        folder.mkdir(parents=True, exist_ok=True)
        folder.chmod(0o777)
        container = self.client.containers.run(self.config["image"], detach=True,
            name="oil-" + task["id"], labels={"cea.offload-lab": "true", "cea.offload-run": task["runId"], "cea.offload-terminal": self.config["id"]},
            cgroup_parent=self.config["cgroupParent"], network_mode="none", read_only=True,
            cap_drop=["ALL"], security_opt=["no-new-privileges"], mem_limit=self.config["memory"],
            volumes={self.config["files"][task["size"]]["hostPath"]: {"bind": "/input", "mode": "ro"},
                     str(folder): {"bind": "/work", "mode": "rw"}},
            environment={"INPUT_FILE": "/input"}, tmpfs={"/tmp": "size=8m"})
        started({"containerId": container.id, "submittedAt": time.time()})
        try:
            status = container.wait(timeout=self.config["taskTimeoutSeconds"])
        except Exception:
            container.stop(timeout=5)
            raise
        logs = container.logs().decode()
        if status["StatusCode"]:
            raise RuntimeError("container failed: " + logs[-400:])
        return result_from_logs(logs)

    def cleanup(self, run):
        import shutil
        containers = self.client.containers.list(all=True, filters={"label": ["cea.offload-lab=true", "cea.offload-run=" + run, "cea.offload-terminal=" + self.config["id"]]})
        for container in containers:
            container.reload()
            if container.status == "running":
                raise RuntimeError("cannot clean a running task")
            container.remove()
        # Run IDs come from controller; still validate this destructive target remains below work.
        root = Path(self.config["work"]).resolve()
        folder = (root / run).resolve()
        if folder.parent != root:
            raise ValueError("invalid experiment path")
        if folder.exists():
            shutil.rmtree(folder)
        return len(containers)
