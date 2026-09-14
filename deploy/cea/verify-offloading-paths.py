"""Read-only CEA evidence: exact original bytes, real output objects and original submission/result links."""
import base64
import json
import math
import os
from pathlib import Path
import urllib.request

import boto3


def api(path):
    token = base64.b64encode((os.environ["BACKEND_USER"] + ":" + os.environ["BACKEND_PASSWORD"]).encode()).decode()
    request = urllib.request.Request("http://backend:18085/api/namespaces/lab" + path,
        headers={"Authorization": "Basic " + token})
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)


if __name__ == "__main__":
    root = Path("/evidence")
    manifest = json.loads((root / "signal-manifest.json").read_text())
    original = (root / "terminal" / manifest["fileId"]).read_bytes()
    assert len(original) == manifest["bytes"]
    stores = {key: boto3.client("s3", endpoint_url=endpoint, region_name="us-east-1",
        aws_access_key_id=os.environ["MINIO_ROOT_USER"], aws_secret_access_key=os.environ["MINIO_ROOT_PASSWORD"])
        for key, endpoint in {"cea-artifacts": "http://minio:9000", "cea-artifacts-edge-a": "http://minio-edge-a:9000"}.items()}
    report = []
    for action in ("terminal", "edge", "cloud", "rule"):
        receipt = json.loads((root / "receipts" / (action + ".json")).read_text())
        execution = receipt["executionId"]
        records = api("/edge/processing-records?policyId=offload-" + action + "&limit=100")
        record = next(row for row in records if row["execution"]["id"] == execution)
        assert record["origin"] == {"terminalId": "ep01-terminal", "gatewayId": "ep01-gateway", "clusterId": "edge-a"}
        assert record["execution"]["state"] == "SUCCESS"
        sample = next(row for row in api("/offloading/samples?limit=100") if row["executionId"] == execution)
        expected = "TERMINAL" if action in ("terminal", "rule") else action.upper()
        assert sample["target"]["kind"] == expected
        assert sample["inputBytes"] == len(original)
        prefix = "lab/ingress/ep01-terminal/offload/" + execution + "/"
        raw_objects = {bucket: client.list_objects_v2(Bucket=bucket, Prefix=prefix).get("Contents", []) for bucket, client in stores.items()}
        assert not raw_objects["cea-artifacts"], "no forced central copy of input"
        raw_upload = raw_objects["cea-artifacts-edge-a"]
        if expected == "TERMINAL":
            assert not raw_upload, "local raw file must not be uploaded"
        else:
            assert len(raw_upload) == 1 and raw_upload[0]["Size"] == len(original)
            obj = stores["cea-artifacts-edge-a"].get_object(Bucket="cea-artifacts-edge-a", Key=raw_upload[0]["Key"])
            with obj["Body"] as stream:
                assert stream.read() == original
        uri = record["execution"]["outputs"]["terminal_result"]
        bucket, key = uri.removeprefix("s3://").split("/", 1)
        assert bucket == ("cea-artifacts" if expected == "CLOUD" else "cea-artifacts-edge-a")
        obj = stores[bucket].get_object(Bucket=bucket, Key=key)
        with obj["Body"] as stream:
            output = json.load(stream)
        assert receipt["response"]["state"] == "SUCCESS" and receipt["response"]["result"] == output
        for field, value in manifest["expected"].items():
            assert math.isclose(output[field], value, rel_tol=0, abs_tol=1e-10), field
        tasks = api("/executions/" + execution + "/tasks")
        assert len(tasks) == 1 and tasks[0]["state"] == "SUCCESS"
        report.append({"action": action, "execution": execution, "taskRun": tasks[0]["id"], "target": sample["target"],
            "rawUploadedBytes": sum(row["Size"] for row in raw_upload), "resultBucket": bucket, "result": output})
    print(json.dumps({"result": "PASS", "paths": report}, indent=2))
