"""Offline per-channel diagnosis of the published NumPy v2, not a throughput trial."""
import json
from pathlib import Path
import statistics
import time
import numpy as np
from app import GROUPS, RATES, load, window_features

rows = []
for group, names in GROUPS.items():
    data = load(Path('/data/full') / (group + '.npz'))
    for name in names:
        values = data[name]
        durations = []
        for _ in range(5):
            start = time.perf_counter_ns()
            window_features(values, RATES[name])
            durations.append((time.perf_counter_ns() - start) / 1e6)
        windows = values.reshape(len(values), 6, 10 * RATES[name])
        mean = windows.mean(axis=2, dtype=np.float64)
        second = np.einsum('ijk,ijk->ij', windows, windows, dtype=np.float64) / windows.shape[2]
        small = second - mean ** 2 <= 16 * np.finfo(np.float64).eps * second
        row = dict(group=group, channel=name, bytes=values.nbytes, milliseconds=durations,
                   medianMs=statistics.median(durations), fallbackWindows=int(small.sum()), windows=small.size)
        rows.append(row)
        print(json.dumps(row), flush=True)
Path('/data/diagnosis-v2.json').write_text(json.dumps(rows, indent=2))
