// Real disposable deployment infrastructure for browser tests. No existing CEA service is touched.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse, stringify } from 'yaml';

export async function startRuntime(token) {
  const directory = mkdtempSync(join(tmpdir(), 'cea-ui-runtime-'));
  const owned = [],
    network = `cea-ui-runtime-${token}`;
  let networkCreated = false;
  const docker = (...args) =>
    execFileSync('docker', args, {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 180000,
    }).trim();
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const cleanup = () => {
    for (const id of owned.reverse()) docker('rm', '-f', id);
    if (networkCreated) docker('network', 'rm', network);
    const absolute = resolve(directory);
    if (
      !absolute.startsWith(resolve(tmpdir()) + '\\cea-ui-runtime-') &&
      !absolute.startsWith(resolve(tmpdir()) + '/cea-ui-runtime-')
    )
      throw new Error('Unexpected fixture cleanup path');
    rmSync(absolute, { recursive: true, force: true });
  };
  try {
    docker('network', 'create', network);
    networkCreated = true;
    const registry = docker(
      'run',
      '-d',
      '--network',
      network,
      '--network-alias',
      'ui-registry',
      'registry:2',
    );
    owned.push(registry);
    const tool = docker(
      'run',
      '-d',
      '--network',
      network,
      '--entrypoint',
      '/bin/sh',
      'quay.io/skopeo/stable:v1.20.0',
      '-c',
      'exec sleep infinity',
    );
    owned.push(tool);
    writeFileSync(join(directory, 'auth.json'), '{"auths":{}}');
    docker('cp', join(directory, 'auth.json'), `${tool}:/tmp/auth.json`);
    docker('save', '-o', join(directory, 'alpine.tar'), 'alpine:latest');
    docker('cp', join(directory, 'alpine.tar'), `${tool}:/tmp/alpine.tar`);
    docker(
      'exec',
      tool,
      'skopeo',
      '--command-timeout=60s',
      'copy',
      '--dest-tls-verify=false',
      'docker-archive:/tmp/alpine.tar',
      'docker://ui-registry:5000/alpine:v1',
    );
    writeFileSync(
      join(directory, 'registries.yaml'),
      'mirrors:\n  "ui-registry:5000":\n    endpoint: ["http://ui-registry:5000"]\n',
    );
    const k3s = docker(
      'run',
      '-d',
      '--privileged',
      '--network',
      network,
      '-p',
      '127.0.0.1::6443',
      '--tmpfs',
      '/run',
      '--tmpfs',
      '/var/run',
      '-v',
      `${join(directory, 'registries.yaml')}:/etc/rancher/k3s/registries.yaml:ro`,
      'rancher/k3s:v1.30.6-k3s1',
      'server',
      '--disable',
      'traefik,servicelb,metrics-server',
    );
    owned.push(k3s);
    const kubeconfig = join(directory, 'kubeconfig.yaml');
    let ready = false;
    for (let i = 0; i < 120; i++) {
      try {
        if (docker('exec', k3s, 'kubectl', 'get', '--raw', '/readyz') === 'ok') {
          ready = true;
          break;
        }
      } catch {}
      await wait(500);
    }
    if (!ready) throw new Error('Isolated Kubernetes did not become ready');
    docker('save', '-o', join(directory, 'pause.tar'), 'rancher/mirrored-pause:3.6');
    docker('cp', join(directory, 'pause.tar'), `${k3s}:/tmp/pause.tar`);
    docker('exec', k3s, 'ctr', 'images', 'import', '/tmp/pause.tar');
    docker('exec', k3s, 'kubectl', 'create', 'namespace', 'ui-test');
    docker('cp', `${k3s}:/etc/rancher/k3s/k3s.yaml`, kubeconfig);
    const config = parse(readFileSync(kubeconfig, 'utf8'));
    config.clusters[0].cluster.server = `https://127.0.0.1:${docker('port', k3s, '6443/tcp').split(':').at(-1)}`;
    writeFileSync(kubeconfig, stringify(config));
    return {
      cleanup,
      args: [
        '--platform.distribution.registries.ui.address=ui-registry:5000',
        '--platform.distribution.registries.ui.tls-verify=false',
        '--platform.distribution.registries.ui.auth-file=/tmp/auth.json',
        '--platform.distribution.targets.lab.runtime-edge=ui',
        '--platform.distribution.timeout=PT60S',
        `--platform.kubernetes.connections.lab.runtime-edge.kubeconfig=${kubeconfig}`,
        '--platform.kubernetes.connections.lab.runtime-edge.context=default',
        '--platform.kubernetes.connections.lab.runtime-edge.namespace=ui-test',
        ...['docker', 'exec', tool, 'skopeo'].map((v, i) => `--platform.distribution.command[${i}]=${v}`),
      ],
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}
