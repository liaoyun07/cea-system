"""Independent offload protocol and state. No workflow objects or APIs."""
import json
import math
import queue
import random
import threading
import time
from contextlib import contextmanager

TERMINAL = {"SUCCESS", "FAILED", "CANCELLED"}
SCHEMA = "offload-five-v1"


def trace(seed, terminal, seconds, interval, sizes, weights):
    arrivals = random.Random(f"{seed}:{terminal}:arrivals")
    files = random.Random(f"{seed}:{terminal}:files")
    result, offset = [], 0.0
    while True:
        offset += arrivals.expovariate(1 / interval)
        if offset >= seconds:
            return result
        result.append({"offset": offset, "size": files.choices(sizes, weights=weights, k=1)[0]})


def state_vector(size, local, upload_wait, edge, cloud):
    values = [size, local, upload_wait, edge, cloud]
    if any(not math.isfinite(v) or v < 0 for v in values):
        raise ValueError("five nonnegative state values required")
    # MB for workload; seconds for waiting. Fixed schema, identical in training/inference.
    return [math.log1p(v if i == 2 else v / 1_000_000) for i, v in enumerate(values)]


def choose(strategy, task, raw, model=None):
    if strategy == "LOCAL":
        return "TERMINAL"
    if strategy == "RANDOM":
        return random.Random(f'{task["seed"]}:{task["terminal"]}:{task["index"]}:action').choice(["TERMINAL", "EDGE", "CLOUD"])
    if strategy != "DQN" or not model or model.get("stateSchema") != SCHEMA:
        raise ValueError("five-state trained model required for DQN")
    if (not model["weights1"] or len(model["bias1"]) != len(model["weights1"])
            or any(len(row) != 5 for row in model["weights1"])
            or len(model["weights2"]) != 3 or len(model["bias2"]) != 3
            or any(len(row) != len(model["weights1"]) for row in model["weights2"])):
        raise ValueError("invalid five-state model shape")
    state = state_vector(*raw)
    hidden = [max(0, b + sum(w * x for w, x in zip(row, state)))
              for row, b in zip(model["weights1"], model["bias1"])]
    q = [b + sum(w * x for w, x in zip(row, hidden)) for row, b in zip(model["weights2"], model["bias2"])]
    return ["TERMINAL", "EDGE", "CLOUD"][max(range(3), key=lambda i: q[i])]


class Ledger:
    def __init__(self):
        self.lock, self.items = threading.Lock(), {}

    def accept(self, key, size):
        with self.lock:
            self.items.setdefault(key, size)

    def finish(self, key):
        with self.lock:
            self.items.pop(key, None)

    def total(self):
        with self.lock:
            return sum(self.items.values())


class UploadLedger:
    """FIFO reservations include unsent bytes and per-destination added latency."""
    def __init__(self, rate):
        self.rate, self.lock, self.items = rate, threading.Lock(), {}

    def add(self, key, size, latency):
        with self.lock:
            self.items[key] = [size, latency, None]

    def sent(self, key, count):
        with self.lock:
            self.items[key][0] -= count

    def delaying(self, key):
        with self.lock:
            self.items[key][2] = time.monotonic() + self.items[key][1]

    def finish(self, key):
        with self.lock:
            self.items.pop(key, None)

    def wait(self):
        with self.lock:
            now = time.monotonic()
            return sum(v[0] / self.rate + (max(0, v[2] - now) if v[2] is not None else v[1]) for v in self.items.values())


class Store:
    """Small bounded SQL pool; no connection is held during HTTP/upload/execution."""
    def __init__(self, config):
        import pymysql
        self.pool = queue.Queue()
        for _ in range(3):
            self.pool.put(pymysql.connect(**config, autocommit=True, charset="utf8mb4",
                                         cursorclass=pymysql.cursors.DictCursor,
                                         connect_timeout=10, read_timeout=20, write_timeout=20))

    @contextmanager
    def connection(self):
        connection = self.pool.get(timeout=20)
        try:
            connection.ping(reconnect=True)
            yield connection
        finally:
            self.pool.put(connection)

    def sql(self, query, args=()):
        with self.connection() as connection, connection.cursor() as cursor:
            cursor.execute(query, args)
            return cursor.fetchall() if cursor.description else cursor.rowcount

    def initialize(self):
        self.sql("CREATE TABLE IF NOT EXISTS offlab_runs (id VARCHAR(64) PRIMARY KEY, payload JSON NOT NULL)")
        self.sql("CREATE TABLE IF NOT EXISTS offlab_tasks (id VARCHAR(100) PRIMARY KEY, run_id VARCHAR(64) NOT NULL, owner VARCHAR(64) NOT NULL, state VARCHAR(20) NOT NULL, payload JSON NOT NULL, INDEX(run_id), INDEX(owner,state))")
        self.sql("CREATE TABLE IF NOT EXISTS offlab_samples (id BIGINT AUTO_INCREMENT PRIMARY KEY, run_id VARCHAR(64), terminal_id VARCHAR(64) NOT NULL, sampled_at DOUBLE NOT NULL, payload JSON NOT NULL, INDEX(run_id,sampled_at))")

    def add(self, task):
        self.sql("INSERT INTO offlab_tasks(id,run_id,owner,state,payload) VALUES(%s,%s,%s,%s,%s)",
                 (task["id"], task["runId"], task["owner"], task["state"], json.dumps(task)))

    def patch(self, key, values):
        args, expressions = [], []
        for name, value in values.items():
            expressions.append("%s,CAST(%s AS JSON)")
            args.extend(["$." + name, json.dumps(value)])
        state = ",state=%s" if "state" in values else ""
        if state:
            args.append(values["state"])
        self.sql("UPDATE offlab_tasks SET payload=JSON_SET(payload," + ",".join(expressions) + ")" + state + " WHERE id=%s", (*args, key))

    def task(self, key):
        rows = self.sql("SELECT payload FROM offlab_tasks WHERE id=%s", (key,))
        if not rows:
            raise KeyError(key)
        return json.loads(rows[0]["payload"])

    def tasks(self, run):
        return [json.loads(r["payload"]) for r in self.sql("SELECT payload FROM offlab_tasks WHERE run_id=%s ORDER BY id", (run,))]

    def run(self, key):
        return json.loads(self.sql("SELECT payload FROM offlab_runs WHERE id=%s", (key,))[0]["payload"])

    def save_run(self, value):
        self.sql("INSERT INTO offlab_runs(id,payload) VALUES(%s,%s) ON DUPLICATE KEY UPDATE payload=VALUES(payload)", (value["id"], json.dumps(value)))


def rpc(base, token, path, data=None, timeout=30):
    import requests
    response = requests.request("GET" if data is None else "POST", base.rstrip("/") + path,
                                json=data, headers={"Authorization": "Bearer " + token}, timeout=timeout)
    if not response.ok:
        raise RuntimeError(f"{path}: HTTP {response.status_code}: {response.text[:200]}")
    return response.json()
