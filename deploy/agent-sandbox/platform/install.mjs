import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const namespaces = ['cea-lab', 'cea-lab-warm-ui-20261018'];
export function manifests(namespace) {
  if (!namespaces.includes(namespace)) throw new Error('Namespace outside approved scope');
  const meta = (name) => ({ name, namespace, labels: { 'cea-system/component': 'warm-adapter' } });
  const role = (name, rules) => ({ apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'Role', metadata: meta(name), rules });
  const bind = (name, account, accountNamespace = namespace) => ({ apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'RoleBinding', metadata: meta(name),
    roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name }, subjects: [{ kind: 'ServiceAccount', name: account, namespace: accountNamespace }] });
  const data = Object.fromEntries(['core.py', 'kube.py'].map((name) => [name, readFileSync(new URL(`../hpa/${name}`, import.meta.url), 'utf8')]));
  data['adapter.py'] = readFileSync(new URL('adapter.py', import.meta.url), 'utf8');
  return [
    ...(namespace !== 'cea-lab' ? [{ apiVersion: 'v1', kind: 'Namespace', metadata: { name: namespace, labels: { 'cea-system/owner': 'cea-system', 'cea-system/namespace': 'lab' } } }] : []),
    { apiVersion: 'v1', kind: 'ServiceAccount', metadata: meta('cea-warm-adapter') },
    role('cea-warm-adapter', [
      { apiGroups: ['elastic.cea.io'], resources: ['warmservices'], verbs: ['get', 'list'] },
      { apiGroups: ['elastic.cea.io'], resources: ['warmservices/status'], verbs: ['patch'] },
      { apiGroups: ['extensions.agents.x-k8s.io'], resources: ['sandboxclaims'], verbs: ['get', 'list', 'create', 'delete'] },
      { apiGroups: ['extensions.agents.x-k8s.io'], resources: ['sandboxtemplates'], verbs: ['get', 'list'] },
      { apiGroups: ['extensions.agents.x-k8s.io'], resources: ['sandboxwarmpools'], verbs: ['get', 'list', 'patch'] },
      { apiGroups: [''], resources: ['pods'], verbs: ['get', 'list'] },
      { apiGroups: [''], resources: ['configmaps'], resourceNames: ['cea-warm-settings'], verbs: ['get'] },
    ]), bind('cea-warm-adapter', 'cea-warm-adapter'),
    role('cea-warm-backend', [
      { apiGroups: ['elastic.cea.io'], resources: ['warmservices'], verbs: ['get', 'list', 'create', 'update', 'delete'] },
      { apiGroups: ['extensions.agents.x-k8s.io'], resources: ['sandboxtemplates', 'sandboxwarmpools'], verbs: ['get', 'list', 'create', 'update', 'patch', 'delete'] },
      { apiGroups: [''], resources: ['endpoints'], verbs: ['get', 'list'] },
      { apiGroups: [''], resources: ['configmaps'], resourceNames: ['cea-warm-settings'], verbs: ['get', 'update'] },
    ]), bind('cea-warm-backend', 'cea-backend', 'cea-lab'),
    { apiVersion: 'v1', kind: 'ConfigMap', metadata: meta('cea-warm-code'), data },
    { apiVersion: 'apps/v1', kind: 'Deployment', metadata: meta('cea-warm-adapter'), spec: { replicas: 1, strategy: { type: 'Recreate' },
      selector: { matchLabels: { app: 'cea-warm-adapter' } }, template: { metadata: { labels: { app: 'cea-warm-adapter' } }, spec: {
        serviceAccountName: 'cea-warm-adapter', containers: [{ name: 'adapter',
          image: 'python@sha256:9d2e5553305c7c7b0097999bb17187c69b921ccd6bc9d40e4bb5ebe652c00285',
          command: ['python', '-B', '-u', '/code/adapter.py'], env: [{ name: 'POD_NAMESPACE', value: namespace }],
          resources: { requests: { cpu: '50m', memory: '64Mi' }, limits: { cpu: '500m', memory: '128Mi' } },
          volumeMounts: [{ name: 'code', mountPath: '/code', readOnly: true }],
          securityContext: { runAsNonRoot: true, runAsUser: 1000, allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] } },
        }], volumes: [{ name: 'code', configMap: { name: 'cea-warm-code' } }],
      } } } },
  ];
}
function kubectl(args, input) {
  const result = spawnSync('docker', ['exec', '-i', 'cea-cloud-1', 'kubectl', ...args], { input, encoding: 'utf8', windowsHide: true });
  if (result.status) throw new Error(result.stderr || result.stdout);
  return result.stdout;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const apply = process.argv.includes('--apply');
  for (const namespace of namespaces) {
    const objects = manifests(namespace);
    if (!apply) { console.log(JSON.stringify({ namespace, resources: objects.map((r) => `${r.kind}/${r.metadata.name}`) })); continue; }
    kubectl(['apply', '-f', '-'], JSON.stringify({ apiVersion: 'v1', kind: 'List', items: objects }));
    // Create once: an upgrade must preserve the user's namespace budget.
    const existing = JSON.parse(kubectl(['get', 'configmap', 'cea-warm-settings', '-n', namespace, '--ignore-not-found', '-o', 'json']) || 'null');
    if (!existing) kubectl(['create', '-f', '-'], JSON.stringify({ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'cea-warm-settings', namespace }, data: { count: '4', memoryMiB: '2048' } }));
    console.log(JSON.stringify({ namespace, installed: true }));
  }
}
