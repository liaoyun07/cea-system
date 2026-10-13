"""Preload the identical app image and exercise the existing file-transfer measurements."""
import argparse
import json
from pathlib import Path
import docker
from compute import run

parser = argparse.ArgumentParser()
parser.add_argument("--image", required=True)
parser.add_argument("--calibrate", action="store_true")
parser.add_argument("--batch", default="v1")
args = parser.parse_args()
config = json.loads(Path("/run/secrets/agent.json").read_text())
engine = docker.DockerClient(base_url=config["dockerHost"])
try:
    engine.images.get(args.image)
except docker.errors.ImageNotFound:
    engine.images.pull(args.image, auth_config=config["registryAuth"][args.image.split("/")[0]])
if args.calibrate:
    load = config["load"]
    file = Path(config["dataDirectory"]) / load["files"]["small"]["fileId"]
    for event in ("load-calibrate-edge", "load-calibrate-cloud"):
        receipt = Path(config["stateDirectory"]) / "calibration" / args.batch / (event + ".json")
        result = run(load, event, file, receipt)
        print(json.dumps({"terminal": load["terminalId"], "event": event, "state": result["state"], "result": result.get("result")}))
print("Image ready")
