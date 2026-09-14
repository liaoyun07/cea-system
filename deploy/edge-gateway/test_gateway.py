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
        self.gateway.backend.side_effect = [{"state": "SUCCESS", "outputs": {"terminal_result": "s3://cloud/lab/result.json"}}, {"fault": "outer"}]
        self.assertEqual({"fault": "outer"}, self.gateway.result("t1", execution)["result"])
        self.assertEqual(("t1", "executions/" + execution + "/result"), self.gateway.backend.call_args.args)
        self.assertFalse(self.gateway.s3.objects)
        self.gateway.backend.side_effect = [{"state": "SUCCESS", "outputs": {"terminal_result": "untrusted-uri"}}, Denied(422, "not a declared artifact")]
        with self.assertRaises(Denied):
            self.gateway.result("t1", execution)

    def test_compute_is_metadata_only_and_reuses_original_idempotency(self):
        self.gateway.config["computeEvents"] = ["stats"]
        file = {"fileId": str(uuid.uuid4()), "bytes": 42}
        self.gateway.agent_request = Mock(return_value=file)
        request = {"requestId": str(uuid.uuid4()), "eventType": "stats", "file": file}
        self.gateway.compute("t1", request)
        self.gateway.agent_request.assert_called_once_with("t1", "files/check", file)
        self.assertEqual(request["requestId"], self.gateway.backend.call_args.kwargs["key"])
        self.assertEqual({"data_file": file}, self.gateway.backend.call_args.args[2]["inputs"])
        self.assertFalse(self.gateway.s3.objects)
        with self.assertRaises(Denied):
            self.gateway.compute("t1", {**request, "cluster": "cloud"})

    def test_worker_control_cannot_use_terminal_token(self):
        self.gateway.config.update(controlToken="worker-secret", agents={"t1": {}})
        self.gateway.agent_request = Mock(return_value={"state": "CANCELLED"})
        for token in (None, "Bearer secret", "Bearer wrong"):
            with self.assertRaises(Denied):
                self.gateway.internal(token, "t1", "attempts/cancel", {})
        self.gateway.agent_request.assert_not_called()
        with self.assertRaises(Denied):
            self.gateway.internal("Bearer worker-secret", "t2", "attempts/cancel", {})
        self.assertEqual("CANCELLED", self.gateway.internal("Bearer worker-secret", "t1", "attempts/cancel", {})["state"])

    def test_on_demand_materialization_is_exact_and_reentrant(self):
        file = {"fileId": str(uuid.uuid4()), "bytes": 4}
        request = {"executionId": str(uuid.uuid4()), "file": file}
        stream = io.BytesIO(b"data")
        stream.headers = {"Content-Length": "4"}
        self.gateway.agent_request = Mock(side_effect=[file, stream, file])
        first = self.gateway.materialize("t1", request)
        second = self.gateway.materialize("t1", request)
        self.assertEqual(first, second)
        self.assertEqual([b"data"], list(self.gateway.s3.objects.values()))
        self.assertEqual(1, sum(call.args[1] == "files/read" for call in self.gateway.agent_request.call_args_list))

    def test_missing_head_without_bucket_list_does_not_require_broader_permission(self):
        file = {"fileId": str(uuid.uuid4()), "bytes": 4}
        stream = io.BytesIO(b"data")
        stream.headers = {"Content-Length": "4"}
        self.gateway.agent_request = Mock(side_effect=[file, stream])
        self.gateway.s3.head_object = Mock(side_effect=ClientError({"Error": {"Code": "AccessDenied"}}, "HeadObject"))
        self.gateway.materialize("t1", {"executionId": str(uuid.uuid4()), "file": file})
        self.assertEqual([b"data"], list(self.gateway.s3.objects.values()))

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
