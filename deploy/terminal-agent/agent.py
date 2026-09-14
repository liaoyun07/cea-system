"""Terminal Docker effects only. Workflow state, retries and placement remain in CEA."""
import fcntl
import hmac
import json
import os
from pathlib import Path
import re
import shutil
import threading
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import docker
from docker.errors import NotFound

UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
ATTEMPT = r"cea-" + UUID + r"-a[1-9][0-9]*"
NAME = r"[A-Za-z0-9][A-Za-z0-9_.-]{0,99}"
MAX_FILE = 64 * 1024 * 1024
MAX_JSON = 262144


class Rejected(Exception):
    def __init__(self, message, status=422):
        self.message, self.status = message, status


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Agent:
    def __init__(self, config):
        self.config = config
        self.data = Path(config.get("dataDirectory", "/data")).resolve()
        self.work = Path(config.get("workDirectory", "/terminal-work")).resolve()
        self.state = Path(config.get("stateDirectory", "/state")).resolve()
        self.work.mkdir(parents=True, exist_ok=True)
        self.state.mkdir(parents=True, exist_ok=True)
        self.engine = docker.DockerClient(base_url=config["dockerHost"], timeout=60)
        self.http = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def local_file(self, value):
        if (not isinstance(value, dict) or set(value) != {"fileId", "bytes"} or
            not isinstance(value["fileId"], str) or not re.fullmatch(UUID, value["fileId"]) or
            type(value["bytes"]) is not int or not 0 < value["bytes"] <= MAX_FILE):
            raise Rejected("fileId and bytes 1..64MiB required")
        path = self.data / value["fileId"]
        if path.is_symlink() or not path.is_file() or path.stat().st_size != value["bytes"]:
            raise Rejected("terminal file missing or size changed")
        return path

    def grant(self, url, method, raw=None, limit=MAX_FILE):
        parsed = urllib.parse.urlsplit(url)
        if (parsed.scheme not in ("http", "https") or parsed.username or parsed.fragment or
            parsed.netloc not in self.config["storageHosts"]):
            raise Rejected("storage grant destination not allowed")
        request = urllib.request.Request(url, method=method, data=raw)
        with self.http.open(request, timeout=30) as response:
            result = response.read(limit + 1)
            if len(result) > limit:
                raise Rejected("input exceeds limit")
            return result

    def directory(self, name):
        if not isinstance(name, str) or not re.fullmatch(ATTEMPT, name):
            raise Rejected("invalid attempt name")
        folder = self.state / name
        folder.mkdir(exist_ok=True)
        return folder

    def container(self, name):
        try:
            result = self.engine.containers.get(name)
        except NotFound:
            return None
        if result.labels.get("com.project.cea.attempt") != name:
            raise Rejected("container ownership mismatch", 409)
        return result

    def cancel(self, name):
        folder = self.directory(name)
        # Fence delayed create/step, even if an earlier preparation is still in progress.
        (folder / "cancelled").touch(exist_ok=True)
        with (folder / "lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            container = self.container(name)
            if container and container.status in ("running", "restarting", "paused"):
                container.stop(timeout=5)
                container.reload()
            if container and container.status not in ("created", "exited", "dead"):
                raise RuntimeError("container stop unconfirmed")
        return {"state": "CANCELLED"}

    def step(self, request):
        if set(request) != {"name", "spec", "localFiles", "grants"}:
            raise Rejected("invalid attempt request")
        name, spec, local, grants = (request[k] for k in ("name", "spec", "localFiles", "grants"))
        folder = self.directory(name)
        image = spec["image"]
        if ("@sha256:" not in image or image.split("/", 1)[0] not in self.config["registryHosts"] or
            not spec["command"] or len(spec["command"]) > 100 or
            len(spec["inputs"]) > 1000 or len(spec["outputs"]) > 30):
            raise Rejected("invalid image or command/files")
        for value in spec["inputs"] + spec["outputs"]:
            if not re.fullmatch(NAME, value):
                raise Rejected("invalid named file")
        if any(not key.endswith(".json") for key in spec["outputs"]):
            raise Rejected("gateway terminal execution currently publishes JSON files only")
        if set(spec["inputs"]) != set(local) | set(grants["inputs"]) | set(grants["inline"]):
            raise Rejected("file plan mismatch")
        if set(spec["outputs"]) != set(grants["outputs"]):
            raise Rejected("output plan mismatch")
        # Compare stable plan, not expiring signed credentials. This is protocol equality, not a new checksum.
        stable = {"spec": spec, "localFiles": local}
        with (folder / "lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            if (folder / "cancelled").exists():
                return {"state": "CANCELLED"}
            plan = folder / "plan.json"
            if plan.exists():
                if json.loads(plan.read_text()) != stable:
                    raise Rejected("attempt plan changed", 409)
            else:
                temp = folder / "plan.tmp"
                temp.write_text(json.dumps(stable))
                temp.replace(plan)
            container = self.container(name)
            if container is None:
                stage = self.work / name
                (stage / "in").mkdir(parents=True, exist_ok=True)
                (stage / "out").mkdir(exist_ok=True)
                (stage / "out").chmod(0o777)
                for key in spec["inputs"]:
                    target = stage / "in" / key
                    if key in local:
                        shutil.copyfile(self.local_file(local[key]), target)
                    elif key in grants["inline"]:
                        target.write_text(grants["inline"][key])
                    else:
                        target.write_bytes(self.grant(grants["inputs"][key], "GET"))
                    target.chmod(0o444)
                registry = image.split("/", 1)[0]
                try:
                    self.engine.images.get(image)
                except NotFound:
                    self.engine.images.pull(image, auth_config=self.config.get("registryAuth", {}).get(registry))
                if (folder / "cancelled").exists():
                    return {"state": "CANCELLED"}
                container = self.engine.containers.create(image, entrypoint=spec["command"], command=[],
                    environment=spec["environment"], name=name, labels={"com.project.cea.attempt": name},
                    working_dir="/cea-work", network_mode="none", read_only=True,
                    cap_drop=["ALL"], security_opt=["no-new-privileges"], mem_limit="512m", nano_cpus=1000000000,
                    pids_limit=128, tmpfs={"/tmp": "size=64m,mode=1777"},
                    volumes={str(stage / "in"): {"bind": "/cea-work/in", "mode": "ro"},
                             str(stage / "out"): {"bind": "/cea-work/out", "mode": "rw"}})
            if (folder / "cancelled").exists():
                # cancel() will confirm the stopped effect after acquiring this lock.
                return {"state": "RUNNING"}
            if container.status == "created":
                container.start()
                return {"state": "RUNNING"}
            container.reload()
            if container.status in ("running", "restarting"):
                return {"state": "RUNNING"}
            if container.status != "exited":
                raise RuntimeError("unknown Docker effect")
            code = container.attrs["State"]["ExitCode"]
            if code != 0:
                return {"state": "FAILED", "error": "terminal command exited with code " + str(code)}
            for key in spec["outputs"]:
                output = self.work / name / "out" / key
                if output.is_symlink() or not output.is_file() or output.stat().st_size > MAX_JSON:
                    return {"state": "FAILED", "error": "missing or oversized terminal JSON output"}
                raw = output.read_bytes()
                try:
                    if not isinstance(json.loads(raw), dict):
                        raise ValueError()
                except ValueError:
                    return {"state": "FAILED", "error": "invalid terminal JSON output"}
                self.grant(grants["outputs"][key], "PUT", raw, limit=MAX_JSON)
            return {"state": "SUCCESS"}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def reply(self, status, value):
        raw = json.dumps(value, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(raw)
        self.close_connection = True

    def do_GET(self):
        if self.path == "/health":
            return self.reply(200, {"status": "UP"})
        return self.reply(404, {"error": "route not found"})

    def do_POST(self):
        try:
            self.connection.settimeout(90)
            agent = self.server.agent
            if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + agent.config["token"]):
                raise Rejected("unauthorized", 401)
            if self.headers.get("Transfer-Encoding") or len(self.headers.get_all("Content-Length", [])) != 1:
                raise Rejected("single content length required", 411)
            length = int(self.headers["Content-Length"])
            if not 0 < length <= 1048576:
                raise Rejected("request too large", 413)
            body = json.loads(self.rfile.read(length))
            if self.path == "/files/check":
                agent.local_file(body)
                return self.reply(200, body)
            if self.path == "/files/read":
                path = agent.local_file(body)
                self.send_response(200)
                self.send_header("Content-Length", str(body["bytes"]))
                self.send_header("Connection", "close")
                self.end_headers()
                with path.open("rb") as source:
                    shutil.copyfileobj(source, self.wfile, length=1024 * 1024)
                self.close_connection = True
                return
            if self.path == "/attempts/step":
                return self.reply(200, agent.step(body))
            if self.path == "/attempts/cancel":
                return self.reply(200, agent.cancel(body["name"]))
            if self.path == "/available":
                return self.reply(200, {"available": bool(agent.engine.ping())})
            raise Rejected("route not found", 404)
        except Rejected as error:
            self.reply(error.status, {"error": error.message})
        except (ValueError, TypeError, KeyError):
            self.reply(400, {"error": "invalid request"})
        except Exception:
            self.reply(502, {"error": "terminal effect unconfirmed"})


if __name__ == "__main__":
    with open(os.environ.get("AGENT_CONFIG", "/run/secrets/agent.json")) as file:
        server = ThreadingHTTPServer(("0.0.0.0", 8080), Handler)
        server.agent = Agent(json.load(file))
    server.serve_forever()
