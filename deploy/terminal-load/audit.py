"""Read-only verification of actual outputs and LOCAL versus offloaded raw-file transfer."""
import base64
import json
import math
import os
from pathlib import Path
import urllib.request
import boto3

root = Path("/evidence")
view = json.loads((root / "test-result.json").read_text())
token = base64.b64encode((os.environ["BACKEND_USER"] + ":" + os.environ["BACKEND_PASSWORD"]).encode()).decode()
def api(path):
    request = urllib.request.Request("http://backend:18085/api/namespaces/lab" + path, headers={"Authorization": "Basic " + token})
    with urllib.request.urlopen(request) as reply:
        return json.load(reply)

stores = {bucket: boto3.client("s3", endpoint_url=endpoint, region_name="us-east-1", aws_access_key_id=os.environ["MINIO_ROOT_USER"], aws_secret_access_key=os.environ["MINIO_ROOT_PASSWORD"])
          for bucket, endpoint in {"cea-artifacts": "http://minio:9000", "cea-artifacts-edge-a": "http://minio-edge-a:9000"}.items()}
files = json.loads((root / "files.json").read_text())
reference = {}
for descriptor in files.values():
    raw = (root / "data" / descriptor["fileId"]).read_bytes()
    values = list(map(float, raw.splitlines()))
    reference[descriptor["fileId"]] = (raw, {"samples": len(values), "mean": math.fsum(values)/len(values),
        "rms": math.sqrt(math.fsum(x*x for x in values)/len(values)), "peak": max(map(abs,values)),
        "windows": math.ceil(len(values)/1024), "alert_windows": sum(any(abs(x)>4 for x in values[i:i+1024]) for i in range(0,len(values),1024))})
targets = {t["executionId"]: t["target"]["kind"] for t in view["targets"]}
requests = [r for r in view["data"]["requests"] if r["executionId"]]
# Calibration establishes all three real execution paths even if the unchanged model chooses only some layers in this load.
for receipt in root.glob("state/*/calibration/fixed-v1/*.json"):
    saved = json.loads(receipt.read_text())
    requests.append({"executionId": saved["executionId"], "terminalId": receipt.parts[-4]})
    targets[saved["executionId"]] = "EDGE" if "edge" in saved["eventType"] else "CLOUD"
evidence = []
for request in requests:
    execution = request["executionId"]
    state = api("/executions/" + execution)
    assert state["state"] == "SUCCESS"
    original, expected = reference[state["inputs"]["data_file"]["fileId"]]
    prefix = f'lab/ingress/{request["terminalId"]}/offload/{execution}/'
    uploads = stores["cea-artifacts-edge-a"].list_objects_v2(Bucket="cea-artifacts-edge-a", Prefix=prefix).get("Contents", [])
    assert not stores["cea-artifacts"].list_objects_v2(Bucket="cea-artifacts", Prefix=prefix).get("Contents", [])
    if targets[execution] == "TERMINAL":
        assert not uploads, "local computation must not upload raw input"
    else:
        assert len(uploads) == 1 and uploads[0]["Size"] == len(original)
        assert stores["cea-artifacts-edge-a"].get_object(Bucket="cea-artifacts-edge-a", Key=uploads[0]["Key"])["Body"].read() == original
    bucket, key = state["outputs"]["terminal_result"].removeprefix("s3://").split("/", 1)
    output = json.loads(stores[bucket].get_object(Bucket=bucket, Key=key)["Body"].read())
    for field, value in expected.items():
        assert math.isclose(output[field],value,rel_tol=0,abs_tol=1e-10), field
    tasks = api(f"/executions/{execution}/tasks")
    assert len(tasks) == 1 and tasks[0]["state"] == "SUCCESS"
    evidence.append({"executionId": execution, "terminalId": request["terminalId"], "taskRunId": tasks[0]["id"], "target": targets[execution], "uploadedBytes": sum(o["Size"] for o in uploads), "result": output})
report = {"result": "PASS", "runId": view["data"]["run"]["id"], "verifiedExecutions": len(evidence), "paths": evidence}
(root / "output-audit.json").write_text(json.dumps(report,indent=2))
print(json.dumps({key:report[key] for key in ("result","runId","verifiedExecutions")}))
