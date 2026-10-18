"""Pure decisions shared by the controller and evidence tests."""
import math

ONLINE = "sandbox.users.io/online"
APP = "elastic.cea.io/app"


def alive(obj):
    return not obj["metadata"].get("deletionTimestamp")


def ready(pod):
    return alive(pod) and any(c["type"] == "Ready" and c["status"] == "True"
                              for c in pod.get("status", {}).get("conditions", []))


def online(pod):
    return pod["metadata"].get("labels", {}).get(ONLINE) == "true"


def identity(pod):
    return {"uid": pod["metadata"]["uid"], "containers": sorted(
        c.get("containerID", "") for c in pod.get("status", {}).get("containerStatuses", []))}


def allocate(apps, demand, memory_budget, count_budget, per_app=2):
    """Rank by recent positive replica demand * saved seconds / reserved MiB."""
    result = {name: 0 for name in apps}
    scores = {name: demand.get(name, 0) * max(0, app["coldSeconds"] - 1) / app["memoryMiB"]
              for name, app in apps.items()}
    for name in sorted(apps, key=lambda n: (-scores[n], n)):
        if scores[name] <= 0:
            continue
        count = min(per_app, count_budget, int(memory_budget // apps[name]["memoryMiB"]))
        result[name] = count
        count_budget -= count
        memory_budget -= count * apps[name]["memoryMiB"]
    return result, scores


def slots(name, replicas):
    return {f"{name}-{i:03d}" for i in range(replicas)}


def reconcile_names(name, replicas, claims):
    """Deleting names remain occupied until the API actually removes them."""
    desired = slots(name, replicas)
    existing = {c["metadata"]["name"] for c in claims}
    return sorted(desired - existing), [c for c in claims if alive(c) and c["metadata"]["name"] not in desired]


def quantity(value):
    for suffix, factor in [("Ei", 2**60), ("Pi", 2**50), ("Ti", 2**40),
                           ("Gi", 2**30), ("Mi", 2**20), ("Ki", 2**10),
                           ("E", 1e18), ("P", 1e15), ("T", 1e12),
                           ("G", 1e9), ("M", 1e6), ("k", 1e3),
                           ("n", 1e-9), ("u", 1e-6), ("m", 1e-3)]:
        if value.endswith(suffix):
            return float(value[:-len(suffix)]) * factor
    return float(value)


def percentile(values, p):
    if not values:
        return None
    values = sorted(values)
    return values[max(0, math.ceil(len(values) * p) - 1)]
