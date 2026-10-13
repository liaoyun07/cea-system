"""Generate terminal-local signal windows once, before measured load begins."""
import argparse
import json
import math
from pathlib import Path
import uuid

parser = argparse.ArgumentParser()
parser.add_argument("--root", required=True)
parser.add_argument("--count", type=int, required=True)
args = parser.parse_args()
root = Path(args.root)
files = {}
for size, count in (("small", 131072), ("medium", 524288), ("large", 2097152)):
    manifest = root / (size + ".json")
    if manifest.exists():
        files[size] = json.loads(manifest.read_text())
        continue
    name = str(uuid.uuid4())
    data = root / "data"
    data.mkdir(parents=True, exist_ok=True)
    path = data / name
    with path.open("w") as stream:
        for i in range(count):
            stream.write(f"{math.sin(i * .07) + .15 * math.sin(i * .51) + (6 if i % 8192 == 0 else 0):.8f}\n")
    files[size] = {"fileId": name, "bytes": path.stat().st_size}
    manifest.write_text(json.dumps(files[size]))
(root / "files.json").write_text(json.dumps(files))
