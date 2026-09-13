import io
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import transfer


class HelperTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.plan = self.root / "plan.json"
        self.patches = [patch.object(transfer, "ROOT", self.root), patch.object(transfer, "PLAN", self.plan)]
        for p in self.patches:
            p.start()
        self.received = {}
        received = self.received

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                if self.path == "/missing":
                    self.send_error(404)
                    return
                data = b"real-input\x00\xff"
                self.send_response(200)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_PUT(self):
                received[self.path] = self.rfile.read(int(self.headers["Content-Length"]))
                self.send_response(200)
                self.end_headers()

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = "http://127.0.0.1:" + str(self.server.server_port)
        self.write_plan()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        for p in reversed(self.patches):
            p.stop()
        self.temp.cleanup()

    def write_plan(self, inputs=None, outputs=None, inline=None):
        self.plan.write_text(json.dumps({"inputs": inputs or {}, "outputs": outputs or {}, "inline": inline or {}}))

    def test_input_gate_and_binary_transfer(self):
        self.write_plan(inputs={"data": self.base + "/data"}, inline={"data.part": "must survive", "list.json": '["/cea-work/in/data"]'})
        transfer.run("input")
        self.assertEqual((self.root / "in/data").read_bytes(), b"real-input\x00\xff")
        self.assertTrue((self.root / "start").exists())
        self.assertEqual((self.root / "in/data.part").read_text(), "must survive")
        self.assertEqual(json.loads((self.root / "in/list.json").read_text()), ["/cea-work/in/data"])

    def test_missing_input_does_not_open_gate(self):
        self.write_plan(inputs={"data": self.base + "/missing"})
        with self.assertRaises(Exception):
            transfer.run("input")
        self.assertFalse((self.root / "start").exists())

    def test_outputs_include_empty_file_and_release_algorithm(self):
        transfer.run("input")
        self.write_plan(outputs={"model": self.base + "/model", "empty": self.base + "/empty"})
        (self.root / "out/model").write_bytes(b"model\x00\xff")
        (self.root / "out/empty").touch()
        (self.root / "exit").write_text("0")
        transfer.run("output")
        self.assertEqual(self.received, {"/model": b"model\x00\xff", "/empty": b""})
        self.assertTrue((self.root / "published").exists())

    def test_algorithm_failure_does_not_publish(self):
        transfer.run("input")
        self.write_plan(outputs={"model": self.base + "/model"})
        (self.root / "exit").write_text("7")
        transfer.run("output")
        self.assertEqual(self.received, {})
        self.assertTrue((self.root / "published").exists())

    def test_missing_output_fails_and_releases_wrapper(self):
        transfer.run("input")
        self.write_plan(outputs={"model": self.base + "/model"})
        (self.root / "exit").write_text("0")
        with self.assertRaises(FileNotFoundError):
            transfer.run("output")
        self.assertTrue((self.root / "published").exists())

    def test_symlink_and_fifo_rejected(self):
        transfer.run("input")
        (self.root / "out/link").symlink_to(self.plan)
        os.mkfifo(self.root / "out/pipe")
        for name in ("link", "pipe"):
            with self.assertRaises((OSError, ValueError)):
                transfer.open_output(name)
        (self.root / "out/link").unlink()
        (self.root / "out/pipe").unlink()
        (self.root / "out").rmdir()
        (self.root / "out").symlink_to(self.root / "in")
        with self.assertRaises(OSError):
            transfer.open_output("anything")

    def test_traversal_rejected(self):
        for name in ("../plan.json", ".", "..", "/etc/passwd", "a/b", "a\\b"):
            with self.assertRaises(ValueError):
                transfer.filename(name)

    def test_network_retry_reads_refreshed_grant(self):
        self.write_plan(inputs={"data": self.base + "/old"})
        original = transfer.HTTP.open
        calls = []

        def opening(url, **kwargs):
            calls.append(url)
            if len(calls) == 1:
                self.write_plan(inputs={"data": self.base + "/new"})
                raise TimeoutError()
            return original(url, **kwargs)

        with patch.object(transfer.HTTP, "open", side_effect=opening), patch.object(transfer.time, "sleep"):
            transfer.run("input")
        self.assertEqual(calls, [self.base + "/old", self.base + "/new"])


if __name__ == "__main__":
    unittest.main()
