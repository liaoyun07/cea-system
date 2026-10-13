"""One original terminal request, measured until its actual final result; no DQN training feedback."""
import argparse
import datetime
import json
import math
from pathlib import Path
import time
import uuid

from compute import request
from prepare import period, reference


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True)
    parser.add_argument("--mb", type=int, required=True)
    parser.add_argument("--layer", choices=("terminal", "edge", "cloud"), required=True)
    args = parser.parse_args()
    config = json.loads(Path("/run/secrets/agent.json").read_text())
    source = Path(config["dataDirectory"]) / args.file
    assert source.stat().st_size == args.mb * 1_000_000
    folder = Path(config["stateDirectory"]) / "matrix"
    folder.mkdir(exist_ok=True)
    receipt = folder / f"{args.mb}-{args.layer}.json"
    if receipt.exists():
        raise RuntimeError("receipt already exists; inspect accepted ID, do not rerun")
    body = {"requestId": str(uuid.uuid4()), "eventType": "size-matrix-" + args.layer,
            "file": {"fileId": args.file, "bytes": source.stat().st_size}}
    saved = {**body, "startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    receipt.write_text(json.dumps(saved, indent=2))
    started = time.perf_counter()
    try:
        accepted = request(config["load"], "/v1/compute", body)
        saved.update(accepted)
        receipt.write_text(json.dumps(saved, indent=2))
        while time.perf_counter() - started < 1500:
            result = request(config["load"], "/v1/executions/" + saved["executionId"])
            if result["state"] in ("SUCCESS", "FAILED", "KILLED"):
                saved.update(response=result, elapsedSeconds=time.perf_counter()-started,
                             finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
                receipt.write_text(json.dumps(saved, indent=2))
                assert result["state"] == "SUCCESS", result["state"]
                expected = reference(period(), source.stat().st_size//10)
                for key, value in expected.items():
                    assert math.isclose(value,result["result"][key],rel_tol=0,abs_tol=1e-10), key
                saved["resultVerified"] = True
                receipt.write_text(json.dumps(saved, indent=2))
                print(json.dumps(saved), flush=True)
                break
            time.sleep(.5)
        else:
            raise TimeoutError("retain original execution ID; observer did not cancel or resubmit")
    except Exception as error:
        saved["observerError"] = str(error)
        receipt.write_text(json.dumps(saved, indent=2))
        raise
