"""Microbenchmark only: metadata/report overhead, not algorithm throughput. Never uploads reports."""
import json
from pathlib import Path
import statistics
import tempfile
import time
from cea_measurement import Measurement, REPORT_NAME

with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    paths = [root / f"input-{i}" for i in range(10)]
    for path in paths:
        with path.open("wb") as stream:
            stream.truncate(64 * 1024 * 1024)  # file length, no 640 MiB content scan
    elapsed = []
    for _ in range(200):
        start = time.perf_counter_ns()
        with Measurement(root / REPORT_NAME) as measure:
            for path in paths:
                with measure.input(path):
                    pass  # intentionally no algorithm: isolates SDK cost
            measure.output(paths[0])
        elapsed.append((time.perf_counter_ns() - start) / 1e6)
    print(json.dumps({"benchmark":"metadata and report only; not algorithm throughput", "calls":200,
        "inputFiles":10,"outputFiles":1,"fileBytes":64*1024*1024,
        "medianMilliseconds":statistics.median(elapsed),"p95Milliseconds":sorted(elapsed)[189]}))
