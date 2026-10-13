import importlib.util
import io
import math
from pathlib import Path
import unittest

from app import features
from prepare import period, reference


class MatrixTest(unittest.TestCase):
    def test_same_statistics_as_original_program(self):
        spec = importlib.util.spec_from_file_location("original", Path(__file__).resolve().parents[3]/"examples/offloading/app.py")
        original = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(original)
        for count in (1, 1023, 1024, 1025, 10000):
            values = [math.sin(i*.07)+(6 if i%8192==0 else 0) for i in range(count)]
            actual = features(str(v) for v in values)
            for key, expected in original.features(values).items():
                self.assertAlmostEqual(expected, actual[key], places=11)

    def test_reference_including_partial_period_and_window(self):
        lines = period()
        self.assertTrue(all(len(line)==10 for line in lines))
        for count in (1, 1025, 8192, 8193, 500_000):
            actual = features(lines[i%len(lines)] for i in range(count))
            for key, expected in reference(lines,count).items():
                self.assertAlmostEqual(expected,actual[key],places=11)

    def test_consumes_stream_with_bounded_reads_and_rejects_invalid(self):
        class Stream(io.BytesIO):
            def read(self, *args):
                raise AssertionError("whole-file read prohibited")
        self.assertEqual(2, features(Stream(b"1.0\n2.0\n"))["samples"])
        for values in ([], ["nan"], ["inf"]):
            with self.assertRaises(ValueError):
                features(values)


if __name__ == "__main__":
    unittest.main()
