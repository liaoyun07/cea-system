import base64
import hashlib
import http.client
import io
import json
import threading
import unittest
import uuid
from unittest.mock import Mock

from botocore.exceptions import ClientError
from gateway import Denied, Gateway, Handler, MAX_UPLOAD, ThreadingHTTPServer


class Store:
    def __init__(self):
        self.objects = {}

    def put_object(self, **args):
        raw = args["Body"].read()
        assert len(raw) == args["ContentLength"]
        assert base64.b64encode(hashlib.md5(raw).digest()).decode() == args["ContentMD5"]
        self.objects[args["Key"]] = raw

    def head_object(self, **args):
        if args["Key"] not in self.objects:
            raise ClientError({"Error": {"Code": "404"}}, "HeadObject")
        return {"ContentLength": len(self.objects[args["Key"]])}

    def get_object(self, **args):
        return {**self.head_object(**args), "Body": io.BytesIO(self.objects[args["Key"]])}


class GatewayTest(unittest.TestCase):
    def setUp(self):
        self.gateway = Gateway.__new__(Gateway)
        self.gateway.config = {"namespace": "lab", "bucket": "edge", "clusterId": "edge-a", "events": ["bearing"],
                               "terminals": {"t1": "secret", "t2": "second"}}
        self.gateway.slots = threading.BoundedSemaphore(2)
        self.gateway.s3 = Store()
        self.gateway.backend = Mock(return_value={"executionId": "result", "clusterId": "edge-a"})

    def test_upload_stream_integrity(self):
        raw = b"actual bytes" * 10000
        result = self.gateway.upload("t1", io.BytesIO(raw), len(raw))
        self.assertEqual(len(raw), result["bytes"])
        self.assertEqual(raw, self.gateway.s3.objects[self.gateway.object_key("t1", result["uploadId"])])
        self.gateway.backend.assert_not_called()

    def test_short_upload_never_publishes(self):
        with self.assertRaises(Denied):
            self.gateway.upload("t1", io.BytesIO(b"short"), 99)
        self.assertFalse(self.gateway.s3.objects)
        self.assertTrue(self.gateway.slots.acquire(False))

    def test_size_limit(self):
        for size in (0, -1, MAX_UPLOAD + 1):
            with self.assertRaises(Denied):
                self.gateway.upload("t1", io.BytesIO(), size)

    def test_upload_slot_limit(self):
        self.gateway.slots.acquire()
        self.gateway.slots.acquire()
        with self.assertRaises(Denied) as caught:
            self.gateway.upload("t1", io.BytesIO(b"x"), 1)
        self.assertEqual(429, caught.exception.status)

    def test_domain_mismatch_denied(self):
        self.gateway.backend.return_value = {"clusterId": "edge-b"}
        with self.assertRaises(Denied) as caught:
            self.gateway.identity("Bearer secret")
        self.assertEqual(503, caught.exception.status)

    def test_terminal_checks_receipt_before_upload(self):
        import tempfile
        from pathlib import Path
        from terminal import run
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as folder:
            with patch("pathlib.Path.write_text", side_effect=PermissionError), patch("terminal.request") as call:
                with self.assertRaises(PermissionError):
                    run({}, "bearing", Path("data"), Path(folder))
                call.assert_not_called()

    def test_identity_and_disabled_registration(self):
        for token in (None, "Bearer wrong", "Basic secret"):
            with self.assertRaises(Denied):
                self.gateway.identity(token)
        self.assertEqual("t1", self.gateway.identity("Bearer secret"))
        self.gateway.backend.side_effect = Denied(403, "disabled")
        with self.assertRaises(Denied):
            self.gateway.identity("Bearer secret")

    def test_event_requires_owned_object(self):
        uploaded = self.gateway.upload("t1", io.BytesIO(b"data"), 4)
        event = {"eventType": "bearing", "uploadId": uploaded["uploadId"]}
        with self.assertRaises(ClientError):
            self.gateway.event("t2", event)
        self.gateway.backend.assert_not_called()
        self.gateway.event("t1", event)
        call = self.gateway.backend.call_args
        self.assertEqual(uploaded["uploadId"], call.kwargs["key"])
        self.assertIn("/ingress/t1/", call.args[2]["inputs"]["data_uri"])

    def test_no_arbitrary_uri_or_extra_input(self):
        for event in ({"eventType": "bearing", "uploadId": "../../model"},
                      {"eventType": "bearing", "uploadId": str(uuid.uuid4()), "data_uri": "s3://other"},
                      {"eventType": "other", "uploadId": str(uuid.uuid4())}):
            with self.assertRaises(Denied):
                self.gateway.event("t1", event)

    def test_result_exact_execution_and_small_json(self):
        execution = str(uuid.uuid4())
        key = f"lab/{execution}/task/1/diagnosis.json"
        self.gateway.s3.objects[key] = b'{"fault":"outer"}'
        self.gateway.backend.return_value = {"state": "SUCCESS", "outputs": {"terminal_result": "s3://edge/" + key}}
        self.assertEqual({"fault": "outer"}, self.gateway.result("t1", execution)["result"])
        for uri in ("s3://center/" + key, "http://127.0.0.1/a.json", "s3://edge/lab/other/diagnosis.json"):
            self.gateway.backend.return_value["outputs"]["terminal_result"] = uri
            with self.assertRaises(Denied):
                self.gateway.result("t1", execution)
        self.gateway.backend.return_value["outputs"]["terminal_result"] = "s3://edge/" + key
        self.gateway.s3.objects[key] = b" " * 262145
        with self.assertRaises(Denied):
            self.gateway.result("t1", execution)

    def test_result_owner_checked_before_storage(self):
        self.gateway.backend.side_effect = Denied(403, "not owner")
        with self.assertRaises(Denied):
            self.gateway.result("t2", str(uuid.uuid4()))

    def test_http_upload_event_result(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        server.gateway = self.gateway
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            client = http.client.HTTPConnection("127.0.0.1", server.server_port)
            client.request("POST", "/v1/uploads", b"binary-data", {"Authorization": "Bearer secret"})
            response = client.getresponse()
            self.assertEqual(201, response.status)
            upload = json.loads(response.read())
            client.close()
            self.assertEqual(b"binary-data", self.gateway.s3.objects[self.gateway.object_key("t1", upload["uploadId"])])
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
