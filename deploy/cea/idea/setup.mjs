import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from '../../../frontend/node_modules/yaml/dist/index.js';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const local = path.join(root, '.local/idea-cea');
export const secrets = path.join(root, 'deploy/cea/secrets/backend');
const slash = p => p.replaceAll('\\', '/');
export function readEnv() {
  return Object.fromEntries(fs.readFileSync(path.join(root, 'deploy/cea/.env'), 'utf8').split(/\r?\n/)
    .filter(line => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line)).map(line => {
      const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).replace(/^(["'])(.*)\1$/, '$2')];
    }));
}
function merge(a, b) {
  for (const [key, value] of Object.entries(b)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) a[key] = merge(a[key] || {}, value);
    else a[key] = value;
  }
  return a;
}
function write(name, data) {
  const file = path.join(local, name); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}
const json = value => JSON.stringify(value, null, 2) + '\n';
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
export function setup() {
  const env = readEnv();
  fs.mkdirSync(path.join(local, 'work'), { recursive: true });
  const config = yaml.parse(fs.readFileSync(path.join(root, 'deploy/cea/application.yaml'), 'utf8'));
  for (const name of ['storage-endpoints', 'edge-access', 'terminal-gateway'])
    merge(config, yaml.parse(fs.readFileSync(path.join(secrets, name + '.yaml'), 'utf8')));
  // Keep container-side image names and Pod transfer endpoints unchanged.
  const endpoints = [];
  for (const [i, cluster] of ['cloud', 'edge-a', 'edge-b', 'edge-c'].entries()) {
    const kube = yaml.parse(fs.readFileSync(path.join(secrets, cluster + '.yaml'), 'utf8'));
    kube.clusters.forEach(c => { c.cluster.server = `https://127.0.0.1:${18443 + i}`; });
    write('kube/' + cluster + '.json', json(kube));
    config.platform.kubernetes.connections.lab[cluster].kubeconfig = slash(path.join(local, 'kube', cluster + '.json'));
    endpoints.push([18443 + i, `${cluster}:6443`]);
  }
  for (const [i, registry] of ['center', 'edge-a', 'edge-b', 'edge-c'].entries()) {
    config.platform.distribution.registries[registry]['api-url'] = `http://127.0.0.1:${18500 + i}`;
    endpoints.push([18500 + i, `registry-${registry}:5000`]);
  }
  for (const [i, store] of ['center', 'edge-a', 'edge-b', 'edge-c'].entries()) {
    config.platform.jobs.storage.lab.stores[store].endpoint = `http://127.0.0.1:${i === 0 ? Number(env.CEA_S3_PORT || 18900) : 18909 + i}`;
    if (i > 0) endpoints.push([18909 + i, `minio-${store}:9000`]);
  }
  config.server = { address: '127.0.0.1', port: 18185 };
  config.spring.datasource = { url: `jdbc:mysql://127.0.0.1:${env.CEA_MYSQL_PORT || 18306}/cea?connectionTimeZone=UTC`, username: env.BACKEND_DB_USER, password: env.BACKEND_DB_PASSWORD };
  config.spring.servlet.multipart.location = slash(path.join(local, 'work/multipart'));
  config.platform['image-upload'].directory = slash(path.join(local, 'work/import'));
  config.platform['image-build'] = { directory: slash(path.join(local, 'work/build')), command: [process.execPath, slash(path.join(root, 'deploy/cea/idea/tool.mjs')), 'buildctl'] };
  config.platform.distribution.command = [process.execPath, slash(path.join(root, 'deploy/cea/idea/tool.mjs')), 'skopeo'];
  for (const terminal of Object.values(config.platform.jobs.terminals.lab))
    terminal.gateway.endpoint = 'http://127.0.0.1:18086';
  const serialized = json(config).replaceAll('/run/secrets/', slash(secrets) + '/');
  write('application.yaml', serialized);
  for (const dir of ['multipart', 'import', 'build']) fs.mkdirSync(path.join(local, 'work', dir), { recursive: true });
  const stream = endpoints.map(([port, target]) => `  server { listen ${port}; set $target ${target}; proxy_pass $target; }`).join('\n');
  write('nginx.conf', `events {}\nstream {\n  resolver 127.0.0.11 valid=10s;\n  proxy_connect_timeout 5s;\n  proxy_timeout 20m;\n${stream}\n}\n`);
  const compose = {
    name: 'cea-idea', services: {
      access: { image: 'nginx:1.28-alpine', container_name: 'cea-idea-access', restart: 'unless-stopped', mem_limit: '64m',
        ports: endpoints.map(([p]) => `127.0.0.1:${p}:${p}`), volumes: [`${slash(local)}/nginx.conf:/etc/nginx/nginx.conf:ro`],
        networks: ['cea'], healthcheck: { test: ['CMD', 'nginx', '-t'], interval: '15s', timeout: '5s', retries: 3 } },
      tools: { image: 'cea/backend:local', container_name: 'cea-idea-tools', restart: 'unless-stopped', mem_limit: '512m',
        entrypoint: ['/usr/bin/sleep', 'infinity'], group_add: ['1000'],
        volumes: [`${slash(path.join(local, 'work'))}:/work`, `${slash(secrets)}:/run/secrets:ro`, 'builder:/run/cea-buildkit'],
        networks: ['cea'], healthcheck: { test: ['CMD', 'buildctl', '--addr', 'unix:///run/cea-buildkit/buildkitd.sock', 'debug', 'workers'], interval: '15s', timeout: '5s', retries: 3 } }
    }, networks: { cea: { external: true, name: 'cea_default' } }, volumes: { builder: { external: true, name: 'cea_buildkit-socket' } }
  };
  write('compose.json', json(compose));
  const idea = path.join(root, '.idea/runConfigurations'); fs.mkdirSync(idea, { recursive: true });
  const jdk = path.join(process.env.USERPROFILE, '.jdks/ms-21.0.12.1');
  fs.writeFileSync(path.join(idea, 'CEA_Backend_Local.xml'), `<component name="ProjectRunConfigurationManager">
  <configuration default="false" name="CEA Backend - Local" type="SpringBootApplicationConfigurationType" factoryName="Spring Boot">
    <module name="platform-server" />
    <option name="SPRING_BOOT_MAIN_CLASS" value="com.project.platform.server.BackendApplication" />
    <option name="WORKING_DIRECTORY" value="$PROJECT_DIR$" />
    <option name="ALTERNATIVE_JRE_PATH" value="${xml(slash(jdk))}" />
    <option name="ALTERNATIVE_JRE_PATH_ENABLED" value="true" />
    <envs><env name="SPRING_CONFIG_ADDITIONAL_LOCATION" value="file:${xml(slash(path.join(local, 'application.yaml')))}" /></envs>
    <method v="2">
      <option name="Make" enabled="true" />
      <option name="RunConfigurationTask" enabled="true" run_configuration_name="CEA - Prepare Local" run_configuration_type="js.build_tools.npm" />
    </method>
  </configuration>
</component>\n`);
  fs.writeFileSync(path.join(idea, 'CEA_Frontend_Local.xml'), `<component name="ProjectRunConfigurationManager">
  <configuration default="false" name="CEA Frontend - Local" type="js.build_tools.npm" factoryName="npm">
    <package-json value="$PROJECT_DIR$/frontend/package.json" />
    <command value="run" /><scripts><script value="dev" /></scripts>
    <node-interpreter value="${xml(slash(process.execPath))}" />
    <envs><env name="BACKEND_URL" value="http://127.0.0.1:18185" /></envs>
    <method v="2" />
  </configuration>
</component>\n`);
  fs.writeFileSync(path.join(idea, 'CEA_Frontend_Docker.xml'), `<component name="ProjectRunConfigurationManager">
  <configuration default="false" name="CEA Frontend - Docker Backend" type="js.build_tools.npm" factoryName="npm">
    <package-json value="$PROJECT_DIR$/frontend/package.json" />
    <command value="run" /><scripts><script value="dev" /></scripts>
    <node-interpreter value="${xml(slash(process.execPath))}" />
    <envs><env name="BACKEND_URL" value="http://127.0.0.1:18085" /></envs>
    <method v="2" />
  </configuration>
</component>\n`);
  for (const [file, name, script] of [
    ['CEA_Prepare_Local.xml', 'CEA - Prepare Local', 'prepare:local'],
    ['CEA_Restore_Docker.xml', 'CEA - Restore Docker', 'restore:docker'],
  ]) {
    fs.writeFileSync(path.join(idea, file), `<component name="ProjectRunConfigurationManager">
  <configuration default="false" name="${name}" type="js.build_tools.npm" factoryName="npm">
    <package-json value="$PROJECT_DIR$/deploy/cea/idea/package.json" />
    <command value="run" /><scripts><script value="${script}" /></scripts>
    <node-interpreter value="${xml(slash(process.execPath))}" />
    <method v="2" />
  </configuration>
</component>\n`);
  }
  fs.writeFileSync(path.join(idea, 'CEA_Run_All.xml'), `<component name="ProjectRunConfigurationManager">
  <configuration default="false" name="CEA - 前后端一键启动" type="CompoundRunConfigurationType">
    <toRun name="CEA Backend - Local" type="SpringBootApplicationConfigurationType" />
    <toRun name="CEA Frontend - Local" type="js.build_tools.npm" />
    <method v="2" />
  </configuration>
</component>\n`);
  console.log('Generated private configuration and six IDEA run configurations, including Docker-backed frontend development. No services switched.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) setup();
