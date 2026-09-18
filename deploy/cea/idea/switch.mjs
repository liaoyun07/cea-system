import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { root, local, readEnv } from './setup.mjs';

const mode = process.argv[2];
if (!['local', 'docker'].includes(mode)) throw new Error('Usage: node deploy/cea/idea/switch.mjs local|docker');
const gatewayFile = path.join(root, 'deploy/cea/secrets/edge/gateway.json');
const backup = path.join(local, 'gateway-before.json');
const docker = (...args) => execFileSync('docker', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 60000 }).toString();
async function healthy(port) { try { return (await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } }
const env = readEnv();
const headers = { Authorization: 'Basic ' + Buffer.from(`${env.BACKEND_USER}:${env.BACKEND_PASSWORD}`).toString('base64') };
if (mode === 'local') {
  if (await healthy(18185)) throw new Error('Local backend is already running; stop it before switching.');
  const running = docker('inspect', '--format', '{{.State.Running}}', 'cea-backend-1').trim() === 'true';
  if (running) {
    for (let offset = 0; ; offset += 100) {
      const response = await fetch(`http://127.0.0.1:18085/api/namespaces/lab/executions?limit=100&offset=${offset}`, { headers });
      if (!response.ok) throw new Error('Cannot check active executions; original backend was not stopped.');
      const rows = await response.json();
      if (rows.some(r => ['CREATED', 'RUNNING', 'KILLING'].includes(r.state))) throw new Error('Active workflow exists; wait until it finishes.');
      if (rows.length < 100) break;
    }
  }
  docker('compose', '-f', path.join(local, 'compose.json'), 'up', '-d');
  const gateway = JSON.parse(fs.readFileSync(gatewayFile, 'utf8'));
  if (gateway.backend !== 'http://host.docker.internal:18185') fs.copyFileSync(gatewayFile, backup);
  if (!fs.existsSync(backup)) throw new Error('Missing original gateway backup');
  if (running) docker('stop', 'cea-backend-1');
  gateway.backend = 'http://host.docker.internal:18185';
  fs.writeFileSync(gatewayFile, JSON.stringify(gateway, null, 2) + '\n');
  docker('restart', 'cea-edge-gateway-1');
  console.log('Docker backend stopped. Start CEA Backend - Local and CEA Frontend - Local in IDEA; open http://127.0.0.1:18100');
} else {
  if (await healthy(18185)) throw new Error('Stop the local backend in IDEA before restoring Docker mode.');
  docker('start', 'cea-backend-1');
  let ready = false;
  for (let i = 0; i < 45; i++) { if (await healthy(18085)) { ready = true; break; } await new Promise(resolve => setTimeout(resolve, 1000)); }
  if (!ready) throw new Error('Original backend is not healthy yet; gateway was not changed.');
  if (!fs.existsSync(backup)) throw new Error('Missing original gateway backup');
  fs.copyFileSync(backup, gatewayFile); docker('restart', 'cea-edge-gateway-1');
  console.log('Original CEA backend and gateway restored; open http://127.0.0.1:18080');
}
