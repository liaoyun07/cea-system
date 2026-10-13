"""Same vibration statistics as offload-signal, with one bounded window in memory."""
import itertools
import json
import math
from pathlib import Path
import resource
import time


def features(lines, window=1024):
    count = windows = alerts = 0
    total = squares = peak = 0.0
    source = iter(lines)
    while block := list(itertools.islice(source, window)):
        values = [float(line) for line in block]
        if any(not math.isfinite(value) for value in values):
            raise ValueError("finite signal required")
        count += len(values)
        windows += 1
        block_peak = max(abs(value) for value in values)
        alerts += block_peak > 4
        peak = max(peak, block_peak)
        total += math.fsum(values)
        squares += math.fsum(value * value for value in values)
    if not count:
        raise ValueError("nonempty signal required")
    return {"samples": count, "mean": total / count, "rms": math.sqrt(squares / count),
            "peak": peak, "windows": windows, "alert_windows": alerts}


if __name__ == "__main__":
    source = Path("/cea-work/in/signal.csv")
    wall, cpu = time.perf_counter(), time.process_time()
    with source.open("rb") as stream:
        result = features(stream)
    result["measurement"] = {"readComputeSeconds": time.perf_counter() - wall,
                             "cpuSeconds": time.process_time() - cpu,
                             "maxRssKiB": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                             "inputBytes": source.stat().st_size}
    Path("/cea-work/out/result.json").write_text(json.dumps(result, allow_nan=False))
