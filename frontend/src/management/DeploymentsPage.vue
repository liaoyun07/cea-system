<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { errorText } from '../api.js';
import { readCatalog } from '../no-code/document.js';
import { deploymentBody, deploymentDraft, deploymentFields, enc } from './catalogs.js';
import DeploymentParameters from './DeploymentParameters.vue';
import { time } from '../model.js';
import { durationText, deploymentTarget, operationName, stateName, ingressRouteUrl } from './operations.js';
const props = defineProps({ api: Function });
const emit = defineEmits(['dirty', 'pending', 'access']);
const clusters = ref([]),
  apps = ref([]),
  cluster = ref(''),
  namespaces = ref([]),
  kubeNamespace = ref(''),
  rows = ref([]),
  selected = ref(null),
  draft = ref(null),
  baseline = ref('');
const busy = ref(false),
  writing = ref(false),
  loaded = ref(false),
  catalogsLoaded = ref(false),
  error = ref(''),
  success = ref('');
const runtime = ref(null),
  runtimeError = ref(''),
  accessError = ref(''),
  services = ref([]),
  ingresses = ref([]),
  ingressClasses = ref([]);
const abort = new AbortController();
const history = ref([]),
  historyOffset = ref(0),
  scaleReplicas = ref(1);
let alive = true;
const api = (path, options = {}) =>
  props.api(path, {
    ...options,
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(options.long ? 600000 : 20000)]),
  });
watch(
  () => draft.value && JSON.stringify(draft.value) !== baseline.value,
  (v) => emit('dirty', !!v),
);
watch(writing, (v) => emit('pending', v), { flush: 'sync' });
onBeforeUnmount(() => {
  alive = false;
  abort.abort();
});
const namespacePath = () => `/clusters/${enc(cluster.value)}/kubernetes/namespaces`;
const path = (name) =>
  `${namespacePath()}/${enc(kubeNamespace.value)}/deployments${name ? `/${enc(name)}` : ''}`;
