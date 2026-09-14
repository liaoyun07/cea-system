"""Pod-local artifact transport. No workflow engine, S3 credentials or algorithm SDK."""
import http.client
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path("/cea-work")
PLAN = Path("/cea-files/plan.json")
REPORT = Path("/dev/termination-log")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())


def filename(name):
    if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+", name) or name in (".", ".."):
        raise ValueError("invalid filename")
    return name


def plan():
    # Read the projected volume anew: a Worker takeover can refresh expired grants.
    return json.loads(PLAN.read_text(encoding="utf-8"))


def open_output(name):
    directory = os.open(ROOT / "out", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fd = os.open(filename(name), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            os.close(fd)
            raise ValueError("output must be a regular file")
        return os.fdopen(fd, "rb")
    finally:
        os.close(directory)


def transfer(phase, name):
    filename(name)
    started = time.perf_counter_ns()
    deadline = time.monotonic() + 300
    delay = 1
    while True:
        try:
            url = plan()[phase][name]
            if phase == "inputs":
                with tempfile.NamedTemporaryFile(dir=ROOT, prefix=".input-", delete=False) as output:
                    partial = Path(output.name)
                    try:
                        with HTTP.open(url, timeout=30) as response:
                            shutil.copyfileobj(response, output, 1024 * 1024)
                            size = response.headers.get("Content-Length")
                            if size is not None and output.tell() != int(size):
                                raise http.client.IncompleteRead(b"")
                        output.close()
                        partial.chmod(0o644)
                        partial.replace(ROOT / "in" / name)
                    finally:
                        partial.unlink(missing_ok=True)
            else:
                with open_output(name) as source:
                    size = os.fstat(source.fileno()).st_size
                    request = urllib.request.Request(url, data=source, method="PUT", headers={"Content-Length": str(size)})
                    with HTTP.open(request, timeout=30) as response:
                        if response.status not in (200, 201, 204):
                            raise ValueError("unexpected upload response")
            if phase == "inputs":
                return {"name": name, "bytes": (ROOT / "in" / name).stat().st_size,
                        "seconds": (time.perf_counter_ns() - started) / 1e9}
            return None
        except urllib.error.HTTPError as error:
            if error.code not in (403, 408, 429, 500, 502, 503, 504):
                raise
        except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.IncompleteRead):
            pass
        if time.monotonic() >= deadline:
            raise TimeoutError("file transfer retry budget exhausted")
        time.sleep(delay)
        delay = min(delay * 2, 10)


def run(phase):
    if phase == "input":
        ROOT.mkdir(parents=True, exist_ok=True)
        ROOT.chmod(0o777)
        for directory in (ROOT / "in", ROOT / "out"):
            directory.mkdir(parents=True, exist_ok=True)
            directory.chmod(0o777)
        data = plan()
        for name, content in data["inline"].items():
            (ROOT / "in" / filename(name)).write_text(content, encoding="utf-8")
        measured = [transfer("inputs", name) for name in data["inputs"]]
        if data.get("measureInputs") is True and len(measured) == 1:
            REPORT.write_text(json.dumps({"transfers": measured}, allow_nan=False), encoding="utf-8")
        (ROOT / "start").touch()
    elif phase == "output":
        while not (ROOT / "exit").exists():
            time.sleep(0.2)
        try:
            with (ROOT / "exit").open("rb") as marker:
                code = marker.read(16).strip()
            if code == b"0":
                for name in plan()["outputs"]:
                    transfer("outputs", name)
        finally:
            # The main wrapper exits with the algorithm code. Helper failure still fails the Job.
            (ROOT / "published").touch()
    else:
        raise ValueError("unknown phase")


if __name__ == "__main__":
    try:
        run(sys.argv[1])
    except Exception as error:
        # Never log presigned URLs or exception messages that can contain credentials.
        message = "file helper failed: " + type(error).__name__
        if isinstance(error, urllib.error.HTTPError):
            message += " HTTP " + str(error.code)
        print(message, file=sys.stderr)
        sys.exit(1)
