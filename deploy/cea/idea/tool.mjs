import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export function translate(arg, project = root) {
  return arg.replaceAll('\\', '/')
    .replaceAll(project.replaceAll('\\', '/') + '/.local/idea-cea/work', '/work')
    .replaceAll(project.replaceAll('\\', '/') + '/deploy/cea/secrets/backend', '/run/secrets');
}
export function invocation(tool, args, project = root) {
  if (!['skopeo', 'buildctl'].includes(tool)) throw new Error('Expected skopeo or buildctl');
  return ['exec', 'cea-idea-tools', tool, ...(tool === 'buildctl' ? ['--addr', 'unix:///run/cea-buildkit/buildkitd.sock'] : []), ...args.map(a => translate(a, project))];
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = spawnSync('docker', invocation(process.argv[2], process.argv.slice(3)), { stdio: 'inherit', windowsHide: true });
  if (result.error) console.error('Cannot invoke Docker tools:', result.error.message);
  process.exit(result.status ?? 1);
}
