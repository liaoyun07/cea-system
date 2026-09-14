import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from cea_measurement import Measurement, REPORT_NAME, timestamp


class MeasurementTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.report = self.root / REPORT_NAME
        self.source = self.root / "input.bin"
        self.source.write_bytes(b"abc\x00\xff")

    def read(self):
        return json.loads(self.report.read_text())

    def test_success_records_whole_file_and_closed_output(self):
        with Measurement(self.report) as measurement:
            with measurement.input(self.source) as path:
                data = path.read_bytes()
            output = self.root / "output.bin"
            output.write_bytes(data[:2])
            measurement.output(output)
        value = self.read()
        self.assertEqual(5, value["inputs"][0]["bytes"])
        self.assertEqual(2, value["outputs"][0]["bytes"])
        self.assertGreater(value["durationNs"], 0)
        self.assertLess(value["startedAt"], value["endedAt"])
        self.assertEqual({"startedAt", "endedAt", "durationNs", "inputs", "outputs"}, set(value))

    def test_registration_does_not_read_file_contents(self):
        with Measurement(self.report) as measurement, patch.object(Path, "read_bytes", side_effect=AssertionError("extra read")):
            with measurement.input(self.source):
                pass
            measurement.output(self.source)
        self.assertEqual(5, self.read()["inputs"][0]["bytes"])

    def test_same_file_alias_and_repeated_registration_are_deduplicated(self):
        alias = self.root / "alias.bin"
        os.link(self.source, alias)
        with Measurement(self.report) as measurement:
            for path in (self.source, alias, self.source):
                with measurement.input(path):
                    pass
                measurement.output(path)
        self.assertEqual(1, len(self.read()["inputs"]))
        self.assertEqual(1, len(self.read()["outputs"]))

    def test_failure_removes_stale_report_and_preserves_exception(self):
        self.report.write_text("stale")
        with self.assertRaisesRegex(RuntimeError, "business failure"):
            with Measurement(self.report):
                raise RuntimeError("business failure")
        self.assertFalse(self.report.exists())

    def test_changed_input_cannot_be_counted(self):
        with self.assertRaisesRegex(ValueError, "changed"):
            with Measurement(self.report) as measurement:
                with measurement.input(self.source):
                    self.source.write_bytes(b"changed")
        self.assertFalse(self.report.exists())

    def test_missing_and_directory_inputs_fail(self):
        for path in (self.root / "absent", self.root):
            with self.assertRaises((FileNotFoundError, ValueError)):
                with Measurement(self.report) as measurement:
                    with measurement.input(path):
                        pass
            self.assertFalse(self.report.exists())

    def test_empty_files_and_no_inputs_are_valid(self):
        output = self.root / "empty"
        output.touch()
        with Measurement(self.report) as measurement:
            measurement.output(output)
        self.assertEqual([], self.read()["inputs"])
        self.assertEqual(0, self.read()["outputs"][0]["bytes"])

    def test_report_cannot_count_itself(self):
        with self.assertRaisesRegex(ValueError, "not business data"):
            with Measurement(self.report) as measurement:
                self.report.write_text("invalid")
                measurement.output(self.report)

    def test_wall_clock_step_invalidates_report(self):
        with patch("cea_measurement.time.time_ns", side_effect=[1_000_000_000, 9_000_000_000]), \
                patch("cea_measurement.time.perf_counter_ns", side_effect=[1, 1_000_001]):
            with self.assertRaisesRegex(ValueError, "clock"):
                with Measurement(self.report):
                    pass
        self.assertFalse(self.report.exists())

    def test_timestamp_preserves_nanoseconds(self):
        self.assertEqual("1970-01-01T00:00:01.000000023Z", timestamp(1_000_000_023))

    @unittest.skipIf(os.name == "nt", "POSIX file permissions")
    def test_report_is_readable_by_separate_unprivileged_helper(self):
        with Measurement(self.report):
            pass
        self.assertEqual(0o644, self.report.stat().st_mode & 0o777)


if __name__ == "__main__":
    unittest.main()
