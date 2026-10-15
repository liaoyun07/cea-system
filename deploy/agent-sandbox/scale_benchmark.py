"""In-cluster Grafana scale-out benchmark; no platform API or old workload changes."""
import concurrent.futures
import copy
import json
import os
import ssl
import time
import traceback
import urllib.error
import urllib.request
from datetime import datetime, timezone
from statistics import mean, median

NS = os.environ.get("POD_NAMESPACE", "cea-warm-scale-20261016")
BASE = "/api/v1/namespaces/" + NS
EXT = "/apis/extensions.agents.x-k8s.io/v1beta1/namespaces/" + NS
APPS = "/apis/apps/v1/namespaces/" + NS
PLAN = json.load(open("/benchmark/plan.json")) if os.path.exists("/benchmark/plan.json") else {}
TOKEN = None
TLS = None


def stamp():
    return datetime.now(timezone.utc).isoformat()


def emit(event, **data):
    print(json.dumps({"event": event, "at": stamp(), **data}), flush=True)


def api(path, method="GET", body=None):
    data = None if body is None else json.dumps(body).encode()
    headers = {"Authorization": "Bearer " + TOKEN}
    if data is not None:
        headers["Content-Type"] = "application/merge-patch+json" if method == "PATCH" else "application/json"
    req = urllib.request.Request("https://" + os.environ["KUBERNETES_SERVICE_HOST"] + ":" + os.environ["KUBERNETES_SERVICE_PORT"] + path, data, headers, method=method)
    with urllib.request.urlopen(req, context=TLS, timeout=15) as response:
        raw = response.read()
        return json.loads(raw) if raw else None


def ready(pod):
    return not pod["metadata"].get("deletionTimestamp") and any(
        c["type"] == "Ready" and c["status"] == "True" for c in pod.get("status", {}).get("conditions", []))


def pods():
    return api(BASE + "/pods?labelSelector=app%3Dwarm-grafana")["items"]


def serving(pod):
    return pod["metadata"].get("labels", {}).get("sandbox.users.io/online") == "true"


def endpoint_names():
    return {address["targetRef"]["name"] for subset in api(BASE + "/endpoints/grafana").get("subsets", [])
            for address in subset.get("addresses", [])}


def http(address, path="/api/health"):
    if address == "grafana":
        address = os.environ["GRAFANA_SERVICE_HOST"]
    req = urllib.request.Request(f"http://{address}:3000{path}", headers={"Connection": "close"})
    with urllib.request.urlopen(req, timeout=2) as response:
        data = response.read()
        if path == "/api/health":
            health = json.loads(data)
            assert health["database"] == "ok"
            assert health["version"] == PLAN["grafanaVersion"]
        else:
            assert b"Grafana" in data
        return response.headers["X-Benchmark-Pod"]


def wait_for(description, check, timeout=180, interval=0.5):
    start = time.monotonic()
    while time.monotonic() - start < timeout:
        value = check()
        if value:
            return value
        time.sleep(interval)
    raise TimeoutError(description)


def base_http_ready(ip, name):
    try:
        return http(ip) == name and http("grafana") == name and http("grafana", "/login") == name
    except (urllib.error.URLError, TimeoutError):
        return False


def pool_size(n):
    return api(EXT + "/sandboxwarmpools/grafana-pool", "PATCH", {"spec": {"replicas": n}})


def clear():
    pool_size(0)
    for claim in api(EXT + "/sandboxclaims")["items"]:
        api(EXT + "/sandboxclaims/" + claim["metadata"]["name"], "DELETE", {})
    for dep in api(APPS + "/deployments")["items"]:
        assert dep["metadata"]["name"] == "grafana-base"
        api(APPS + "/deployments/grafana-base", "DELETE", {"propagationPolicy": "Foreground"})
    wait_for("All experiment application Pods removed", lambda: len(pods()) == 0)
    wait_for("Experiment Deployment removed", lambda: not api(APPS + "/deployments")["items"])
    assert endpoint_names() == set()


def create_base():
    pod_template = copy.deepcopy(PLAN["podTemplate"])
    pod_template["metadata"]["labels"].update({"benchmark-owner": "deployment", "sandbox.users.io/online": "true"})
    obj = {"apiVersion": "apps/v1", "kind": "Deployment", "metadata": {"name": "grafana-base", "namespace": NS},
           "spec": {"replicas": 1, "selector": {"matchLabels": {"benchmark-owner": "deployment"}}, "template": pod_template}}
    start = time.monotonic()
    api(APPS + "/deployments", "POST", obj)
    initial = wait_for("Base Grafana ready", lambda: (ps if len(ps := pods()) == 1 and ready(ps[0]) else None))
    name = initial[0]["metadata"]["name"]
    wait_for("Base Service endpoint ready", lambda: endpoint_names() == {name})
    wait_for("Initial Grafana dataplane available", lambda: base_http_ready(initial[0]["status"]["podIP"], name))
    return initial[0], time.monotonic() - start


