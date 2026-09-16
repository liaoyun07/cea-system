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
  let helperImage;
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
    if (helperImage) docker('image', 'rm', helperImage);
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
      '-p',
      '127.0.0.1::5000',
      '-e',
      'REGISTRY_STORAGE_DELETE_ENABLED=true',
      'registry:2',
    );
    owned.push(registry);
    const registryPort = JSON.parse(docker('inspect', registry))[0].NetworkSettings.Ports['5000/tcp'][0]
      .HostPort;
    const targetRegistry = docker(
      'run',
      '-d',
      '--network',
      network,
      '--network-alias',
      'ui-distribution-target',
      '-p',
      '127.0.0.1::5000',
      'registry:2',
    );
    owned.push(targetRegistry);
    const targetRegistryPort = JSON.parse(docker('inspect', targetRegistry))[0].NetworkSettings.Ports[
      '5000/tcp'
    ][0].HostPort;
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
    const builder = docker(
      'run',
      '-d',
      '--security-opt',
      'seccomp=unconfined',
      '--security-opt',
      'apparmor=unconfined',
      '--security-opt',
      'systempaths=unconfined',
      'moby/buildkit:v0.33.0-rootless',
      '--oci-worker-snapshotter=native',
    );
    owned.push(builder);
    let builderReady = false;
    for (let i = 0; i < 60; i++) {
      try {
        docker('exec', builder, 'buildctl', 'debug', 'workers');
        builderReady = true;
        break;
      } catch {
        await wait(500);
      }
    }
    if (!builderReady) throw new Error('Isolated rootless BuildKit did not become ready');
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
    // FILE-01 Jobs transfer artifacts in the Pod, using the current shared helper.
    const helperTag = `cea-ui-file-helper:${token}`;
    docker('build', '-t', helperTag, resolve(import.meta.dirname, '../../deploy/file-helper'));
    helperImage = helperTag;
    docker('save', '-o', join(directory, 'file-helper.tar'), helperImage);
    docker('cp', join(directory, 'file-helper.tar'), `${k3s}:/tmp/file-helper.tar`);
    docker('exec', k3s, 'ctr', 'images', 'import', '/tmp/file-helper.tar');
    const metricsImage = 'rancher/mirrored-metrics-server:v0.7.2';
    try {
      docker('image', 'inspect', metricsImage);
    } catch {
      docker('pull', metricsImage);
    }
    docker('save', '-o', join(directory, 'metrics.tar'), metricsImage);
    docker('cp', join(directory, 'metrics.tar'), `${k3s}:/tmp/metrics.tar`);
    docker('exec', k3s, 'ctr', 'images', 'import', '/tmp/metrics.tar');
    docker(
      'cp',
      resolve(import.meta.dirname, '../../deploy/cea/metrics-server.yaml'),
      `${k3s}:/tmp/metrics.yaml`,
    );
    docker('exec', k3s, 'kubectl', 'apply', '-f', '/tmp/metrics.yaml');
    docker('exec', k3s, 'kubectl', 'create', 'namespace', 'ui-test');
    docker(
      'exec',
      k3s,
      'kubectl',
      'create',
      'service',
      'clusterip',
      'inspection-service',
      '--tcp=80:8080',
      '--namespace',
      'ui-test',
    );
    docker('cp', `${k3s}:/etc/rancher/k3s/k3s.yaml`, kubeconfig);
    const config = parse(readFileSync(kubeconfig, 'utf8'));
    config.clusters[0].cluster.server = `https://127.0.0.1:${docker('port', k3s, '6443/tcp').split(':').at(-1)}`;
    writeFileSync(kubeconfig, stringify(config));
    const minio = docker(
      'run',
      '-d',
      '--network',
      network,
      '-p',
      '127.0.0.1::9000',
      '-e',
      'MINIO_ROOT_USER=ui-test-key',
      '-e',
      'MINIO_ROOT_PASSWORD=ui-test-secret',
      'quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z',
      'server',
      '/data',
    );
    owned.push(minio);
    let storageReady = false;
    for (let i = 0; i < 60; i++) {
      try {
        docker(
          'exec',
          minio,
          'mc',
          'alias',
          'set',
          'local',
          'http://127.0.0.1:9000',
          'ui-test-key',
          'ui-test-secret',
        );
        docker('exec', minio, 'mc', 'mb', '--ignore-existing', 'local/artifacts');
        storageReady = true;
        break;
      } catch {
        await wait(500);
      }
    }
    if (!storageReady) throw new Error('Isolated object storage did not become ready');
    writeFileSync(join(directory, 's3-key'), 'ui-test-key');
    writeFileSync(join(directory, 's3-secret'), 'ui-test-secret');
    const transferAddress = JSON.parse(docker('inspect', minio))[0].NetworkSettings.Networks[network]
      .IPAddress;
    return {
      cleanup,
      archive: join(directory, 'alpine.tar'),
      args: [
        `--platform.jobs.helpers.lab.runtime-edge=${helperImage}`,
        '--platform.jobs.storage.lab.outputs.runtime-edge=center',
        `--platform.jobs.storage.lab.stores.center.endpoint=http://127.0.0.1:${docker('port', minio, '9000/tcp').split(':').at(-1)}`,
        `--platform.jobs.storage.lab.stores.center.transfer-endpoint=http://${transferAddress}:9000`,
        `--platform.jobs.storage.lab.stores.center.access-key-file=${join(directory, 's3-key')}`,
        `--platform.jobs.storage.lab.stores.center.secret-key-file=${join(directory, 's3-secret')}`,
        '--platform.jobs.storage.lab.stores.center.artifact-bucket=artifacts',
        '--platform.jobs.slots.lab.runtime-edge=2',
        '--platform.distribution.registries.ui.address=ui-registry:5000',
        '--platform.distribution.registries.ui.tls-verify=false',
        `--platform.distribution.registries.ui.api-url=http://127.0.0.1:${registryPort}`,
        '--platform.distribution.targets.lab.runtime-edge=ui',
        '--platform.distribution.registries.ui-target.address=ui-distribution-target:5000',
        '--platform.distribution.registries.ui-target.tls-verify=false',
        `--platform.distribution.registries.ui-target.api-url=http://127.0.0.1:${targetRegistryPort}`,
        '--platform.distribution.targets.lab.distribution-edge=ui-target',
        '--platform.distribution.timeout=PT60S',
        '--platform.image-upload.centers.lab=ui',
        `--platform.image-upload.directory=${join(directory, 'uploads')}`,
        `--platform.image-build.directory=${join(directory, 'builds')}`,
        ...[
          join(
            process.env.CEA_JAVA_HOME || process.env.JAVA_HOME,
            'bin',
            process.platform === 'win32' ? 'java.exe' : 'java',
          ),
          '-cp',
          resolve(import.meta.dirname, '../../platform-server/target/test-classes'),
          'com.project.platform.server.BuildkitTestBridge',
          builder,
        ].map((v, i) => `--platform.image-build.command[${i}]=${v}`),
        `--platform.kubernetes.connections.lab.runtime-edge.kubeconfig=${kubeconfig}`,
        '--platform.kubernetes.connections.lab.runtime-edge.context=default',
        '--platform.kubernetes.connections.lab.runtime-edge.namespace=ui-test',
        ...[process.execPath, resolve(import.meta.dirname, 'skopeo-bridge.mjs'), tool].map(
          (v, i) => `--platform.distribution.command[${i}]=${v}`,
        ),
      ],
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}
