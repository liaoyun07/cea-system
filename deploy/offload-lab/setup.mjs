// Explicit commands only; never auto-starts or rewrites old simulator configuration.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
export const root = resolve(import.meta.dirname, '../..');
export const folder = `${root}/.local/cea/terminal-load/offload-lab`;
export const read = path => JSON.parse(readFileSync(path, 'utf8'));
export const docker = args => {
  try { return execFileSync('docker', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) {
    let detail = String(error.stderr || '').slice(-2500);
    const credentials = [...Object.entries(env).filter(([k]) => /PASSWORD|TOKEN|SECRET/.test(k)).map(([, v]) => v),
      ...Object.values(existsSync(`${folder}/secrets.json`) ? read(`${folder}/secrets.json`) : {})];
    for (const value of credentials.filter(Boolean)) detail = detail.replaceAll(value, '[credential]');
    throw new Error(`Docker ${args[0]} failed: ${detail}`);
  }
};
const save = (name, data) => writeFileSync(`${folder}/${name}`, JSON.stringify(data, null, 2));
const env = Object.fromEntries(readFileSync(`${root}/deploy/cea/.env`, 'utf8').split(/\r?\n/).filter(l => /^[A-Z_0-9]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const cea = args => docker(['compose', '-p', 'cea', '--env-file', `${root}/deploy/cea/.env`, '-f', `${root}/deploy/cea/compose.yaml`, ...args]);
const ip = name => JSON.parse(docker(['inspect', name]))[0].NetworkSettings.Networks.cea_default.IPAddress;
const clusters = ['cloud', 'edge-a', 'edge-b', 'edge-c'];
const runtimeImage = 'cea/offload-lab:independent-v1', workerImage = 'cea/offload-worker:independent-v1';

async function prepare() {
  mkdirSync(`${folder}/terminals`, { recursive: true });
  assert(!existsSync(`${folder}/secrets.json`), 'configuration already prepared; do not rotate credentials');
  const headers = { Authorization: 'Basic ' + Buffer.from(`${env.BACKEND_USER}:${env.BACKEND_PASSWORD}`).toString('base64') };
  const flows = [];
  for (let offset = 0;; offset += 100) {
    const response = await fetch(`http://127.0.0.1:${env.CEA_API_PORT}/api/namespaces/lab/flows?limit=100&offset=${offset}`, { headers, signal: AbortSignal.timeout(20000) });
    assert(response.ok, 'cannot capture existing Flow inventory');
    const page = await response.json(); flows.push(...page); if (page.length < 100) break;
  }
  const names = docker(['ps', '--format', '{{.Names}}']).trim().split(/\s+/).filter(n => n.startsWith('cea-') && !n.startsWith('cea-ui-e2e-'));
  const servicesBefore = JSON.parse(docker(['inspect', ...names])).map(c => ({ name: c.Name, id: c.Id, image: c.Image, startedAt: c.State.StartedAt }));
  save('before.json', { at: new Date().toISOString(), services: servicesBefore, flows });
  const secret = { token: randomBytes(32).toString('hex'), sql: randomBytes(24).toString('hex'), storage: randomBytes(24).toString('hex') };
  save('secrets.json', secret);
  const database = { host: 'mysql', port: 3306, user: 'cea_offlab', password: secret.sql, database: 'cea' };
  save('database.json', { administrator: { ...database, user: 'root', password: env.MYSQL_ROOT_PASSWORD }, runtime: database });
  const services = {};
  for (const cluster of clusters) {
    const name = `offlab-${cluster}`, cloud = cluster === 'cloud';
    const bucket = cloud ? 'cea-artifacts' : `cea-artifacts-${cluster}`;
    const config = { role: cloud ? 'cloud' : 'gateway', id: cluster, token: secret.token, database,
      publicUrl: `http://${name}:8080`, cloudUrl: 'http://offlab-cloud:8080', slots: 2,
      storage: { endpoint: `${ip(cloud ? 'cea-minio-1' : 'cea-minio-' + cluster + '-1')}:9000`, bucket, accessKey: 'cea-offlab', secretKey: secret.storage },
      execution: { kubeconfig: `/kube/${cluster}.yaml`, namespace: 'cea-lab', image: workerImage,
        cpuPerJob: cloud ? 1 : .5, memory: '512Mi', taskTimeoutSeconds: 1800 } };
    save(`${cluster}.json`, config);
    save(`policy-${cluster}.json`, { Version: '2012-10-17', Statement: [
      { Effect: 'Allow', Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'], Resource: [`arn:aws:s3:::${bucket}/lab/offload-lab/*`] },
      { Effect: 'Allow', Action: ['s3:ListBucket'], Resource: [`arn:aws:s3:::${bucket}`], Condition: { StringLike: { 's3:prefix': ['lab/offload-lab/*'] } } },
    ] });
    services[name] = { image: runtimeImage, container_name: `cea-${name}`, cpus: .5, mem_limit: '192m', read_only: true,
      cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'], tmpfs: ['/tmp:size=8m'],
      volumes: [`${folder}/${cluster}.json:/run/secrets/config.json:ro`, `${root}/deploy/cea/secrets/backend/${cluster}.yaml:/kube/${cluster}.yaml:ro`],
      networks: { cea: { aliases: [name] } }, logging: { driver: 'json-file', options: { 'max-size': '5m', 'max-file': '2' } } };
  }
  const files = {};
  for (const [i, file] of read(`${root}/.local/cea/terminal-load/matrix/files.json`).entries()) {
    assert.equal(statSync(`${root}/.local/cea/terminal-load/data/${file.fileId}`).size, file.bytes);
    files[['small', 'medium', 'large'][i]] = { bytes: file.bytes, path: `/data/${file.fileId}`, hostPath: `/sim/data/${file.fileId}` };
  }
  const terminals = Array.from({ length: 30 }, (_, i) => ({ id: `oil-terminal-${String(i + 1).padStart(3, '0')}`,
    gateway: `edge-${['a', 'b', 'c'][Math.floor(i / 10)]}`, index: i, port: 20001 + i,
    url: `http://cea-terminal-load-engine:${20001 + i}` }));
  for (const t of terminals) save(`terminals/${t.id}.json`, { role: 'terminal', ...t, token: secret.token, files,
    gatewayUrl: `http://offlab-${t.gateway}:8080`, controllerUrl: 'http://offlab-controller:8080',
    image: workerImage, cgroupParent: `cea-offload-lab/${t.id}`, work: `/sim/offload-lab/work/${t.id}`,
    memory: '256m', resourceDirectory: '/terminal-resource', uploadBytesPerSecond: 12_500_000,
    latencySeconds: { EDGE: .01, CLOUD: .1 }, taskTimeoutSeconds: 1800 });
  save('controller.json', { role: 'controller', token: secret.token, database, terminals, nodes: clusters.map(c => `http://offlab-${c}:8080`) });
  services['offlab-controller'] = { ...services['offlab-cloud'], container_name: 'cea-offlab-controller',
    volumes: [`${folder}/controller.json:/run/secrets/config.json:ro`], ports: ['127.0.0.1:18195:8080'], networks: { cea: { aliases: ['offlab-controller'] } } };
  save('compose.json', { name: 'cea-offload-lab', services, networks: { cea: { external: true, name: 'cea_default' } } });
  save('bootstrap.json', { image: runtimeImage, cpu: .1, memoryMiB: 512, terminals, hosts: {} });
  writeFileSync(`${folder}/storage.env`, `OFFLAB_STORAGE_PASSWORD=${secret.storage}\n`);
  console.log('Prepared isolated configuration; no existing configuration or service changed.');
}

async function install() {
  assert(process.argv.includes('--approved-new-environment'), 'New environment and scoped storage permission approval required');
  assert(existsSync(`${folder}/bootstrap.json`), 'run prepare first');
  assert(!existsSync(`${folder}/installed.json`), 'already installed; do not replay installation');
  const { provisionKubernetes } = await import('./provision-kubernetes.mjs');
  await provisionKubernetes(folder, docker);
  // Additive schema backup; runtime grants are limited to the three new tables.
  const schema = docker(['exec', '-e', `MYSQL_PWD=${env.MYSQL_ROOT_PASSWORD}`, 'cea-mysql-1', 'mysqldump', '-uroot', '--no-data', 'cea']);
  if (!existsSync(`${folder}/before-schema.sql`)) writeFileSync(`${folder}/before-schema.sql`, schema);
  docker(['run', '--rm', '--network', 'cea_default', '-v', `${folder}:/setup:ro`, runtimeImage, 'python', '-B', '/app/initialize.py']);
  for (const cluster of clusters) {
    const minio = cluster === 'cloud' ? 'minio' : 'minio-' + cluster;
    cea(['run', '--rm', '--no-deps', '-v', `${folder}:/offlab:ro`, 'storage-tool', '-ec',
      `. /offlab/storage.env; mc alias set target http://${minio}:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; mc admin user add target cea-offlab "$OFFLAB_STORAGE_PASSWORD" >/dev/null; mc admin policy create target cea-offlab /offlab/policy-${cluster}.json >/dev/null; mc admin policy attach target cea-offlab --user cea-offlab >/dev/null`]);
  }
  docker(['save', '-o', `${folder}/runtime.tar`, runtimeImage]);
  docker(['save', '-o', `${folder}/worker.tar`, workerImage]);
  docker(['exec', 'cea-terminal-load-engine', 'docker', 'load', '-i', '/sim/offload-lab/runtime.tar']);
  docker(['exec', 'cea-terminal-load-engine', 'docker', 'load', '-i', '/sim/offload-lab/worker.tar']);
  for (const cluster of clusters) {
    docker(['cp', `${folder}/worker.tar`, `cea-${cluster}-1:/tmp/offlab-worker.tar`]);
    docker(['exec', `cea-${cluster}-1`, 'ctr', '--address', '/run/k3s/containerd/containerd.sock', '--namespace', 'k8s.io', 'images', 'import', '/tmp/offlab-worker.tar']);
    // This is only the exact tar copied above, not existing cached images or data.
    docker(['exec', `cea-${cluster}-1`, 'rm', '/tmp/offlab-worker.tar']);
  }
  docker(['compose', '-f', `${folder}/compose.json`, 'up', '-d']);
  const bootstrap = read(`${folder}/bootstrap.json`);
  for (const c of [...clusters, 'controller']) bootstrap.hosts[`offlab-${c}`] = ip(`cea-offlab-${c}`);
  for (const c of clusters) bootstrap.hosts[c === 'cloud' ? 'minio' : 'minio-' + c] = ip(c === 'cloud' ? 'cea-minio-1' : `cea-minio-${c}-1`);
  save('bootstrap.json', bootstrap);
  docker(['exec', 'cea-terminal-load-engine', 'docker', 'run', '--rm', '--privileged', '--cgroupns=host',
    '-v', '/sys/fs/cgroup:/sys/fs/cgroup', '-v', '/var/run/docker.sock:/var/run/docker.sock', '-v', '/sim:/sim', runtimeImage, 'python', '-B', '/app/bootstrap.py']);
  save('installed.json', { at: new Date().toISOString(), terminals: 30, settings: { cpu: [.1, 1, 2], slots: [1, 2, 2], mbps: 100, edgeLatencySeconds: .01, cloudLatencySeconds: .1 } });
  const backend = `${root}/deploy/cea/secrets/backend`;
  assert(!existsSync(`${backend}/offload-lab.yaml`), 'backend lab configuration exists; inspect it before replacing');
  writeFileSync(`${backend}/offload-lab.token`, read(`${folder}/secrets.json`).token);
  writeFileSync(`${backend}/offload-lab.yaml`, JSON.stringify({ platform: { 'offload-lab': { namespace: 'lab', endpoint: 'http://offlab-controller:8080', 'token-file': '/run/secrets/offload-lab.token' } } }, null, 2));
  console.log('Installed independent lab; backend/frontend release is a separate verified step.');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const command = process.argv[2];
  if (command === 'prepare') await prepare();
  else if (command === 'install') await install();
  else throw new Error('prepare | install --approved-new-environment');
}
