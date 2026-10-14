// Owns only a disposable MySQL container. No access to the CEA database or lab fleet.
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const name = 'cea-offlab-test-' + randomBytes(4).toString('hex'), password = randomBytes(16).toString('hex');
const docker = args => {
  try { return execFileSync('docker', args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { throw new Error(`Docker ${args[0]} failed: ${String(error.stderr || '').replaceAll(password, '[test credential]').slice(-2500)}`); }
};
let created = false;
try {
  docker(['run', '-d', '--name', name, '-e', 'MYSQL_ROOT_PASSWORD=' + password, '-e', 'MYSQL_DATABASE=offlab_test', 'mysql:8.0']);
  created = true;
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { docker(['exec', '-e', 'MYSQL_PWD=' + password, name, 'mysql', '--protocol=tcp', '-h127.0.0.1', '-uroot', '-e', 'SELECT 1']); ready = true; break; }
    catch { await new Promise(r => setTimeout(r, 1000)); }
  }
  if (!ready) throw new Error('test database unavailable');
  docker(['exec', '-e', 'MYSQL_PWD=' + password, name, 'mysql', '-uroot', '-e',
    `CREATE USER 'offlab_test'@'%' IDENTIFIED BY '${password}'; GRANT ALL ON offlab_test.* TO 'offlab_test'@'%';`]);
  const config = { host: '127.0.0.1', user: 'offlab_test', password, database: 'offlab_test' };
  console.log(docker(['run', '--rm', '--network', 'container:' + name, '-e', 'TEST_DATABASE=' + JSON.stringify(config),
    '-v', `${root}/deploy/offload-lab:/tests:ro`, '-e', 'PYTHONPATH=/tests', 'cea/offload-lab:independent-v1', 'python', '-B', '/tests/integration_test.py']));
  console.log('PASS: isolated MySQL concurrent patches and bounded connection release');
} finally {
  if (created) docker(['rm', '-f', name]);
}
