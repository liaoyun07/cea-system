"""Independently verify nine outputs, actual uploaded bytes and absence of local uploads."""
import json
import math
import os
from pathlib import Path
import boto3

root = Path("/sim")
folder = root / "matrix"
stores = {bucket: boto3.client("s3", endpoint_url=endpoint, region_name="us-east-1",
          aws_access_key_id=os.environ["MINIO_ROOT_USER"], aws_secret_access_key=os.environ["MINIO_ROOT_PASSWORD"])
          for bucket, endpoint in {"cea-artifacts": "http://minio:9000", "cea-artifacts-edge-a": "http://minio-edge-a:9000"}.items()}
evidence = []
for file in json.loads((folder/"files.json").read_text()):
    for layer in ("terminal", "edge", "cloud"):
        record = json.loads((folder/f"execution-{file['mb']}-{layer}.json").read_text())
        execution = record["execution"]
        bucket, key = execution["outputs"]["terminal_result"].removeprefix("s3://").split("/",1)
        output = json.loads(stores[bucket].get_object(Bucket=bucket,Key=key)["Body"].read())
        for field, value in file["expected"].items():
            assert math.isclose(output[field],value,rel_tol=0,abs_tol=1e-10), field
        assert output["measurement"]["inputBytes"] == file["bytes"]
        prefix=f"lab/ingress/sim-terminal-001/offload/{execution['id']}/"
        uploads=stores["cea-artifacts-edge-a"].list_objects_v2(Bucket="cea-artifacts-edge-a",Prefix=prefix).get("Contents",[])
        assert not stores["cea-artifacts"].list_objects_v2(Bucket="cea-artifacts",Prefix=prefix).get("Contents",[])
        if layer == "terminal":
            assert not uploads
        else:
            assert len(uploads)==1 and uploads[0]["Size"]==file["bytes"]
            with (root/"data"/file["fileId"]).open("rb") as source:
                remote=stores["cea-artifacts-edge-a"].get_object(Bucket="cea-artifacts-edge-a",Key=uploads[0]["Key"])["Body"]
                while block := source.read(1024*1024):
                    assert remote.read(len(block)) == block
                assert remote.read(1)==b""
                remote.close()
        evidence.append({"executionId":execution["id"],"mb":file["mb"],"layer":layer,"uploadedBytes":sum(o["Size"] for o in uploads),"resultVerified":True})
report={"result":"PASS","cases":evidence}
(folder/"audit.json").write_text(json.dumps(report,indent=2))
print(json.dumps(report))