def claim(i, trial):
    return api(EXT + "/sandboxclaims", "POST", {
        "apiVersion": "extensions.agents.x-k8s.io/v1beta1", "kind": "SandboxClaim",
        "metadata": {"name": f"{trial}-claim-{i}", "namespace": NS},
        "spec": {"warmPoolRef": {"name": "grafana-pool"}, "lifecycle": {"shutdownPolicy": "Delete"},
                 "additionalPodMetadata": {"labels": {"sandbox.users.io/online": "true"}}}})


def pod_identity(pod):
    c = pod["status"]["containerStatuses"][0]
    return {"name": pod["metadata"]["name"], "uid": pod["metadata"]["uid"], "containerId": c["containerID"],
            "startedAt": c["state"]["running"]["startedAt"], "imageId": c["imageID"], "restartCount": c["restartCount"]}


def quantity(value):
    for suffix, multiplier in [("Ki", 1024), ("Mi", 1024 ** 2), ("Gi", 1024 ** 3), ("n", 1e-9), ("u", 1e-6), ("m", 1e-3)]:
        if value.endswith(suffix):
            return float(value[:-len(suffix)]) * multiplier
    return float(value)


def resource_sample(names):
    metrics = api("/apis/metrics.k8s.io/v1beta1/namespaces/" + NS + "/pods")["items"]
    selected = [p for p in metrics if p["metadata"]["name"] in names]
    return {"observedAt": stamp(), "complete": len(selected) == len(names), "pods": selected,
            "cpuCores": sum(quantity(c["usage"]["cpu"]) for p in selected for c in p["containers"]),
            "memoryMiB": sum(quantity(c["usage"]["memory"]) for p in selected for c in p["containers"]) / 1024 ** 2}


def trial(index, mode, extra=2, formal=True):
    label = f"t{index:02d}-{mode.lower()}"
    row = {"trial": label, "mode": mode, "extra": extra, "formal": formal, "status": "RUNNING"}
    emit("trial-start", trial=label, mode=mode, extra=extra)
    try:
        clear()
        base, row["initialBaseSeconds"] = create_base()
        inventory = []
        if mode in ("WARM", "OVERFLOW"):
            start_pool = time.monotonic()
            pool_size(2)
            inventory = wait_for("Two reserve Grafana instances ready", lambda: (ps if len(ps := [p for p in pods() if not serving(p)]) == 2 and all(map(ready, ps)) else None))
            for p in inventory:
                assert http(p["status"]["podIP"]) == p["metadata"]["name"]
            row["poolPreparationSeconds"] = time.monotonic() - start_pool
        assert endpoint_names() == {base["metadata"]["name"]}
        # Both groups have the same quiet interval before the measured request.
        time.sleep(10)
        if inventory:
            row["reserveResources"] = resource_sample({p["metadata"]["name"] for p in inventory})
        before_ids = {p["metadata"]["uid"]: pod_identity(p) for p in inventory}
        row["base"] = pod_identity(base)
        row["reserveBefore"] = list(before_ids.values())
        row["requestAt"] = stamp()
        start = time.monotonic()
        if mode == "DEPLOYMENT":
            api(APPS + "/deployments/grafana-base", "PATCH", {"spec": {"replicas": 1 + extra}})
        else:
            with concurrent.futures.ThreadPoolExecutor(max_workers=extra) as workers:
                list(workers.map(lambda i: claim(i, label), range(extra)))
        row["ackSeconds"] = time.monotonic() - start
        pool_restored = None
        service_seen = set()
        direct_ok = set()
        all_ready_at = None
        probe_errors = []
        while time.monotonic() - start < 180:
            current = pods()
            active = [p for p in current if serving(p) and ready(p)]
            targets = [p for p in active if p["metadata"]["uid"] != base["metadata"]["uid"]]
            reserves = [p for p in current if not serving(p) and ready(p) and p["metadata"]["uid"] not in before_ids]
            if inventory and len(reserves) == 2 and pool_restored is None:
                pool_restored = time.monotonic() - start
            if len(active) == extra + 1 and len(targets) == extra:
                names = {p["metadata"]["name"] for p in targets}
                if endpoint_names() == names | {base["metadata"]["name"]}:
                    if all_ready_at is None:
                        all_ready_at = time.monotonic() - start
                    try:
                        for p in targets:
                            name = p["metadata"]["name"]
                            if name not in direct_ok:
                                assert http(p["status"]["podIP"]) == name
                                direct_ok.add(name)
                        # New connections through ClusterIP, with actual responder identification.
                        for _ in range(6):
                            service_seen.add(http("grafana"))
                            if names <= service_seen:
                                break
                        if names <= service_seen and names <= direct_ok:
                            row["durationSeconds"] = time.monotonic() - start
                            row["completedAt"] = stamp()
                            break
                    except (urllib.error.URLError, TimeoutError, AssertionError) as exc:
                        probe_errors.append({"elapsed": time.monotonic() - start, "error": str(exc)})
            time.sleep(0.1)
        else:
            raise TimeoutError("All new instances Ready, in Service, and individually responding via ClusterIP")
        # Detailed checks and diagnostics are outside the measured interval.
        row["allReadyAndEndpointsSeconds"] = all_ready_at
        row["directVerified"] = sorted(direct_ok)
        row["serviceResponders"] = sorted(service_seen)
        row["probeErrors"] = probe_errors
        row["targets"] = [pod_identity(p) for p in targets]
        reused = [p for p in targets if p["metadata"]["uid"] in before_ids]
        assert len(reused) == (2 if inventory else 0), "Unexpected warm reuse count"
        for p in reused:
            assert pod_identity(p) == before_ids[p["metadata"]["uid"]], "Warm container restarted"
        for p in targets:
            assert p["status"]["containerStatuses"][0]["restartCount"] == 0
            for key in ["image", "resources", "env", "readinessProbe", "securityContext", "volumeMounts"]:
                assert p["spec"]["containers"][0][key] == base["spec"]["containers"][0][key], f"Pod template differs: {key}"
        row["reusedCount"] = len(reused)
        if inventory:
            if pool_restored is None:
                wait_for("Pool replenished", lambda: len([p for p in pods() if not serving(p) and ready(p)]) == 2)
                pool_restored = time.monotonic() - start
            row["poolRestoredFromRequestSeconds"] = pool_restored
            row["refillAfterServingSeconds"] = max(0, pool_restored - row["durationSeconds"])
        target_uids = {p["metadata"]["uid"] for p in targets}
        row["events"] = [e for e in api(BASE + "/events")["items"] if e.get("involvedObject", {}).get("uid") in target_uids]
        row["status"] = "PASS"
        emit("trial-result", row=row)
        clear()
        return row
    except Exception as exc:
        row.update(status="FAILED", error=str(exc), traceback=traceback.format_exc())
        emit("trial-result", row=row)
        raise


