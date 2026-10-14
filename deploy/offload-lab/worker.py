"""Identical computation on terminal and k3s. Results stay at their execution site."""
import json
import os
from pathlib import Path
import resource
import shutil
import time
import urllib.request
from app import features

if __name__ == "__main__":
    started = time.time()
    source = Path(os.environ.get("INPUT_FILE", "/work/input"))
    if os.environ.get("INPUT_URL"):
        with urllib.request.urlopen(os.environ["INPUT_URL"], timeout=120) as response, source.open("wb") as stream:
            shutil.copyfileobj(response, stream, 1024 * 1024)
    read_at, cpu = time.time(), time.process_time()
    with source.open("rb") as stream:
        result = features(stream)
    computed = time.time()
    result["measurement"] = {"workerStartedAt": started, "computeStartedAt": read_at, "computeFinishedAt": computed,
                             "cpuSeconds": time.process_time() - cpu,
                             "maxRssKiB": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                             "inputBytes": source.stat().st_size}
    raw = json.dumps(result, allow_nan=False).encode()
    output = Path(os.environ.get("OUTPUT_FILE", "/work/result.json"))
    output.write_bytes(raw)
    if os.environ.get("OUTPUT_URL"):
        request = urllib.request.Request(os.environ["OUTPUT_URL"], data=raw, method="PUT")
        with urllib.request.urlopen(request, timeout=120) as response:
            response.read()
    result["measurement"]["finishedAt"] = time.time()
    if os.environ.get("TERMINATION_MESSAGE_PATH"):
        Path(os.environ["TERMINATION_MESSAGE_PATH"]).write_text(json.dumps(result, allow_nan=False))
    print("OFFLAB_RESULT=" + json.dumps(result, allow_nan=False), flush=True)
