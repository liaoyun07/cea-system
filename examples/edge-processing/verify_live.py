"""Read-only evidence plus rejected/replayed requests; run after three real terminal runs."""
import base64
import json
import urllib.error
import urllib.request
from pathlib import Path

import boto3

from terminal import request


root = Path("/data")
config = json.loads(Path("/run/edge/gateway.json").read_text())
terminal = json.loads(Path("/run/edge/terminal.json").read_text())
settings = dict(line.split("=", 1) for line in Path("/run/cea.env").read_text().splitlines() if "=" in line and not line.startswith("#"))
auth = base64.b64encode((settings["BACKEND_USER"] + ":" + settings["BACKEND_PASSWORD"]).encode()).decode()


def api(path):
    req = urllib.request.Request("http://backend:18085/api/namespaces/lab/" + path, headers={"Authorization": "Basic " + auth})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


def client(host):
    return boto3.client("s3", endpoint_url=f"http://{host}:9000", region_name="us-east-1",
        aws_access_key_id=settings["CEA_S3_ACCESS_KEY"], aws_secret_access_key=settings["CEA_S3_SECRET_KEY"])


edge, center = client("minio-edge-a"), client("minio")
receipts = [json.loads(p.read_text()) for p in (root / "evidence").glob("*.json")]
receipts = [r for r in receipts if "uploadId" in r]
assert len(receipts) == 3, "expected exactly three accepted replay receipts for this validation"
evidence = []
for receipt in receipts:
    execution_id = receipt["executionId"]
    execution = api("executions/" + execution_id)
    assert execution["state"] == "SUCCESS"
    source_key = f'lab/ingress/ep01-terminal/{receipt["uploadId"]}/data'
    obj = edge.get_object(Bucket=config["bucket"], Key=source_key)
    with obj["Body"] as body:
        actual = body.read()
    original = (root / "terminal" / receipt["file"]).read_bytes()
    assert actual == original, "terminal bytes were not transported intact"
    assert not center.list_objects_v2(Bucket="cea-artifacts", Prefix=source_key).get("Contents"), "raw upload unexpectedly centralized"
    assert request(terminal, "POST", "/v1/events", {"eventType": receipt["eventType"], "uploadId": receipt["uploadId"]})["executionId"] == execution_id
    changed_event = next(event for event in config["events"] if event != receipt["eventType"])
    try:
        request(terminal, "POST", "/v1/events", {"eventType": changed_event, "uploadId": receipt["uploadId"]})
        raise AssertionError("changed event reused an accepted key")
    except RuntimeError as error:
        assert "409" in str(error), error
    other = {"gateway": terminal["gateway"], "token": config["terminals"]["ep01-other"]}
    for path, body, status in (("/v1/events", {"eventType": receipt["eventType"], "uploadId": receipt["uploadId"]}, 404),
                              ("/v1/executions/" + execution_id, None, 404)):
        try:
            request(other, "POST" if body else "GET", path, body)
            raise AssertionError("cross-terminal access accepted")
        except RuntimeError as error:
            assert str(status) in str(error), error
    files = []
    for task in api(f"executions/{execution_id}/tasks"):
        for name, uri in task["outputs"].items():
            if not isinstance(uri, str) or not uri.startswith("s3://"):
                continue
            bucket, key = uri[5:].split("/", 1)
            expected = "cea-artifacts" if task["taskId"] == "report" else config["bucket"]
            assert bucket == expected, f"wrong physical destination {uri}"
            s3 = center if bucket == "cea-artifacts" else edge
            response = s3.get_object(Bucket=bucket, Key=key)
            directory = root / "evidence" / execution_id / task["taskId"]
            directory.mkdir(parents=True, exist_ok=True)
            with response["Body"] as stream:
                content = stream.read()
            (directory / name).write_bytes(content)
            files.append({"task": task["taskId"], "name": name, "uri": uri, "bytes": len(content)})
        if task["taskId"] != "report":
            assert not center.list_objects_v2(Bucket="cea-artifacts", Prefix=f'lab/{execution_id}/{task["id"]}/').get("Contents")
    evidence.append({"executionId": execution_id, "flowId": execution["flowId"], "input_bytes": len(actual),
        "files": files, "status": "PASS"})
write = root / "evidence/live-check.json"
write.write_text(json.dumps(evidence, indent=2))
print(json.dumps(evidence, indent=2))
