import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '../..');
const files = JSON.parse(readFileSync(`${root}/.local/cea/terminal-load/matrix/files.json`, 'utf8'));
for (const file of files) {
  const input = `${root}/.local/cea/terminal-load/data/${file.fileId}`;
  const logs = execFileSync('docker', ['run', '--rm', '--network', 'none', '--cpus', '.5', '--memory', '256m', '--read-only',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--tmpfs', '/work:size=1m,mode=1777',
    '-e', 'INPUT_FILE=/input', '-v', `${input}:/input:ro`, 'cea/offload-worker:independent-v1'],
    { cwd: root, encoding: 'utf8', windowsHide: true });
  const result = JSON.parse(logs.trim().split('\n').at(-1).replace('OFFLAB_RESULT=', ''));
  assert.equal(result.measurement.inputBytes, file.bytes);
  for (const [key, value] of Object.entries(file.expected)) assert(Math.abs(result[key] - value) <= Math.max(1e-9, Math.abs(value) * 1e-8), key);
  console.log(JSON.stringify({ mb: file.mb, result: 'PASS', cpuSeconds: result.measurement.cpuSeconds, maxRssKiB: result.measurement.maxRssKiB }));
}
