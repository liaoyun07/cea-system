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
    resumed = receipt.exists()
    if resumed:
        saved = json.loads(receipt.read_text())
        if saved["eventType"] != event or saved["file"] != descriptor:
            raise ValueError("receipt belongs to a different request")
    else:
        saved = {"requestId": str(uuid.uuid4()), "eventType": event, "file": descriptor}
        # Persist BEFORE sending. A lost reply must never cause a new request identity.
        with receipt.open("x") as target:
            json.dump(saved, target)
    if "feedback" in saved:
        send_feedback(config, saved, receipt)
        if "response" in saved:
            if saved["response"]["state"] != "SUCCESS":
                raise RuntimeError("compute failed: " + saved["response"]["state"])
            return saved["response"]
        raise TimeoutError("request already timed out; original feedback retained")
    started = time.perf_counter_ns()
    accepted = request(config, "/v1/compute", {key: saved[key] for key in ("requestId", "eventType", "file")})
    saved.update(accepted)
    receipt.write_text(json.dumps(saved, indent=2))
    deadline = time.monotonic() + 240
    while time.monotonic() < deadline:
        result = request(config, "/v1/executions/" + saved["executionId"])
        if result["state"] in ("SUCCESS", "FAILED", "KILLED"):
            elapsed = (time.perf_counter_ns() - started) / 1e9
            saved["response"] = result
            outcome = {"SUCCESS": "SUCCESS", "FAILED": "FAILED", "KILLED": "CANCELLED"}[result["state"]]
            saved["feedback"] = {"outcome": "UNMEASURED" if resumed else outcome,
                                 "elapsedSeconds": None if resumed else elapsed}
            receipt.write_text(json.dumps(saved, indent=2))
            send_feedback(config, saved, receipt)
            if result["state"] != "SUCCESS":
                raise RuntimeError("compute failed: " + result["state"])
            return result
        time.sleep(0.5)
    if not resumed:
        saved["feedback"] = {"outcome": "TIMEOUT", "elapsedSeconds": (time.perf_counter_ns() - started) / 1e9}
        receipt.write_text(json.dumps(saved, indent=2))
        send_feedback(config, saved, receipt)
    raise TimeoutError("result not complete; retain receipt and query the same execution")


def send_feedback(config, saved, receipt):
    # Persisted once before POST: retries must not replace original elapsed time with a new clock.
    try:
        request(config, "/v1/executions/" + saved["executionId"] + "/feedback", saved["feedback"])
        saved["feedbackAccepted"] = True
        saved.pop("feedbackError", None)
    except Exception as error:
        # Measurement failure does not change an algorithm's successful result.
        saved["feedbackAccepted"] = False
        saved["feedbackError"] = type(error).__name__
    receipt.write_text(json.dumps(saved, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="/run/secrets/terminal.json")
    parser.add_argument("--event", required=True)
    parser.add_argument("--file", required=True)
    parser.add_argument("--receipt", required=True)
    args = parser.parse_args()
    print(json.dumps(run(json.loads(Path(args.config).read_text()), args.event, args.file, args.receipt)))
