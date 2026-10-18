"""Namespace-scoped platform WarmService controller; native HPA owns spec.replicas."""
import concurrent.futures
import statistics
import time
import urllib.error
from collections import defaultdict, deque
from datetime import datetime

from core import APP, ONLINE, alive, allocate, online, quantity, ready, reconcile_names
from kube import BASE, EXT, EXT_GROUP, GROUP, NS, WARM, Kube, emit

OWNER = "cea-system/owner"
POOL = "elastic.cea.io/pool"
SERVICE_UID = "sandbox.users.io/service-uid"


def managed(obj):
    return obj["metadata"].get("labels", {}).get(OWNER) == "cea-system"


def claim(service, name):
    meta = service["metadata"]
    return {"apiVersion": EXT_GROUP, "kind": "SandboxClaim",
            "metadata": {"name": name, "namespace": NS,
                         "labels": {OWNER: "cea-system", APP: meta["name"], SERVICE_UID: meta["uid"]},
                         "ownerReferences": [{"apiVersion": GROUP, "kind": "WarmService", "name": meta["name"],
                                              "uid": meta["uid"], "controller": True}]},
            "spec": {"warmPoolRef": {"name": service["spec"]["poolName"]},
                     "additionalPodMetadata": {"labels": {ONLINE: "true", SERVICE_UID: meta["uid"]}},
                     "lifecycle": {"shutdownPolicy": "DeleteForeground"}}}


def current_pods(service, pods):
    return [p for p in pods if alive(p) and online(p)
            and p["metadata"].get("labels", {}).get(SERVICE_UID) == service["metadata"]["uid"]
            and p["metadata"].get("labels", {}).get(POOL) == service["spec"]["poolName"]]


def cold_seconds(pod):
    condition = next((c for c in pod.get("status", {}).get("conditions", [])
                      if c["type"] == "Ready" and c["status"] == "True"), None)
    if not condition or not alive(pod):
        return None
    parse = lambda s: datetime.fromisoformat(s.replace("Z", "+00:00"))
    return max(0, (parse(condition["lastTransitionTime"]) - parse(pod["metadata"]["creationTimestamp"])).total_seconds())


