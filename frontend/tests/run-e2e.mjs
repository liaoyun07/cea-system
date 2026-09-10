// Owns only its freshly created ephemeral database + JAR process. Never touches existing services.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { preview } from 'vite';

const root = resolve(import.meta.dirname, '..');
process.chdir(root);
const jar = resolve(root, '../platform-server/target/platform-server-0.1.0-SNAPSHOT.jar');
if (!existsSync(jar) || !existsSync(resolve(root, 'dist/index.html')))
  throw new Error('Build backend JAR and npm run build before E2E.');
const java = process.env.CEA_JAVA_HOME || process.env.JAVA_HOME;
if (!java) throw new Error('Set CEA_JAVA_HOME to JDK 21.');
const port = async () => {
  const s = createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const token = randomUUID().slice(0, 8),
  dbPass = randomUUID(),
  apiPass = randomUUID();
let container, backend, web, child;
mkdirSync(resolve(root, '.local/evidence'), { recursive: true });
const log = createWriteStream(resolve(root, '.local/evidence/backend.log'));
const command = (bin, args) =>
  execFileSync(bin, args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
try {
  container = command('docker', [
    'run',
    '--rm',
    '-d',
    '--name',
    `cea-ui-e2e-${token}`,
    '-p',
    '127.0.0.1::3306',
    '-e',
    `MYSQL_ROOT_PASSWORD=${dbPass}`,
    '-e',
    'MYSQL_DATABASE=cea_ui',
    '-e',
    'MYSQL_USER=cea_ui',
    '-e',
    `MYSQL_PASSWORD=${dbPass}`,
    'mysql:8.0',
  ]);
  const dbPort = command('docker', ['port', container, '3306/tcp']).split(':').at(-1);
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      command('docker', [
        'exec',
        '-e',
        `MYSQL_PWD=${dbPass}`,
        container,
        'mysql',
        '-ucea_ui',
        'cea_ui',
        '-e',
        'SELECT 1',
      ]);
      ready = true;
      break;
    } catch {
      await wait(500);
    }
  }
  if (!ready) throw new Error('Ephemeral MySQL did not become ready.');
  const backendPort = await port(),
    webPort = await port();
  backend = spawn(
    resolve(java, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'),
    ['-jar', jar, `--server.port=${backendPort}`, '--logging.level.root=WARN'],
    {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        BACKEND_DB_URL: `jdbc:mysql://127.0.0.1:${dbPort}/cea_ui?connectionTimeZone=UTC`,
        BACKEND_DB_USER: 'cea_ui',
        BACKEND_DB_PASSWORD: dbPass,
        BACKEND_USER: 'owner',
        BACKEND_PASSWORD: apiPass,
        BACKEND_NAMESPACES: 'lab',
      },
    },
  );
  backend.stdout.pipe(log, { end: false });
  backend.stderr.pipe(log, { end: false });
  let online = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${backendPort}/api/namespaces/lab/flows`)).status === 401) {
        online = true;
        break;
      }
    } catch {}
    if (backend.exitCode !== null) throw new Error('Test backend exited; see .local/evidence/backend.log');
    await wait(500);
  }
  if (!online) throw new Error('Test backend did not start.');
  process.env.BACKEND_URL = `http://127.0.0.1:${backendPort}`;
  web = await preview({ root, preview: { port: webPort, host: '127.0.0.1', strictPort: true } });
  console.log(`Isolated UI test: http://127.0.0.1:${webPort} (new MySQL + packaged backend JAR)`);
  child = spawn(process.execPath, [resolve(root, 'node_modules/@playwright/test/cli.js'), 'test'], {
    windowsHide: true,
    stdio: 'inherit',
    env: {
      ...process.env,
      CEA_E2E_URL: `http://127.0.0.1:${webPort}`,
      CEA_E2E_USER: 'owner',
      CEA_E2E_PASSWORD: apiPass,
    },
  });
  process.exitCode = await new Promise((r, j) => {
    child.on('exit', r);
    child.on('error', j);
  });
} finally {
  if (child && child.exitCode === null) child.kill();
  if (web) await new Promise((r) => web.httpServer.close(r));
  if (backend && backend.exitCode === null) {
    backend.kill();
    await Promise.race([new Promise((r) => backend.on('exit', r)), wait(10000)]);
    if (backend.exitCode === null) backend.kill('SIGKILL');
  }
  log.end();
  if (container) command('docker', ['rm', '-f', container]);
}
