"""Explicit deployment-only additive SQL migration. Runtime account owns only new tables."""
import json
from pathlib import Path
from core import Store

config = json.loads(Path("/setup/database.json").read_text())
store = Store(config["administrator"])
store.initialize()
user = config["runtime"]
store.sql("CREATE USER IF NOT EXISTS %s@%s IDENTIFIED BY %s", ("cea_offlab", "%", user["password"]))
for table in ("offlab_runs", "offlab_tasks", "offlab_samples"):
    store.sql(f"GRANT SELECT,INSERT,UPDATE ON cea.{table} TO %s@%s", ("cea_offlab", "%"))
print("offlab tables initialized; existing tables unchanged")
