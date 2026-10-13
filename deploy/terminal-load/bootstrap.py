"""Runs inside the dedicated simulator engine; creates only labelled simulator agents."""
import argparse
import json
from pathlib import Path
import docker

parser = argparse.ArgumentParser()
parser.add_argument("--root", default="/sim")
args = parser.parse_args()
root = Path(args.root)
config = json.loads((root / "bootstrap.json").read_text())
client = docker.DockerClient(base_url="unix:///var/run/docker.sock")
parent = Path("/sys/fs/cgroup/cea-terminal-load")
parent.mkdir(exist_ok=True)
(parent / "cgroup.subtree_control").write_text("+cpu +memory +pids")
for item in config["terminals"]:
    name = item["id"]
    group = parent / name
    group.mkdir(exist_ok=True)
    (group / "cgroup.subtree_control").write_text("+cpu +memory +pids")
    (group / "cpu.max").write_text(f'{round(config["cpu"] * 100000)} 100000')
    (group / "memory.max").write_text(str(config["memoryMiB"] * 1048576))
    (group / "memory.swap.max").write_text("0")
    agent_config = root / "agents" / (name + ".json")
    state, work = root / "state" / name, root / "work" / name
    state.mkdir(parents=True, exist_ok=True)
    work.mkdir(parents=True, exist_ok=True)
    try:
        existing = client.containers.get(name)
        if existing.labels.get("cea.simulator") != "terminal-load":
            raise RuntimeError("unexpected container owner")
        expected_hosts = sorted(f"{host}:{ip}" for host, ip in config["hosts"].items())
        if sorted(existing.attrs["HostConfig"].get("ExtraHosts") or []) != expected_hosts:
            active = [c for c in client.containers.list() if c.labels.get("com.project.cea.attempt")
                      and c.attrs["HostConfig"].get("CgroupParent") == str(group.relative_to("/sys/fs/cgroup"))]
            if active:
                raise RuntimeError("stop and drain this terminal before updating its network routes")
            existing.stop(timeout=10)
            existing.remove()
        else:
            existing.restart(timeout=10)
            continue
    except docker.errors.NotFound:
        pass
    client.containers.run(config["agentImage"], name=name, detach=True,
        labels={"cea.simulator": "terminal-load"}, cgroup_parent=str(group.relative_to("/sys/fs/cgroup")),
        cap_drop=["ALL"], security_opt=["no-new-privileges"], read_only=True,
        ports={"8080/tcp": ("0.0.0.0", item["port"])}, extra_hosts=config["hosts"],
        volumes={str(agent_config): {"bind": "/run/secrets/agent.json", "mode": "ro"},
                 str(root / "data"): {"bind": "/data", "mode": "ro"},
                 str(state): {"bind": "/state", "mode": "rw"},
                 str(work): {"bind": str(work), "mode": "rw"},
                 "/source": {"bind": "/source", "mode": "ro"},
                 str(group): {"bind": "/terminal-resource", "mode": "ro"},
                 "/var/run/docker.sock": {"bind": "/var/run/docker.sock", "mode": "rw"}},
        tmpfs={"/tmp": "size=64m,mode=1777"})
print(json.dumps({"terminals": len(config["terminals"]), "cpuEach": config["cpu"], "memoryMiBEach": config["memoryMiB"]}))
