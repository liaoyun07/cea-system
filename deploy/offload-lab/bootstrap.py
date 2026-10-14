"""Run only inside the existing simulation DinD, with an explicitly approved config."""
import json
from pathlib import Path
import docker

root = Path("/sim/offload-lab")
settings = json.loads((root / "bootstrap.json").read_text())
client = docker.from_env()
parent = Path("/sys/fs/cgroup/cea-offload-lab")
parent.mkdir(exist_ok=True)
(parent / "cgroup.subtree_control").write_text("+cpu +memory +pids")
for terminal in settings["terminals"]:
    name = terminal["id"]
    if client.containers.list(all=True, filters={"name": "^/" + name + "$"}):
        raise RuntimeError(name + " already exists; do not recreate an active terminal")
    group = parent / name
    group.mkdir(exist_ok=True)
    (group / "cgroup.subtree_control").write_text("+cpu +memory +pids")
    (group / "cpu.max").write_text(f'{round(settings["cpu"] * 100000)} 100000')
    (group / "memory.max").write_text(str(settings["memoryMiB"] * 1048576))
    (group / "memory.swap.max").write_text("0")
    work = root / "work" / name
    work.mkdir(parents=True, exist_ok=True)
    client.containers.run(settings["image"], name=name, detach=True,
        labels={"cea.offload-lab": "terminal"}, cgroup_parent="cea-offload-lab/" + name,
        cap_drop=["ALL"], security_opt=["no-new-privileges"], read_only=True,
        ports={"8080/tcp": ("0.0.0.0", terminal["port"])}, extra_hosts=settings["hosts"],
        volumes={str(root / "terminals" / (name + ".json")): {"bind": "/run/secrets/config.json", "mode": "ro"},
                 "/sim/data": {"bind": "/data", "mode": "ro"}, str(work): {"bind": str(work), "mode": "rw"},
                 str(group): {"bind": "/terminal-resource", "mode": "ro"},
                 "/var/run/docker.sock": {"bind": "/var/run/docker.sock", "mode": "rw"}},
        tmpfs={"/tmp": "size=16m,mode=1777"}, log_config=docker.types.LogConfig(type="json-file", config={"max-size": "5m", "max-file": "2"}))
print(json.dumps({"created": len(settings["terminals"]), "cpuEach": settings["cpu"], "memoryMiBEach": settings["memoryMiB"]}))