class Adapter:
    def __init__(self, kube):
        self.k = kube
        self.last = {}
        self.demand = defaultdict(deque)
        self.cold = defaultdict(lambda: deque(maxlen=20))
        self.seen = set()
        self.targets = {}
        self.policy_at = 0
        self.workers = concurrent.futures.ThreadPoolExecutor(max_workers=8)

    def services(self, services, claims, pods):
        now = time.monotonic()
        for svc in services:
            if not alive(svc):
                continue
            name, uid, pool = svc["metadata"]["name"], svc["metadata"]["uid"], svc["spec"]["poolName"]
            target = svc["spec"]["replicas"]
            previous = self.last.get(uid, target)
            if target > previous:
                self.demand[uid].append((now, target - previous))
            self.last[uid] = target
            owned = [c for c in claims if c["metadata"].get("labels", {}).get(SERVICE_UID) == uid]
            create, remove = reconcile_names(name, target, owned)
            remove += [c for c in owned if alive(c) and c not in remove and c["spec"]["warmPoolRef"]["name"] != pool]
            work = [self.workers.submit(self.k.call, EXT + "/sandboxclaims", "POST", claim(svc, n)) for n in create]
            work += [self.workers.submit(self.k.call, EXT + "/sandboxclaims/" + c["metadata"]["name"], "DELETE",
                                        {"propagationPolicy": "Foreground"}) for c in remove]
            for future in work:
                try:
                    future.result()
                except urllib.error.HTTPError as exc:
                    if exc.code not in (404, 409):
                        raise
            active = current_pods(svc, pods)
            selector = f"{SERVICE_UID}={uid},{POOL}={pool},{ONLINE}=true"
            status = {"replicas": len(active), "readyReplicas": sum(map(ready, active)),
                      "selector": selector, "observedGeneration": svc["metadata"]["generation"]}
            if status != svc.get("status"):
                self.k.call(WARM + "/warmservices/" + name + "/status", "PATCH", {"status": status})

    def policy(self, services, templates, pools, pods):
        now = time.monotonic()
        cfg = self.k.call(BASE + "/configmaps/cea-warm-settings")["data"]
        count_budget, memory_budget = int(cfg["count"]), int(cfg["memoryMiB"])
        apps, demand = {}, {}
        template_by_name = {t["metadata"]["name"]: t for t in templates}
        for svc in services:
            name, uid, pool = svc["metadata"]["name"], svc["metadata"]["uid"], svc["spec"]["poolName"]
            template = template_by_name.get(pool)
            if not alive(svc) or not template:
                continue
            for pod in pods:
                if pod["metadata"].get("labels", {}).get(POOL) != pool:
                    continue
                seconds = cold_seconds(pod)
                if seconds is not None and pod["metadata"]["uid"] not in self.seen:
                    self.seen.add(pod["metadata"]["uid"])
                    self.cold[pool].append(seconds)
            while self.demand[uid] and self.demand[uid][0][0] < now - 300:
                self.demand[uid].popleft()
            memory = sum(quantity(c["resources"]["limits"]["memory"]) / 2**20
                         for c in template["spec"]["podTemplate"]["spec"]["containers"])
            apps[pool] = {"memoryMiB": memory, "coldSeconds": statistics.median(self.cold[pool]) if self.cold[pool] else 0}
            demand[pool] = sum(n for _, n in self.demand[uid])
        # Recalculate every 30s. Current pod occupancy is checked on every reconcile.
        if now - self.policy_at >= 30 or set(apps) != set(self.targets):
            self.targets, scores = allocate(apps, demand, memory_budget, count_budget)
            emit("allocation", targets=self.targets, demand=demand, scores=scores)
            self.policy_at = now
        current = {p["metadata"]["name"]: p["spec"]["replicas"] for p in pools if p["metadata"]["name"] in apps}
        reduced = False
        for pool, replicas in current.items():
            target = self.targets.get(pool, 0)
            if replicas > target:
                self.k.call(EXT + "/sandboxwarmpools/" + pool, "PATCH", {"spec": {"replicas": target}})
                reduced = True
        if reduced:
            return
        occupied = {pool: max(current.get(pool, 0), sum(1 for p in pods
                    if p["metadata"].get("labels", {}).get(POOL) == pool and not online(p))) for pool in apps}
        free_count = count_budget - sum(occupied.values())
        free_memory = memory_budget - sum(n * apps[pool]["memoryMiB"] for pool, n in occupied.items())
        # Include obsolete/terminating standby pods from an update until physically gone.
        obsolete = [p for p in pods if not online(p) and p["metadata"].get("labels", {}).get(POOL) not in apps]
        free_count -= len(obsolete)
        free_memory -= sum(sum(quantity(c.get("resources", {}).get("limits", {}).get("memory", "0")) / 2**20
                               for c in p["spec"]["containers"]) for p in obsolete)
        for pool, target in self.targets.items():
            if pool not in current:
                continue
            cost = apps[pool]["memoryMiB"]
            add = min(max(0, target - current[pool]), max(0, free_count), max(0, int(free_memory // cost)))
            if add:
                self.k.call(EXT + "/sandboxwarmpools/" + pool, "PATCH", {"spec": {"replicas": current[pool] + add}})
                free_count -= add
                free_memory -= add * cost
        self.seen.intersection_update(p["metadata"]["uid"] for p in pods)

    def run(self):
        while True:
            started = time.monotonic()
            try:
                services = [s for s in self.k.items(WARM + "/warmservices") if managed(s)]
                claims = [s for s in self.k.items(EXT + "/sandboxclaims") if managed(s)]
                pods = self.k.items(BASE + "/pods?labelSelector=cea-system%2Fowner%3Dcea-system%2Celastic.cea.io%2Fpool")
                self.services(services, claims, pods)
                self.policy(services, self.k.items(EXT + "/sandboxtemplates"), self.k.items(EXT + "/sandboxwarmpools"), pods)
            except Exception as exc:
                emit("adapter-error", error=str(exc))
                time.sleep(2)
            time.sleep(max(0, 0.5 - (time.monotonic() - started)))


if __name__ == "__main__":
    Adapter(Kube()).run()
