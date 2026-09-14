"""Bounded terminal ingress. No workflow engine, arbitrary proxy or S3 key from clients."""
import base64
import hashlib
import hmac
import json
import os
import re
import socket
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

MAX_UPLOAD = 64 * 1024 * 1024
MAX_JSON = 262144
UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"


class Denied(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Gateway:
    def __init__(self, config):
        self.config = config
        self.slots = threading.BoundedSemaphore(2)
        self.http = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        self.s3 = boto3.client("s3", endpoint_url=config["storageEndpoint"],
                               aws_access_key_id=config["storageUser"],
                               aws_secret_access_key=config["storagePassword"],
                               region_name="us-east-1", config=Config(connect_timeout=10, read_timeout=60,
                                 retries={"max_attempts": 2}, s3={"addressing_style": "path"}))

    def backend(self, terminal, suffix, body=None, key=None):
        c = self.config
        path = f'/api/namespaces/{c["namespace"]}/edge-access/'
        path += f'terminals/{terminal}/{suffix}' if terminal is not None else suffix
        headers = {"Authorization": "Basic " + base64.b64encode(
            f'{c["backendUser"]}:{c["backendPassword"]}'.encode()).decode()}
        if key:
            headers["Idempotency-Key"] = key
        if body is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(c["backend"] + path, headers=headers,
                data=None if body is None else json.dumps(body, allow_nan=False).encode())
        try:
            with self.http.open(req, timeout=30) as response:
                raw = response.read(MAX_JSON + 1)
                if len(raw) > MAX_JSON:
                    raise Denied(502, "platform response exceeds limit")
                return json.loads(raw)
        except urllib.error.HTTPError as error:
            raise Denied(error.code if error.code in (400, 401, 403, 404, 409, 422) else 502,
                         "platform rejected request") from None

    def identity(self, header):
        if not header or not header.startswith("Bearer "):
            raise Denied(401, "terminal token required")
        token = header[7:]
        for terminal, expected in self.config["terminals"].items():
            if hmac.compare_digest(token, expected):
                # Registration and enabled flags remain authoritative in the platform.
                gateway = self.backend(None, "heartbeat", {})
                if gateway["clusterId"] != self.config["clusterId"]:
                    raise Denied(503, "gateway storage domain does not match registration")
                self.backend(terminal, "heartbeat", {})
                return terminal
        raise Denied(401, "invalid terminal token")

    def upload(self, terminal, stream, length):
        if not 0 < length <= MAX_UPLOAD:
            raise Denied(413, "upload must contain 1..64 MiB")
        if not self.slots.acquire(blocking=False):
            raise Denied(429, "upload capacity reached")
        try:
            upload_id = str(uuid.uuid4())
            key = self.object_key(terminal, upload_id)
            digest = hashlib.md5()  # S3 Content-MD5 verifies transmitted bytes, not identity/security.
            with tempfile.TemporaryFile() as spool:
                remaining = length
                while remaining:
                    chunk = stream.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise Denied(400, "incomplete upload")
                    spool.write(chunk)
                    digest.update(chunk)
                    remaining -= len(chunk)
                spool.seek(0)
                self.s3.put_object(Bucket=self.config["bucket"], Key=key, Body=spool,
                    ContentLength=length, ContentMD5=base64.b64encode(digest.digest()).decode(),
                    ContentType="application/octet-stream")
            # Atomic PUT has completed before the caller receives a usable handle.
            return {"uploadId": upload_id, "bytes": length}
        finally:
            self.slots.release()

    def object_key(self, terminal, upload_id):
        if not re.fullmatch(UUID, upload_id):
            raise Denied(400, "invalid uploadId")
        return f'{self.config["namespace"]}/ingress/{terminal}/{upload_id}/data'

    def agent_request(self, terminal, operation, body, binary=False):
        connection = self.config.get("agents", {}).get(terminal)
        if connection is None:
            raise Denied(422, "terminal agent is not configured")
        request = urllib.request.Request(connection["endpoint"] + "/" + operation,
            data=json.dumps(body, allow_nan=False).encode(),
            headers={"Authorization": "Bearer " + connection["token"], "Content-Type": "application/json"})
        try:
            response = self.http.open(request, timeout=90)
        except urllib.error.HTTPError as error:
            raise Denied(error.code if error.code in (400, 403, 404, 409, 422) else 502, "terminal agent rejected operation") from None
        if binary:
            return response
        with response:
            raw = response.read(1048577)
            if len(raw) > 1048576:
                raise Denied(502, "terminal reply exceeds limit")
            return json.loads(raw)

    def compute(self, terminal, request):
        if (set(request) != {"requestId", "eventType", "file"} or
            request["eventType"] not in self.config.get("computeEvents", []) or
            not re.fullmatch(UUID, request["requestId"])):
            raise Denied(400, "allowed compute event, requestId and file required")
        # Check metadata only. No original-file bytes are read or uploaded at submission.
        file = self.agent_request(terminal, "files/check", request["file"])
        return self.backend(terminal, "events", {"eventType": request["eventType"], "inputs": {"data_file": file}}, key=request["requestId"])

    def materialize(self, terminal, request):
        if set(request) != {"executionId", "file"} or not re.fullmatch(UUID, request["executionId"]):
            raise Denied(400, "execution and terminal file required")
        file = self.agent_request(terminal, "files/check", request["file"])
        key = f'{self.config["namespace"]}/ingress/{terminal}/offload/{request["executionId"]}/{file["fileId"]}/data'
        try:
            prior = self.s3.head_object(Bucket=self.config["bucket"], Key=key)
            if prior["ContentLength"] != file["bytes"]:
                raise Denied(409, "materialized size differs")
        except ClientError as error:
            # S3 may return 403 for an absent object when GetObject is allowed but ListBucket is not.
            # An inconclusive HEAD is not proof of absence: PUT the same immutable source/key again.
            # PUT authorization/errors remain authoritative; do not grant broader bucket-list access.
            if error.response.get("Error", {}).get("Code") not in ("404", "NoSuchKey", "403", "AccessDenied"):
                raise
            if not self.slots.acquire(blocking=False):
                raise Denied(429, "upload capacity reached")
            try:
                digest = hashlib.md5()  # Content-MD5 checks the actual terminal→gateway→S3 transfer.
                with self.agent_request(terminal, "files/read", file, binary=True) as source, tempfile.TemporaryFile() as spool:
                    if int(source.headers.get("Content-Length", -1)) != file["bytes"]:
                        raise Denied(422, "terminal transfer length differs")
                    remaining = file["bytes"]
                    while remaining:
                        chunk = source.read(min(1024 * 1024, remaining))
                        if not chunk:
                            raise Denied(502, "incomplete terminal transfer")
                        spool.write(chunk)
                        digest.update(chunk)
                        remaining -= len(chunk)
                    spool.seek(0)
                    self.s3.put_object(Bucket=self.config["bucket"], Key=key, Body=spool, ContentLength=file["bytes"],
                        ContentMD5=base64.b64encode(digest.digest()).decode(), ContentType="application/octet-stream")
            finally:
                self.slots.release()
        return {"uri": f's3://{self.config["bucket"]}/{key}'}

    def internal(self, header, terminal, operation, request):
        secret = self.config.get("controlToken")
        if not secret or not hmac.compare_digest(header or "", "Bearer " + secret):
            raise Denied(401, "worker control authentication required")
        if terminal not in self.config.get("agents", {}):
            raise Denied(404, "terminal route not configured")
        if operation == "files/materialize":
            return self.materialize(terminal, request)
        if operation in ("files/check", "attempts/step", "attempts/cancel", "available"):
            return self.agent_request(terminal, operation, request)
        raise Denied(404, "control operation not found")

    def event(self, terminal, request):
        if set(request) != {"eventType", "uploadId"} or request["eventType"] not in self.config["events"]:
            raise Denied(400, "expected allowed eventType and uploadId")
        key = self.object_key(terminal, request["uploadId"])
        self.s3.head_object(Bucket=self.config["bucket"], Key=key)
        return self.backend(terminal, "events", {"eventType": request["eventType"],
            "inputs": {"data_uri": f's3://{self.config["bucket"]}/{key}'}},
            key=request["uploadId"])

    def result(self, terminal, execution_id):
        if not re.fullmatch(UUID, execution_id):
            raise Denied(400, "invalid executionId")
        execution = self.backend(terminal, "executions/" + execution_id)
        response = {"executionId": execution_id, "state": execution["state"]}
        if execution["state"] == "SUCCESS":
            uri = execution["outputs"].get("terminal_result")
            if uri:
                # The platform resolves only this successful execution's declared JSON artifact,
                # including cloud output. No extra cloud credentials or arbitrary URI proxy here.
                response["result"] = self.backend(terminal, "executions/" + execution_id + "/result")
        return response


class Handler(BaseHTTPRequestHandler):
    server_version = "CEA-Gateway"
    def setup(self):
        super().setup()
        self.connection.settimeout(30)

    def log_message(self, *_args):
        pass  # No tokens, payload, signed URL or exception credentials in HTTP logs.

    def reply(self, status, value):
        data = json.dumps(value, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(data)
        self.close_connection = True

    def process(self):
        try:
            if self.command == "GET" and self.path == "/health":
                return self.reply(200, {"status": "UP"})
            gateway = self.server.gateway
            internal = re.fullmatch(r"/internal/terminals/([A-Za-z0-9][A-Za-z0-9_.-]{0,99})/(.+)", self.path)
            if internal and self.command == "POST":
                if self.headers.get("Transfer-Encoding") or len(self.headers.get_all("Content-Length", [])) != 1:
                    raise Denied(411, "single Content-Length required")
                length = int(self.headers["Content-Length"])
                if not 0 < length <= 1048576:
                    raise Denied(413, "control request exceeds limit")
                return self.reply(200, gateway.internal(self.headers.get("Authorization"), internal[1], internal[2], json.loads(self.rfile.read(length))))
            terminal = gateway.identity(self.headers.get("Authorization"))
            if self.command == "POST":
                if self.headers.get("Transfer-Encoding") or len(self.headers.get_all("Content-Length", [])) != 1:
                    raise Denied(411, "single Content-Length required")
                length = int(self.headers["Content-Length"])
                if self.path == "/v1/uploads":
                    return self.reply(201, gateway.upload(terminal, self.rfile, length))
                if self.path == "/v1/events":
                    if not 0 < length <= 4096:
                        raise Denied(413, "event exceeds limit")
                    request = json.loads(self.rfile.read(length))
                    return self.reply(202, gateway.event(terminal, request))
                if self.path == "/v1/compute":
                    if not 0 < length <= 4096:
                        raise Denied(413, "compute request exceeds limit")
                    return self.reply(202, gateway.compute(terminal, json.loads(self.rfile.read(length))))
            elif self.path.startswith("/v1/executions/"):
                return self.reply(200, gateway.result(terminal, self.path.removeprefix("/v1/executions/")))
            raise Denied(404, "route not found")
        except Denied as error:
            self.reply(error.status, {"error": error.message})
        except (ValueError, TypeError, KeyError):
            self.reply(400, {"error": "invalid request"})
        except ClientError as error:
            code = error.response.get("Error", {}).get("Code")
            self.reply(404 if code in ("404", "NoSuchKey") else 502, {"error": "object unavailable"})
        except (socket.timeout, TimeoutError):
            self.reply(408, {"error": "request timed out"})
        except Exception:
            self.reply(502, {"error": "gateway dependency unavailable"})

    do_GET = process
    do_POST = process


if __name__ == "__main__":
    with open(os.environ.get("GATEWAY_CONFIG", "/run/secrets/gateway.json")) as file:
        config = json.load(file)
    server = ThreadingHTTPServer(("0.0.0.0", 8080), Handler)
    server.gateway = Gateway(config)
    server.serve_forever()
