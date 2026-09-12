// Test-only transport to the disposable Skopeo container; no production Docker dependency.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const [tool, ...args] = process.argv.slice(2);
let temporary;
const run = (values) => spawnSync('docker', values, { stdio: 'inherit', windowsHide: true }).status;
try {
  const values = args.map((value) => {
    if (!value.startsWith('docker-archive:')) return value;
    temporary = `/tmp/cea-ui-upload-${randomUUID()}.tar`;
    if (run(['cp', value.slice('docker-archive:'.length), `${tool}:${temporary}`]) !== 0)
      throw new Error('Test archive transfer failed');
    return `docker-archive:${temporary}`;
  });
  process.exitCode = run(['exec', tool, 'skopeo', ...values]) ?? 1;
} finally {
  if (temporary) run(['exec', tool, 'rm', '-f', temporary]);
}
