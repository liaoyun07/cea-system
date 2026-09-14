"""Whole-file algorithm measurement. Standard library only; no network or storage client."""
from contextlib import contextmanager
from datetime import datetime, timezone
import json
from pathlib import Path
import stat
import tempfile
import time

REPORT_NAME = "cea-measurement.json"


def timestamp(nanoseconds):
    seconds, fraction = divmod(nanoseconds, 1_000_000_000)
    return datetime.fromtimestamp(seconds, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S") + f".{fraction:09d}Z"


class Measurement:
    """One complete algorithm invocation; register only successfully consumed/generated files.

    input() covers a whole-file load (not each read/batch/epoch). output() is called after
    the writer has closed. File identities are deduplicated separately for input/output.
    A successful context publishes one small report; an exception publishes none.
    """
    def __init__(self, report):
        self.report = Path(report)
        self.inputs, self.outputs = {}, {}
        self.started = None

    def __enter__(self):
        if self.started is not None:
            raise RuntimeError("measurement cannot be reused")
        # This reserved report belongs to this invocation, never to business input/output.
        self.report.unlink(missing_ok=True)
        self.started = time.time_ns()
        self.monotonic = time.perf_counter_ns()
        return self

    def _file(self, path):
        if self.started is None:
            raise RuntimeError("measurement context has not started")
        path = Path(path).resolve(strict=True)
        if path == self.report.resolve():
            raise ValueError("measurement report is not business data")
        info = path.stat()
        if not stat.S_ISREG(info.st_mode):
            raise ValueError("whole-file measurement requires a regular file")
        return path, info

    def _remember(self, collection, path, info):
        if len(collection) >= 1024 and (info.st_dev, info.st_ino) not in collection:
            raise ValueError("at most 1024 measured files per direction")
        collection[(info.st_dev, info.st_ino)] = {"path": path.as_posix(), "bytes": info.st_size}

    @contextmanager
    def input(self, path):
        path, before = self._file(path)
        yield path
        _, after = self._file(path)
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
                after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
            raise ValueError("input changed while being consumed")
        self._remember(self.inputs, path, after)

    def output(self, path):
        path, info = self._file(path)
        self._remember(self.outputs, path, info)

    def __exit__(self, kind, error, traceback):
        elapsed = time.perf_counter_ns() - self.monotonic
        ended = time.time_ns()
        if kind is not None:
            self.report.unlink(missing_ok=True)
            return False
        if elapsed <= 0 or ended <= self.started or abs(ended - self.started - elapsed) > max(1_000_000, elapsed // 1000):
            raise ValueError("algorithm clock changed during measurement")
        result = {"startedAt": timestamp(self.started), "endedAt": timestamp(ended), "durationNs": elapsed,
                  "inputs": list(self.inputs.values()), "outputs": list(self.outputs.values())}
        encoded = json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
        if len(encoded) > 262144:
            raise ValueError("measurement report exceeds 256 KiB")
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=self.report.parent, prefix=".measurement-", delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(encoded)
            # Helpers/terminal agent run under a different UID with DAC bypass disabled.
            # This declared artifact contains sizes/timestamps only, not storage credentials.
            temporary.chmod(0o644)
            temporary.replace(self.report)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
        return False
