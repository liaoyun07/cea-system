"""Small, namespace-bound Kubernetes REST client; no platform database calls."""
import json
import os
import ssl
import time
import urllib.request
from datetime import datetime, timezone

GROUP = "elastic.cea.io/v1alpha1"
EXT_GROUP = "extensions.agents.x-k8s.io/v1beta1"
NS = os.environ.get("POD_NAMESPACE", "cea-hpa-warm-20261016")
BASE = f"/api/v1/namespaces/{NS}"
APPS = f"/apis/apps/v1/namespaces/{NS}"
EXT = f"/apis/{EXT_GROUP}/namespaces/{NS}"
WARM = f"/apis/{GROUP}/namespaces/{NS}"
HPA = f"/apis/autoscaling/v2/namespaces/{NS}"


class Kube:
    def __init__(self):
        folder = "/var/run/secrets/kubernetes.io/serviceaccount/"
        self.token_path = folder + "token"
        self.tls = ssl.create_default_context(cafile=folder + "ca.crt")
        self.host = "https://" + os.environ["KUBERNETES_SERVICE_HOST"] + ":" + os.environ["KUBERNETES_SERVICE_PORT"]

    def call(self, path, method="GET", body=None):
        with open(self.token_path) as f:
            token = f.read().strip()
        headers = {"Authorization": "Bearer " + token}
        if body is not None:
            headers["Content-Type"] = "application/merge-patch+json" if method == "PATCH" else "application/json"
        request = urllib.request.Request(self.host + path, None if body is None else json.dumps(body).encode(), headers, method=method)
        with urllib.request.urlopen(request, context=self.tls, timeout=10) as response:
            content = response.read()
            return json.loads(content) if content else None

    def items(self, path):
        return self.call(path)["items"]


def emit(event, **data):
    line = json.dumps({"event": event, "at": datetime.now(timezone.utc).isoformat(),
                       "mono": time.monotonic(), **data})
    if os.environ.get("TRACE_FILE"):
        with open(os.environ["TRACE_FILE"], "a", encoding="utf-8") as output:
            output.write(line + "\n")
    if event not in ("snapshot", "metrics") or not os.environ.get("TRACE_FILE"):
        print(line, flush=True)
