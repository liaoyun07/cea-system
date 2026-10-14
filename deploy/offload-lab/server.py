import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import os
from pathlib import Path


def serve(config):
    if config["role"] == "terminal":
        from terminal import Terminal
        service = Terminal(config)
    elif config["role"] == "controller":
        from controller import Controller
        service = Controller(config)
    else:
        from node import Node
        service = Node(config)

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.dispatch("GET")

        def do_POST(self):
            self.dispatch("POST")

        def dispatch(self, method):
            code = 200
            try:
                if self.path == "/health":
                    result = {"status": "UP", "role": config["role"]}
                elif not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + config["token"]):
                    code, result = 401, {"error": "unauthorized"}
                else:
                    length = int(self.headers.get("Content-Length", 0))
                    data = json.loads(self.rfile.read(length)) if length else None
                    result = service.handle(method, self.path, data)
            except (ValueError, KeyError) as error:
                code, result = 400, {"error": str(error)}
            except Exception as error:
                logging.exception("request failed: %s", self.path)
                code, result = 500, {"error": type(error).__name__}
            raw = json.dumps(result, allow_nan=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def log_message(self, *args):
            pass

    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()


if __name__ == "__main__":
    serve(json.loads(Path(os.environ.get("CONFIG", "/run/secrets/config.json")).read_text()))
