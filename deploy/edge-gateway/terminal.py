"""Sensor/file replay only. It has a terminal token, never platform/S3 credentials."""
import argparse
import http.client
import json
import time
import urllib.parse
import uuid
from pathlib import Path


def request(config, method, path, data=None):
    target = urllib.parse.urlsplit(config["gateway"])
    connection = http.client.HTTPConnection(target.hostname, target.port, timeout=120)
    headers = {"Authorization": "Bearer " + config["token"]}
    try:
        if isinstance(data, Path):
            with data.open("rb") as source:
                headers["Content-Length"] = str(data.stat().st_size)
                headers["Content-Type"] = "application/octet-stream"
                connection.request(method, path, source, headers)
        else:
            raw = json.dumps(data).encode() if data is not None else None
            headers["Content-Type"] = "application/json"
            connection.request(method, path, raw, headers)
        response = connection.getresponse()
        value = json.loads(response.read())
        if response.status >= 400:
            raise RuntimeError(f'HTTP {response.status}: {value}')
        return value
    finally:
        connection.close()


def run(config, event, file, evidence):
    evidence.mkdir(parents=True, exist_ok=True)
    pending = evidence / ("pending-" + str(uuid.uuid4()) + ".json")
    receipt = {"file": file.name, "eventType": event}
    pending.write_text(json.dumps(receipt, indent=2))  # Verify receipt persistence before network side effects.
    upload = request(config, "POST", "/v1/uploads", file)
    receipt.update(upload)
    pending.write_text(json.dumps(receipt, indent=2))
    accepted = request(config, "POST", "/v1/events", {"eventType": event, "uploadId": upload["uploadId"]})
    receipt.update(accepted)
    record = evidence / (accepted["executionId"] + ".json")
    pending.write_text(json.dumps(receipt, indent=2))
    pending.replace(record)
    print(json.dumps(receipt), flush=True)
    for _ in range(300):
        value = request(config, "GET", "/v1/executions/" + accepted["executionId"])
        if value["state"] in ("SUCCESS", "FAILED", "KILLED", "CANCELLED"):
            receipt["response"] = value
            record.write_text(json.dumps(receipt, indent=2))
            print(json.dumps(value), flush=True)
            if value["state"] != "SUCCESS":
                raise RuntimeError("policy execution failed")
            return receipt
        time.sleep(2)
    raise TimeoutError("execution still active; receipt preserved for later query")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("event")
    parser.add_argument("file", type=Path)
    parser.add_argument("--config", default="/run/secrets/terminal.json")
    parser.add_argument("--evidence", type=Path, default=Path("/evidence"))
    args = parser.parse_args()
    run(json.loads(Path(args.config).read_text()), args.event, args.file, args.evidence)