def summarize(rows):
    result = {}
    for mode in ["DEPLOYMENT", "WARM"]:
        samples = [r["durationSeconds"] for r in rows if r["mode"] == mode and r["formal"] and r["status"] == "PASS"]
        assert len(samples) == 10
        result[mode] = {"count": len(samples), "meanSeconds": mean(samples), "medianSeconds": median(samples), "minSeconds": min(samples), "maxSeconds": max(samples)}
    baseline, warm = result["DEPLOYMENT"]["meanSeconds"], result["WARM"]["meanSeconds"]
    result["latencyReductionPercent"] = (1 - warm / baseline) * 100
    result["efficiencyIncreasePercent"] = (baseline / warm - 1) * 100
    result["efficiencyTarget20Passed"] = result["efficiencyIncreasePercent"] >= 20
    return result


def main():
    global TOKEN, TLS
    TOKEN = open("/var/run/secrets/kubernetes.io/serviceaccount/token").read().strip()
    TLS = ssl.create_default_context(cafile="/var/run/secrets/kubernetes.io/serviceaccount/ca.crt")
    checkpoint = json.load(open("/benchmark/checkpoint.json")) if os.path.exists("/benchmark/checkpoint.json") else None
    rows = checkpoint["rows"] if checkpoint else []
    emit("start", plan=PLAN)
    try:
        if not checkpoint:
            clear()
            _, initial_seconds = create_base()  # Pull/cache the fixed image before any formal measurement.
            emit("image-preparation-complete", seconds=initial_seconds)
            clear()
        else:
            assert "requestAt" not in checkpoint["failedPreparation"], "Never repeat a timed trial"
            emit("continue-after-preparation", completed=len(rows))
        next_index = 0
        for pair in range(10):
            for mode in (["DEPLOYMENT", "WARM"] if pair % 2 == 0 else ["WARM", "DEPLOYMENT"]):
                next_index += 1
                if next_index > len(rows):
                    rows.append(trial(next_index, mode))
        rows.append(trial(21, "EMPTY", formal=False))
        rows.append(trial(22, "OVERFLOW", extra=4, formal=False))
        emit("reserve-observation-start")
        create_base()
        pool_size(2)
        reserves = wait_for("Reserve observation ready", lambda: (ps if len(ps := [p for p in pods() if not serving(p)]) == 2 and all(map(ready, ps)) else None))
        names = {p["metadata"]["name"] for p in reserves}
        time.sleep(30)
        idle_samples = []
        for i in range(3):
            if i:
                time.sleep(15)
            sample = resource_sample(names)
            assert sample["complete"]
            idle_samples.append(sample)
        clear()
        emit("complete", summary=summarize(rows), rows=rows, reserveIdleSamples=idle_samples)
    except Exception:
        emit("failure", traceback=traceback.format_exc())
        raise


if __name__ == "__main__":
    main()