const app = computed(() =>
  apps.value.find((a) => `${a.applicationId}/${a.version}` === draft.value?.application),
);
async function action(work, write = false) {
  if (busy.value) return;
  busy.value = true;
  writing.value = write;
  error.value = '';
  success.value = '';
  try {
    await work();
  } catch (e) {
    if (alive) error.value = errorText(e);
  } finally {
    if (alive) {
      busy.value = false;
      writing.value = false;
    }
  }
}
async function catalogs() {
  catalogsLoaded.value = false;
  const result = await Promise.all([
    readCatalog(api, '/resources/clusters'),
    readCatalog(api, '/applications'),
  ]);
  if (alive) {
    [clusters.value, apps.value] = result;
    catalogsLoaded.value = true;
  }
}
async function list() {
  rows.value = [];
  selected.value = null;
  runtime.value = null;
  loaded.value = false;
  if (!cluster.value || !kubeNamespace.value) return;
  const result = await api(path());
  if (alive) {
    rows.value = result;
    loaded.value = true;
  }
}
async function loadNamespaces(reset = false) {
  rows.value = [];
  loaded.value = false;
  if (reset) kubeNamespace.value = '';
  namespaces.value = [];
  const values = await api(namespacePath());
  if (!alive) return;
  namespaces.value = values;
  const usable = values.filter((row) => row.phase === 'Active');
  if (!usable.some((row) => row.name === kubeNamespace.value))
    kubeNamespace.value = usable.find((row) => row.executionDefault)?.name || usable[0]?.name || '';
  await list();
}
function create() {
  draft.value = {
    name: '',
    application: '',
    replicas: 1,
    parameters: [],
    command: '[]',
    customCommand: false,
    resources: { cpuRequest: '', memoryRequest: '', cpuLimit: '', memoryLimit: '' },
    readinessEnabled: false,
    readinessPath: '/',
    readinessPort: 8080,
  };
  baseline.value = JSON.stringify(draft.value);
  selected.value = null;
  error.value = '';
  success.value = '';
}
function back() {
  if (
    busy.value ||
    (draft.value &&
      JSON.stringify(draft.value) !== baseline.value &&
      !window.confirm('放弃未保存的部署配置？'))
  )
    return;
  draft.value = null;
  selected.value = null;
  action(list);
}
async function save() {
  await action(async () => {
    const result = await api(path(draft.value.name), {
      method: 'PUT',
      body: deploymentBody(draft.value),
      long: true,
    });
    if (alive) {
      draft.value = null;
      selected.value = result;
      scaleReplicas.value = result.replicas;
      historyOffset.value = 0;
      success.value = '部署配置已被接受；是否就绪以实际状态为准。';
      await loadHistory();
      await loadRuntime();
    }
  }, true);
}
async function detail(row) {
  await action(async () => {
    const result = await api(path(row.name));
    if (alive) {
      selected.value = result;
      scaleReplicas.value = result.replicas;
      historyOffset.value = 0;
      await loadHistory();
      await loadRuntime();
    }
  });
}
async function loadHistory() {
  const result = await api(`${path(selected.value.name)}/history?limit=20&offset=${historyOffset.value}`);
  if (alive) history.value = result;
}
function changeApplication() {
  draft.value.parameters = deploymentFields(app.value?.parameters);
}
async function loadRuntime() {
  runtime.value = null;
  runtimeError.value = '';
  accessError.value = '';
  services.value = [];
  ingresses.value = [];
  try {
    const value = await api(`${path(selected.value.name)}/runtime`);
    if (!alive) return;
    runtime.value = value;
    const scope = `/clusters/${enc(cluster.value)}/kubernetes/namespaces/${enc(value.namespace)}`;
    try {
      const [allServices, allIngresses, classes] = await Promise.all([
        api(`${scope}/services`),
        api(`${scope}/ingresses`),
        api(`/clusters/${enc(cluster.value)}/kubernetes/ingress-classes`),
      ]);
      if (!alive) return;
      services.value = allServices.filter(
        (s) =>
          Object.keys(s.selector || {}).length &&
          Object.entries(s.selector).every(([key, v]) => value.labels[key] === v),
      );
      const names = new Set(services.value.map((s) => s.name));
      ingresses.value = allIngresses
        .map((i) => ({ ...i, routes: i.routes.filter((r) => names.has(r.service)) }))
        .filter((i) => i.routes.length);
      ingressClasses.value = classes;
    } catch (e) {
      if (alive) accessError.value = errorText(e);
    }
  } catch (e) {
    if (alive) runtimeError.value = errorText(e);
  }
}
function configureAccess() {
  emit('access', {
    cluster: cluster.value,
    namespace: runtime.value.namespace,
    name: selected.value.name,
    selector: runtime.value.selector,
  });
}
async function edit() {
  await action(async () => {
    const result = await api(`${path(selected.value.name)}/configuration`);
    if (!alive) return;
    const contract = apps.value.find(
      (a) => a.applicationId === result.applicationId && a.version === result.version,
    )?.parameters;
    draft.value = deploymentDraft(selected.value.name, result, contract);
    baseline.value = JSON.stringify(draft.value);
  });
}
async function scale() {
  await action(async () => {
    const result = await api(`${path(selected.value.name)}/scale`, {
      method: 'PATCH',
      body: { replicas: scaleReplicas.value, resourceVersion: selected.value.resourceVersion },
    });
    if (!alive) return;
    selected.value = result;
    historyOffset.value = 0;
    await loadHistory();
    await loadRuntime();
    success.value = '副本配置已提交';
  }, true);
}
async function remove() {
  const value = selected.value;
  if (
    !window.confirm(
      `删除 ${cluster.value} / ${kubeNamespace.value} 中的部署 ${value.name}？不会删除其他 Namespace 的部署、应用或数据集。`,
    )
  )
    return;
  await action(async () => {
    await api(`${path(value.name)}?resourceVersion=${enc(value.resourceVersion)}`, { method: 'DELETE' });
    if (!alive) return;
    selected.value = null;
    await list();
    if (alive)
      success.value = rows.value.some((r) => r.name === value.name)
        ? '删除请求已接受，资源仍在列表中；请刷新确认。'
        : '删除请求已接受，列表中已无该部署；不保证全部 Pod 已退出。';
  }, true);
}
onMounted(() => action(catalogs));
</script>
<template>
  <section class="list-page management-page">
    <div class="page-heading">
      <div>
        <span class="eyebrow">DEPLOYMENTS</span>
        <h1>边缘服务部署</h1>
      </div>
      <button
        v-if="!draft && !selected"
        class="primary"
        :disabled="busy || !kubeNamespace || !namespaces.length || !catalogsLoaded"
        @click="create"
      >
        ＋ 创建部署</button
      ><button v-else :disabled="busy" @click="back">← 返回列表</button>
    </div>
    <div v-if="error" class="notice error" role="alert">{{ error }}</div>
    <div v-if="success" class="notice success" role="status">{{ success }}</div>
    <div class="list-toolbar">
      <label class="inline-select"
        >执行集群<select
          v-model="cluster"
          aria-label="执行集群"
          :disabled="busy || !!draft || !!selected"
          @change="action(() => loadNamespaces(true))"
        >
          <option value="" disabled>选择集群</option>
          <option v-for="c in clusters" :key="c.id" :value="c.id">
            {{ c.id }} · {{ c.kind }}{{ c.enabled ? '' : '（目录已禁用）' }}
          </option>
        </select></label
      >
      <label class="inline-select"
        >Kubernetes Namespace
        <select
          v-model="kubeNamespace"
          aria-label="部署 Namespace"
          :disabled="busy || !cluster || !!draft || !!selected"
          @change="action(list)"
        >
          <option value="" disabled>选择 Namespace</option>
          <option v-for="n in namespaces" :key="n.name" :value="n.name" :disabled="n.phase !== 'Active'">
            {{ n.name }}{{ n.executionDefault ? '（默认）' : ''
            }}{{ n.phase !== 'Active' ? '（不可用）' : '' }}
          </option>
        </select>
      </label>
      <button v-if="!catalogsLoaded" :disabled="busy" @click="action(catalogs)">重试目录</button
      ><button
        v-else-if="!draft"
        :disabled="busy || !cluster"
        @click="selected ? detail(selected) : action(() => loadNamespaces())"
      >
        {{ busy ? '读取中…' : '↻ 刷新状态' }}
      </button>
    </div>
    <form v-if="draft" class="management-editor" @submit.prevent="save">
      <h2>{{ draft.resourceVersion ? '编辑部署' : '创建常驻部署' }}</h2>
      <fieldset class="catalog-fields" :disabled="busy">
        <div class="form-grid">
          <label
            >部署名称<input
              v-model="draft.name"
              :disabled="!!draft.resourceVersion"
              required
              pattern="[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?"
              placeholder="小写字母、数字和连字符"
          /></label>
          <label
            >应用版本<select
              v-model="draft.application"
              aria-label="应用版本"
              required
              @change="changeApplication"
            >
              <option value="" disabled>选择已登记版本</option>
              <option
                v-for="a in apps"
                :key="`${a.applicationId}/${a.version}`"
                :value="`${a.applicationId}/${a.version}`"
              >
                {{ a.applicationId }}/{{ a.version }}
              </option>
            </select></label
          >
          <label
            >副本数<input type="number" v-model.number="draft.replicas" required min="0" max="100" step="1"
          /></label>
        </div>
        <section class="deployment-section">
          <h3>应用参数</h3>
          <DeploymentParameters v-if="app" :fields="draft.parameters" />
          <p v-else class="muted">选择应用版本后填写参数。</p>
        </section>
        <section class="deployment-section">
          <h3>每个副本的资源</h3>
          <div class="form-grid">
            <label
              >CPU 申请量<input
                v-model="draft.resources.cpuRequest"
                placeholder="例如 500m 或 0.5 核（填写数值）"
            /></label>
            <label>CPU 上限<input v-model="draft.resources.cpuLimit" placeholder="例如 1（核）" /></label>
            <label
              >内存申请量<input v-model="draft.resources.memoryRequest" placeholder="例如 256Mi"
            /></label>
            <label
              >内存上限<input v-model="draft.resources.memoryLimit" placeholder="例如 512Mi 或 1Gi"
            /></label>
          </div>
          <p class="muted">留空不显式设置；申请量用于调度，上限用于约束用量。</p>
        </section>
        <section class="deployment-section">
          <h3>健康检查</h3>
          <label class="probe-toggle"
            ><input type="checkbox" v-model="draft.readinessEnabled" />HTTP 就绪探针</label
          >
          <div v-if="draft.readinessEnabled" class="form-grid">
            <label>就绪路径<input v-model="draft.readinessPath" required pattern="/.*" /></label>
            <label
              >就绪端口<input
                type="number"
                v-model.number="draft.readinessPort"
                required
                min="1"
                max="65535"
                step="1"
            /></label>
          </div>
          <p class="muted">
            {{
              draft.readinessEnabled
                ? '检查容器内部的 HTTP 接口，不会创建访问入口；路径必须由程序实际提供。'
                : '未启用时，容器就绪不代表业务接口已通过检查。'
            }}
          </p>
        </section>
        <details class="deployment-section" :open="draft.customCommand || undefined">
          <summary>高级配置</summary>
          <label class="probe-toggle"
            ><input type="checkbox" v-model="draft.customCommand" />自定义启动命令</label
          >
          <p v-if="!draft.customCommand" class="muted">使用镜像默认启动配置。</p>
          <label class="span-2" v-if="draft.customCommand"
            >启动命令 JSON<textarea
              v-model="draft.command"
              aria-label="启动命令 JSON"
              rows="3"
              spellcheck="false"
              required
            />
          </label>
        </details>
        <button class="primary" type="submit">
          {{ writing ? '正在准备镜像并提交…' : draft.resourceVersion ? '保存部署' : '创建部署' }}
        </button>
      </fieldset>
    </form>
    <section v-else-if="selected" class="management-editor">
      <div class="section-heading">
        <h2>{{ selected.name }}</h2>
        <button :disabled="busy" @click="edit">编辑配置</button>
        <button class="danger" :disabled="busy" @click="remove">删除部署</button>
      </div>
      <dl class="detail-grid">
        <dt>应用版本</dt>
        <dd>{{ selected.applicationId }}/{{ selected.version }}</dd>
        <dt>期望 / 就绪副本</dt>
        <dd>{{ selected.replicas }} / {{ selected.readyReplicas }}</dd>
        <dt>控制器已观测当前配置</dt>
        <dd>{{ selected.observed ? '是' : '否' }}</dd>
        <dt>资源版本</dt>
        <dd class="mono">{{ selected.resourceVersion }}</dd>
        <dt>实际镜像</dt>
        <dd class="mono">{{ selected.image }}</dd>
        <dt>最近操作</dt>
        <dd>
          {{ operationName(selected.latestOperation?.operation) }} ·
          {{ stateName(selected.latestOperation?.state) }}
        </dd>
        <dt>最近操作耗时</dt>
        <dd>{{ durationText(selected.latestOperation?.durationMs) }}</dd>
        <dt>部署目标（30 s）</dt>
        <dd>{{ deploymentTarget(selected.latestOperation) }}</dd>
      </dl>
      <form class="inline-form" @submit.prevent="scale">
        <label
          >调整副本数<input
            aria-label="调整副本数"
            type="number"
            v-model.number="scaleReplicas"
            required
            min="0"
            max="100"
            step="1"
            :disabled="busy"
        /></label>
        <button type="submit" :disabled="busy || scaleReplicas === selected.replicas">应用副本数</button>
      </form>
      <section class="deployment-section">
        <h3>运行实例</h3>
        <p v-if="runtimeError" class="notice error" role="alert">{{ runtimeError }}</p>
        <div v-else-if="runtime" class="table-wrap">
          <table aria-label="部署实例">
            <thead>
              <tr>
                <th>Pod</th>
                <th>状态</th>
                <th>就绪</th>
                <th>节点</th>
                <th>重启次数</th>
                <th>异常 / 最近退出原因</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="pod in runtime.pods" :key="pod.name">
                <td>{{ pod.name }}</td>
                <td>{{ pod.phase }}</td>
                <td>{{ pod.ready ? '是' : '否' }}</td>
                <td>{{ pod.node || '—' }}</td>
                <td>{{ pod.restarts }}</td>
                <td>
                  <div v-for="reason in pod.reasons" :key="reason">{{ reason }}</div>
                  <span v-if="!pod.reasons.length">—</span>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="!runtime.pods.length" class="muted">当前没有此部署的实例。</p>
        </div>
      </section>
      <section class="deployment-section">
        <div class="section-heading">
          <h3>访问入口</h3>
          <button :disabled="busy || !runtime" @click="configureAccess">配置访问入口</button>
        </div>
        <p v-if="accessError" class="notice error" role="alert">{{ accessError }}</p>
        <template v-else-if="runtime">
          <div v-for="service in services" :key="service.name" class="access-item">
            <strong>{{ service.name }}</strong> · {{ service.type }}
            <div>
              集群内地址：{{ service.name }}.{{ runtime.namespace }}.svc<span
                v-for="port in service.ports"
                :key="port.name || port.port"
              >
                · {{ port.port }}/{{ port.protocol }} → {{ port.targetPort
                }}<span v-if="port.nodePort">（NodePort {{ port.nodePort }}）</span></span
              >
            </div>
            <div v-if="service.externalAddresses.length">
              外部地址：{{ service.externalAddresses.join('、') }}
            </div>
          </div>
          <p v-if="!services.length" class="muted">尚未关联 Service，未配置稳定访问入口。</p>
          <div v-for="ingress in ingresses" :key="ingress.name" class="access-item">
            <strong>Ingress · {{ ingress.name }}</strong>
            <div v-for="route in ingress.routes" :key="`${route.host}/${route.path}/${route.service}`">
              {{ route.host || '任意主机' }}{{ route.path }} → {{ route.service }}:{{ route.port
              }}<span v-if="ingressRouteUrl(ingress, route, ingressClasses)">
                ·
                <a
                  :href="ingressRouteUrl(ingress, route, ingressClasses)"
                  target="_blank"
                  rel="noopener noreferrer"
                  >访问 ↗</a
                ></span
              >
            </div>
          </div>
        </template>
      </section>
      <h3>控制器条件</h3>
      <ul v-if="selected.conditions.length">
        <li v-for="c in selected.conditions" :key="c" class="mono">{{ c }}</li>
      </ul>
      <p v-else class="muted">尚无条件记录。</p>
      <h3>部署操作历史</h3>
      <div class="table-wrap">
        <table aria-label="部署操作历史">
          <thead>
            <tr>
              <th>操作</th>
              <th>应用版本</th>
              <th>副本</th>
              <th>状态</th>
              <th>开始时间</th>
              <th>耗时</th>
              <th>部署目标</th>
              <th>错误</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in history" :key="r.id">
              <td>{{ operationName(r.operation) }}</td>
              <td>{{ r.applicationId }}/{{ r.version }}</td>
              <td>{{ r.targetReplicas }}</td>
              <td>{{ stateName(r.state) }}</td>
              <td>{{ time(r.startedAt) }}</td>
              <td>{{ durationText(r.durationMs) }}</td>
              <td>{{ deploymentTarget(r) }}</td>
              <td>{{ r.error || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <button
          :disabled="busy || historyOffset === 0"
          @click="
            historyOffset -= 20;
            action(loadHistory);
          "
        >
          上一页</button
        ><span>第 {{ historyOffset / 20 + 1 }} 页</span
        ><button
          :disabled="busy || history.length < 20"
          @click="
            historyOffset += 20;
            action(loadHistory);
          "
        >
          下一页
        </button>
      </div>
    </section>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>部署名称</th>
            <th>应用版本</th>
            <th>期望副本</th>
            <th>就绪副本</th>
            <th>配置已观测</th>
            <th>最近操作 / 耗时</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.name">
            <td>{{ r.name }}</td>
            <td>{{ r.applicationId }}/{{ r.version }}</td>
            <td>{{ r.replicas }}</td>
            <td>{{ r.readyReplicas }}</td>
            <td>{{ r.observed ? '是' : '否' }}</td>
            <td>
              {{ stateName(r.latestOperation?.state) }} · {{ durationText(r.latestOperation?.durationMs) }}
            </td>
            <td><button :disabled="busy" @click="detail(r)">详情 →</button></td>
          </tr>
        </tbody>
      </table>
      <div v-if="!rows.length" class="empty">
        <span>◇</span>
        <h2>
          {{ busy ? '正在读取…' : !cluster ? '选择执行集群' : loaded ? '暂无常驻部署' : '未能读取部署状态' }}
        </h2>
      </div>
    </div>
  </section>
</template>
<style scoped>
.deployment-section {
  border-top: 1px solid var(--border, #e5e0ef);
  padding-top: 20px;
  margin-top: 24px;
}
.deployment-section h3 {
  margin: 0 0 16px;
}
.probe-toggle {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  margin: 16px 0;
}
.probe-toggle input {
  width: auto;
  margin: 0;
}
.catalog-fields > button[type='submit'] {
  margin-top: 20px;
}
.access-item {
  padding: 12px 0;
  overflow-wrap: anywhere;
  line-height: 1.8;
}
table[aria-label='部署实例'] {
  min-width: 800px;
}
table[aria-label='部署实例'] td {
  overflow-wrap: anywhere;
  max-width: 380px;
}
table[aria-label='部署操作历史'] {
  min-width: 860px;
}
table[aria-label='部署操作历史'] td {
  white-space: nowrap;
}
.management-editor li.mono {
  overflow-wrap: anywhere;
}
@media (max-width: 650px) {
  .list-toolbar,
  .section-heading {
    flex-wrap: wrap;
  }
  .list-toolbar .inline-select {
    min-width: 0;
    width: 100%;
  }
  .detail-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
  }
  .detail-grid dd {
    margin-bottom: 10px;
  }
}
</style>
