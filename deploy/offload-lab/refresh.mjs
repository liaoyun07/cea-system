// Update only this batch's idle services, terminal agents and dedicated worker image.
import assert from 'node:assert/strict';
import { folder, docker, read } from './setup.mjs';
const token = read(`${folder}/secrets.json`).token;
const response = await fetch('http://127.0.0.1:18195/runs', { headers: { Authorization: 'Bearer ' + token } });
assert(response.ok);
assert((await response.json()).every(r => !['SENDING', 'DRAINING'].includes(r.state)), 'drain the experiment before updating');
const clusters = ['cloud', 'edge-a', 'edge-b', 'edge-c'];
for (const c of clusters) {
  const jobs = JSON.parse(docker(['exec', `cea-${c}-1`, 'kubectl', '-n', read(`${folder}/${c}.json`).execution.namespace, 'get', 'jobs', '-l', 'cea.offload-lab=true', '-o', 'json'])).items;
  assert(jobs.every(j => (j.status?.conditions || []).some(x => ['Complete', 'Failed'].includes(x.type) && x.status === 'True')), `${c}: active Job`);
}
for (const [image, file] of [['cea/offload-lab:independent-v1', 'runtime'], ['cea/offload-worker:independent-v1', 'worker']]) {
  docker(['save', '-o', `${folder}/${file}.tar`, image]);
  docker(['exec', 'cea-terminal-load-engine', 'docker', 'load', '-i', `/sim/offload-lab/${file}.tar`]);
}
for (const c of clusters) {
  docker(['cp', `${folder}/worker.tar`, `cea-${c}-1:/tmp/offlab-worker.tar`]);
  docker(['exec', `cea-${c}-1`, 'ctr', '--address', '/run/k3s/containerd/containerd.sock', '--namespace', 'k8s.io', 'images', 'import', '/tmp/offlab-worker.tar']);
  docker(['exec', `cea-${c}-1`, 'rm', '/tmp/offlab-worker.tar']);
}
docker(['compose', '-f', `${folder}/compose.json`, 'up', '-d']);
// Recreation can change Docker IPs, so rebuild only this lab's terminal host map.
const bootstrap = read(`${folder}/bootstrap.json`);
for (const c of [...clusters, 'controller']) bootstrap.hosts[`offlab-${c}`] = JSON.parse(docker(['inspect', `cea-offlab-${c}`]))[0].NetworkSettings.Networks.cea_default.IPAddress;
const { writeFileSync } = await import('node:fs');
writeFileSync(`${folder}/bootstrap.json`, JSON.stringify(bootstrap, null, 2));
for (const script of ['refresh_terminals.py', 'bootstrap.py']) docker(['exec', 'cea-terminal-load-engine', 'docker', 'run', '--rm', '--privileged', '--cgroupns=host',
  '-v', '/sys/fs/cgroup:/sys/fs/cgroup', '-v', '/var/run/docker.sock:/var/run/docker.sock', '-v', '/sim:/sim', 'cea/offload-lab:independent-v1', 'python', '-B', '/app/' + script]);
console.log('Updated this idle lab only; old terminals, gateways, workflows and records untouched.');
