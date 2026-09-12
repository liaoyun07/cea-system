import http.client
import json
import os
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from app import Handler, MAX_BODY


class HttpTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        try:
            connection.request(method, path, body, headers or {})
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    def post(self, payload):
        return self.request("POST", "/statistics", json.dumps(payload), {"Content-Type": "application/json"})

    def test_health(self):
        self.assertEqual(self.request("GET", "/healthz"), (200, {"status": "ok"}))

    def test_message_and_instance(self):
        with patch.dict(os.environ, {"MESSAGE": "边缘示例"}):
            code, result = self.request("GET", "/")
        self.assertEqual(code, 200)
        self.assertEqual(result["message"], "边缘示例")
        self.assertTrue(result["instance"])

    def test_statistics(self):
        self.assertEqual(self.post({"values": [-2, 0, 2, 4]}),
                         (200, {"count": 4, "min": -2, "max": 4, "mean": 1.0}))

    def test_invalid_values(self):
        for payload in ({}, [], {"values": []}, {"values": [True]}, {"values": ["2"]},
                        {"values": [float("nan")]}, {"values": [float("inf")]},
                        {"values": [0] * 10001}):
            with self.subTest(payload=str(payload)[:60]):
                self.assertEqual(self.post(payload)[0], 400)

    def test_bad_json(self):
        self.assertEqual(self.request("POST", "/statistics", "broken", {"Content-Type": "application/json"})[0], 400)

    def test_oversize(self):
        self.assertEqual(self.request("POST", "/statistics", headers={"Content-Type": "application/json", "Content-Length": str(MAX_BODY + 1)})[0], 413)

    def test_content_type(self):
        self.assertEqual(self.request("POST", "/statistics", "test")[0], 415)

    def test_unknown_path(self):
        self.assertEqual(self.request("GET", "/missing")[0], 404)
        self.assertEqual(self.request("POST", "/missing")[0], 404)


if __name__ == "__main__":
    unittest.main()
