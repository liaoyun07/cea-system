// Dedicated namespace and identity: never expand the existing backend account.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

export async function provisionKubernetes(folder, docker) {
  const namespace = 'cea-offload-lab';
  mkdirSync(`${folder}/kube`, { recursive: true });
  const compose = JSON.parse(readFileSync(`${folder}/compose.json`, 'utf8'));
  for (const cluster of ['cloud', 'edge-a', 'edge-b', 'edge-c']) {
    const container = `cea-${cluster}-1`;
    const objects = [
      { apiVersion: 'v1', kind: 'Namespace', metadata: { name: namespace, labels: { 'cea.offload-lab': 'true' } } },
      { apiVersion: 'v1', kind: 'ServiceAccount', metadata: { name: 'executor', namespace } },
      { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'Role', metadata: { name: 'executor', namespace }, rules: [
        { apiGroups: ['batch'], resources: ['jobs'], verbs: ['create', 'get', 'list', 'delete'] },
        { apiGroups: [''], resources: ['pods'], verbs: ['get', 'list'] },
      ] },
      { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'RoleBinding', metadata: { name: 'executor', namespace },
        subjects: [{ kind: 'ServiceAccount', name: 'executor', namespace }], roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: 'executor' } },
      { apiVersion: 'v1', kind: 'Secret', metadata: { name: 'executor-token', namespace, annotations: { 'kubernetes.io/service-account.name': 'executor' } }, type: 'kubernetes.io/service-account-token' },
    ];
    const existing = JSON.parse(docker(['exec', container, 'kubectl', 'get', 'namespace', namespace, '--ignore-not-found', '-o', 'json']) || 'null');
    assert(!existing || existing.metadata.labels?.['cea.offload-lab'] === 'true', 'namespace belongs to another owner');
    execFileSync('docker', ['exec', '-i', container, 'kubectl', 'apply', '-f', '-'], {
      input: JSON.stringify({ apiVersion: 'v1', kind: 'List', items: objects }), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let secret;
    for (let n = 0; n < 20; n++) {
      secret = JSON.parse(docker(['exec', container, 'kubectl', '-n', namespace, 'get', 'secret', 'executor-token', '-o', 'json']));
      if (secret.data?.token) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert(secret.data?.token);
    writeFileSync(`${folder}/kube/${cluster}.yaml`, JSON.stringify({ apiVersion: 'v1', kind: 'Config',
      'current-context': 'lab', contexts: [{ name: 'lab', context: { cluster, user: 'executor', namespace } }],
      clusters: [{ name: cluster, cluster: { server: `https://${cluster}:6443`, 'certificate-authority-data': secret.data['ca.crt'] } }],
      users: [{ name: 'executor', user: { token: Buffer.from(secret.data.token, 'base64').toString() } }],
    }));
    const file = `${folder}/${cluster}.json`, config = JSON.parse(readFileSync(file, 'utf8'));
    config.execution.namespace = namespace;
    writeFileSync(file, JSON.stringify(config, null, 2));
    compose.services[`offlab-${cluster}`].volumes = compose.services[`offlab-${cluster}`].volumes.map(v =>
      v.includes(`:/kube/${cluster}.yaml`) ? `${folder}/kube/${cluster}.yaml:/kube/${cluster}.yaml:ro` : v);
  }
  writeFileSync(`${folder}/compose.json`, JSON.stringify(compose, null, 2));
}
