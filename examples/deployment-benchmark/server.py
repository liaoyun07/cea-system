"""Bounded, isolated HTTP deployment samples; no platform execution or timing SDK.

Only administrator-bundled models are loaded. Readiness becomes reachable after
loading and real inference warmup; an invalid model fails startup instead.
"""
import io
import json
import math
import os
import zipfile
from http.server import BaseHTTPRequestHandler, HTTPServer

LIMIT = 16 * 1024 * 1024


class Engine:
    def __init__(self, kind):
        self.kind = kind
        if kind == "signal":
            from signal_algorithm import features
            self.features = features
            self.path, self.content_type = "/analyze", "application/json"
            self.process(b'{"samples":[0,1,-1]}')
        elif kind == "bearing":
            import joblib
            import numpy as np
            from edge_algorithm import features
            self.np, self.features = np, features
            self.model = joblib.load("/app/model.joblib")
            self.path, self.content_type = "/predict", "application/octet-stream"
            result = self.model.predict_proba(features(np.sin(np.arange(2048)[None, :] * .1)))
            if not np.isfinite(result).all():
                raise ValueError("invalid model warmup")
        elif kind == "surface":
            import torch
            from PIL import Image
            from edge_algorithm import backbone, anomaly
            torch.set_num_threads(1)
            self.state = torch.load("/app/model.pt", map_location="cpu", weights_only=False)
            self.network = backbone()
            self.network.load_state_dict(self.state["backbone"])
            self.anomaly = anomaly
            self.path, self.content_type = "/inspect", "image/png"
            raw = io.BytesIO()
            Image.new("RGB", (128, 128), (128, 128, 128)).save(raw, format="PNG")
            self.process(raw.getvalue())
        else:
            raise ValueError("unknown service kind")

    def process(self, raw):
        if self.kind == "signal":
            document = json.loads(raw)
            samples = document.get("samples") if isinstance(document, dict) else None
            if not isinstance(samples, list) or not 1 <= len(samples) <= 131072:
                raise ValueError("expected 1..131072 samples")
            if any(type(value) not in (int, float) or not math.isfinite(value) for value in samples):
                raise ValueError("finite numeric samples required")
            return self.features(samples)
        if self.kind == "bearing":
            np = self.np
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                if len(archive.infolist()) > 8 or sum(x.file_size for x in archive.infolist()) > 32 * 1024 * 1024:
                    raise ValueError("sample archive exceeds limit")
            with np.load(io.BytesIO(raw), allow_pickle=False) as data:
                x = data["signal"]
                if int(data["sample_rate"]) != 12000 or not 1 <= len(x) <= 1000:
                    raise ValueError("expected 1..1000 windows, 12kHz")
                probabilities = self.model.predict_proba(self.features(x))
            labels = self.model.classes_[probabilities.argmax(axis=1)]
            return {"model": "cwru-fe-rf-v1",
                    "counts": {str(label): int(np.sum(labels == label)) for label in self.model.classes_},
                    "windows": [{"window": i, "class": str(label), "confidence": float(probabilities[i].max())}
                                for i, label in enumerate(labels)]}
        if not raw.startswith(b"\x89PNG\r\n\x1a\n") or len(raw) > 8 * 1024 * 1024:
            raise ValueError("bounded PNG required")
        score, heatmap = self.anomaly(self.network, self.state, raw)
        if not math.isfinite(score):
            raise ValueError("invalid inference result")
        return {"model": "tile-padim-r18-v1", "score": score,
                "defect": bool(score > self.state["threshold"]), "heatmap": heatmap.tolist()}


def make_server(engine, host="0.0.0.0", port=8080):
    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(15)

        def send_json(self, code, value):
            encoded = json.dumps(value, allow_nan=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def do_GET(self):
            if self.path == "/healthz":
                self.send_json(200, {"ready": True, "service": engine.kind})
            else:
                self.send_json(404, {"error": "not found"})

        def do_POST(self):
            if self.path != engine.path:
                return self.send_json(404, {"error": "not found"})
            if self.headers.get("Content-Type", "").split(";")[0].strip() != engine.content_type:
                return self.send_json(415, {"error": "unsupported content type"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                return self.send_json(400, {"error": "invalid content length"})
            if self.headers.get("Transfer-Encoding") or not 0 < length <= LIMIT:
                return self.send_json(413, {"error": "bounded content length required"})
            try:
                raw = self.rfile.read(length)
                if len(raw) != length:
                    raise ValueError("incomplete body")
                result = engine.process(raw)
                self.send_json(200, result)
            except (ValueError, TypeError, KeyError, OverflowError, EOFError, OSError, zipfile.BadZipFile):
                self.send_json(422, {"error": "invalid input"})

        def log_message(self, format, *args):
            pass

    return HTTPServer((host, port), Handler)


if __name__ == "__main__":
    engine = Engine(os.environ["SERVICE_KIND"])
    print(json.dumps({"service": engine.kind, "event": "model_ready_after_warmup"}), flush=True)
    make_server(engine).serve_forever()
