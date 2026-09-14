"""Connected terminal compute request: metadata first, never POST the raw file here."""
import argparse
import json
from pathlib import Path
import time
import urllib.request
import uuid


def request(config, path, body=None):
    headers = {"Authorization": "Bearer " + config["token"], "Content-Type": "application/json"}
    req = urllib.request.Request(config["gateway"] + path, headers=headers,
        data=None if body is None else json.dumps(body).encode())
    with urllib.request.urlopen(req, timeout=100) as response:
        return json.load(response)


def run(config, event, file, receipt):
    file = Path(file)
    descriptor = {"fileId": file.name, "bytes": file.stat().st_size}
    uuid.UUID(file.name, version=4)
    receipt = Path(receipt)
    receipt.parent.mkdir(parents=True, exist_ok=True)
    if receipt.exists():
        saved = json.loads(receipt.read_text())
        if saved["eventType"] != event or saved["file"] != descriptor:
            raise ValueError("receipt belongs to a different request")
    else:
        saved = {"requestId": str(uuid.uuid4()), "eventType": event, "file": descriptor}
        # Persist BEFORE sending. A lost reply must never cause a new request identity.
        with receipt.open("x") as target:
            json.dump(saved, target)
    accepted = request(config, "/v1/compute", {key: saved[key] for key in ("requestId", "eventType", "file")})
    saved.update(accepted)
    receipt.write_text(json.dumps(saved, indent=2))
    deadline = time.monotonic() + 240
    while time.monotonic() < deadline:
        result = request(config, "/v1/executions/" + saved["executionId"])
        if result["state"] in ("SUCCESS", "FAILED", "KILLED"):
            saved["response"] = result
            receipt.write_text(json.dumps(saved, indent=2))
            if result["state"] != "SUCCESS":
                raise RuntimeError("compute failed: " + result["state"])
            return result
        time.sleep(0.5)
    raise TimeoutError("result not complete; retain receipt and query the same execution")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="/run/secrets/terminal.json")
    parser.add_argument("--event", required=True)
    parser.add_argument("--file", required=True)
    parser.add_argument("--receipt", required=True)
    args = parser.parse_args()
    print(json.dumps(run(json.loads(Path(args.config).read_text()), args.event, args.file, args.receipt)))
