"""Small HTTP service for local CEA deployment demos, not a public API server."""
import json
import math
import os
import signal
import socket
import statistics
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_BODY = 256 * 1024


def summarize(payload):
    values = payload.get("values") if isinstance(payload, dict) else None
    if not isinstance(values, list) or not 1 <= len(values) <= 10000:
        raise ValueError("values must contain 1..10000 numbers")
    if any(type(v) not in (int, float) or not math.isfinite(v) for v in values):
        raise ValueError("values must contain finite numbers, not strings or booleans")
    return {"count": len(values), "min": min(values), "max": max(values),
            "mean": statistics.fmean(values)}


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def reply(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/healthz":
            self.reply(200, {"status": "ok"})
        elif self.path == "/":
            self.reply(200, {"service": "cea-deployment-demo", "instance": socket.gethostname(),
                             "message": os.getenv("MESSAGE", "Hello CEA")})
        else:
            self.reply(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/statistics":
            self.reply(404, {"error": "not found"})
            return
        if self.headers.get_content_type() != "application/json":
            self.reply(415, {"error": "application/json required"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0:
                raise ValueError("Content-Length must be positive")
            if size > MAX_BODY:
                self.reply(413, {"error": "request exceeds 256 KiB"})
                return
            result = summarize(json.loads(self.rfile.read(size)))
        except (ValueError, OverflowError, TimeoutError) as error:
            self.reply(400, {"error": str(error)})
            return
        self.reply(200, result)


if __name__ == "__main__":
    def stop(*_):
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, stop)
    with ThreadingHTTPServer(("0.0.0.0", 8080), Handler) as server:
        print("CEA deployment demo listening on :8080", flush=True)
        server.serve_forever()
