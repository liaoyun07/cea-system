"""Exact decimal MB, deterministic synthetic signal; all files initially terminal-local."""
import argparse
import json
import math
from pathlib import Path
import uuid


def period():
    return [f"{math.sin(i*.07)+.15*math.sin(i*.51)+(6 if i % 8192 == 0 else 0):+.6f}\n".encode()
            for i in range(8192)]


def reference(lines, count):
    values = [float(line) for line in lines]
    cycles, tail = divmod(count, len(values))
    total = cycles * math.fsum(values) + math.fsum(values[:tail])
    squares = cycles * math.fsum(x*x for x in values) + math.fsum(x*x for x in values[:tail])
    # One >4 pulse at the start of each 8192-sample period, including the partial last period.
    return {"samples": count, "mean": total/count, "rms": math.sqrt(squares/count),
            "peak": max(abs(v) for v in (values if cycles else values[:tail])),
            "windows": math.ceil(count/1024), "alert_windows": math.ceil(count/8192)}


def prepare(root):
    folder = root / "matrix"
    folder.mkdir(exist_ok=True)
    manifest = folder / "files.json"
    if manifest.exists():
        files = json.loads(manifest.read_text())
        for item in files:
            assert (root/"data"/item["fileId"]).stat().st_size == item["bytes"]
        return files
    lines = period()
    assert all(len(line) == 10 for line in lines)
    block = b"".join(lines)
    files = []
    for mb in (5, 50, 500):
        size = mb * 1_000_000
        name = str(uuid.uuid4())
        target = root / "data" / name
        with target.open("xb") as out:
            cycles, tail = divmod(size, len(block))
            for _ in range(cycles):
                out.write(block)
            out.write(block[:tail])
        assert target.stat().st_size == size
        files.append({"mb": mb, "fileId": name, "bytes": size,
                      "expected": reference(lines, size//10)})
    manifest.write_text(json.dumps(files, indent=2))
    return files


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("/sim"))
    print(json.dumps(prepare(parser.parse_args().root)))
