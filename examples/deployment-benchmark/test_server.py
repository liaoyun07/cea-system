import io
import http.client
import json
import os
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from server import Engine, make_server


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = Engine(os.environ["SERVICE_KIND"])
        cls.server = make_server(cls.engine, "127.0.0.1", 0)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.thread.join()
        cls.server.server_close()

    def request(self, path, body=None, content_type=None):
        headers = {"Content-Type": content_type or self.engine.content_type} if body is not None else {}
        try:
            response = urllib.request.urlopen(urllib.request.Request(self.base + path, body, headers), timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.loads(response.read())

    def test_ready(self):
        self.assertEqual(self.request("/healthz"), (200, {"ready": True, "service": self.engine.kind}))

    def test_not_found(self):
        self.assertEqual(self.request("/missing")[0], 404)

    def test_wrong_content_type(self):
        self.assertEqual(self.request(self.engine.path, b"bad", "text/plain")[0], 415)

    def test_invalid(self):
        self.assertEqual(self.request(self.engine.path, b"bad")[0], 422)

    def test_oversize(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        connection.putrequest("POST", self.engine.path)
        connection.putheader("Content-Type", self.engine.content_type)
        connection.putheader("Content-Length", str(16 * 1024 * 1024 + 1))
        connection.endheaders()
        self.assertEqual(connection.getresponse().status, 413)
        connection.close()

    def test_actual_result(self):
        case = json.loads(Path(f"/fixtures/{self.engine.kind}.json").read_text())
        import base64
        status, actual = self.request(self.engine.path, base64.b64decode(case["body"]))
        self.assertEqual(status, 200)
        expected = case["expected"]
        if self.engine.kind == "signal":
            for key, value in expected.items():
                self.assertAlmostEqual(actual[key], value, places=12)
        elif self.engine.kind == "bearing":
            self.assertEqual(actual["counts"], expected["counts"])
            self.assertEqual(actual["windows"], expected["windows"])
        else:
            self.assertAlmostEqual(actual["score"], expected["score"], places=5)
            self.assertEqual(actual["defect"], expected["defect"])
            self.assertEqual(len(actual["heatmap"]), 32)
            self.assertEqual(len(actual["heatmap"][0]), 32)

    def test_input_constraints(self):
        if self.engine.kind == "signal":
            for raw in (b'{"samples":[]}', b'{"samples":[true]}', b'{"samples":[NaN]}'):
                self.assertEqual(self.request(self.engine.path, raw)[0], 422)
        elif self.engine.kind == "bearing":
            import numpy as np
            raw = io.BytesIO()
            np.savez(raw, signal=np.zeros((1, 2048)), sample_rate=100)
            self.assertEqual(self.request(self.engine.path, raw.getvalue())[0], 422)
        else:
            self.assertEqual(self.request(self.engine.path, b"\x89PNG\r\n\x1a\ncorrupt")[0], 422)

    def test_startup_failure(self):
        from unittest.mock import patch
        if self.engine.kind == "signal":
            with self.assertRaises(ValueError):
                Engine("unknown")
        else:
            loader = "joblib.load" if self.engine.kind == "bearing" else "torch.load"
            with patch(loader, side_effect=ValueError("invalid model")):
                with self.assertRaises(ValueError):
                    Engine(self.engine.kind)


if __name__ == "__main__":
    unittest.main()
