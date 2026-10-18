<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { errorText } from '../api.js';
import { readCatalog } from '../no-code/document.js';
import { deploymentBody, deploymentDraft, deploymentFields, enc } from './catalogs.js';
import DeploymentParameters from './DeploymentParameters.vue';
import AutoscalingFields from './AutoscalingFields.vue';
import DeploymentScaling from './DeploymentScaling.vue';
import { time } from '../model.js';
import { durationText, operationName, stateName, ingressRouteUrl } from './operations.js';
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
const warmPool = ref(null),
  budgetDraft = ref(null);
let refreshTimer,
  refreshing = false;
const history = ref([]),
  historyOffset = ref(0),
  scaleReplicas = ref(1);
const autoscaling = ref(null),
  autoscalingError = ref(''),
  hpaDraft = ref(null);
let alive = true;
const api = (path, options = {}) =>
  props.api(path, {
    ...options,
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(options.long ? 600000 : 20000)]),
  });
watch(
  () => !!hpaDraft.value || (draft.value && JSON.stringify(draft.value) !== baseline.value),
  (v) => emit('dirty', !!v),
);
watch(writing, (v) => emit('pending', v), { flush: 'sync' });
onBeforeUnmount(() => {
  alive = false;
  clearInterval(refreshTimer);
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
  autoscaling.value = null;
  hpaDraft.value = null;
  rows.value = [];
  selected.value = null;
  runtime.value = null;
  loaded.value = false;
  if (!cluster.value || !kubeNamespace.value) return;
  const result = await api(path());
  warmPool.value = await api(`${path()}/-/warm-pool`);
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
  autoscaling.value = null;
  draft.value = {
    name: '',
    application: '',
    replicas: 1,
    warmPool: false,
    autoscalingEnabled: false,
    autoscaling: { minReplicas: 1, maxReplicas: 4, cpuUtilization: 60, memoryUtilization: '' },
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
    ((hpaDraft.value || (draft.value && JSON.stringify(draft.value) !== baseline.value)) &&
      !window.confirm('放弃未保存的部署配置？'))
  )
    return;
  draft.value = null;
  hpaDraft.value = null;
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
      success.value = '部署已提交';
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
  const name = selected.value.name;
  const result = await api(`${path(name)}/history?limit=20&offset=${historyOffset.value}`);
  if (alive && selected.value?.name === name) history.value = result;
}
function changeApplication() {
  draft.value.parameters = deploymentFields(app.value?.parameters);
}
async function loadRuntime(quiet = false) {
  const name = selected.value?.name;
  if (!name) return;
  await loadAutoscaling(quiet);
  if (!alive || selected.value?.name !== name) return;
  if (!quiet) runtime.value = null;
  runtimeError.value = '';
  accessError.value = '';
  if (!quiet) {
    services.value = [];
    ingresses.value = [];
  }
  try {
    const value = await api(`${path(name)}/runtime`);
    if (!alive || selected.value?.name !== name) return;
    runtime.value = value;
    const scope = `/clusters/${enc(cluster.value)}/kubernetes/namespaces/${enc(value.namespace)}`;
    try {
      const [allServices, allIngresses, classes] = await Promise.all([
        api(`${scope}/services`),
        api(`${scope}/ingresses`),
        api(`/clusters/${enc(cluster.value)}/kubernetes/ingress-classes`),
      ]);
      if (!alive || selected.value?.name !== name) return;
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
async function loadAutoscaling(quiet = false) {
  const name = selected.value?.name;
  if (!name) return;
  if (!quiet) autoscaling.value = null;
  autoscalingError.value = '';
  try {
    const value = await api(`${path(name)}/autoscaling`);
    if (alive && selected.value?.name === name) autoscaling.value = value;
  } catch (e) {
    if (alive && selected.value?.name === name) {
      autoscaling.value = null;
      autoscalingError.value = errorText(e);
    }
  }
}
function editAutoscaling() {
  const value = autoscaling.value;
  hpaDraft.value = {
    minReplicas: value.minReplicas ?? 1,
    maxReplicas: value.maxReplicas ?? 3,
    cpuUtilization: value.enabled
      ? (value.metrics.find((m) => m.resource === 'cpu')?.targetUtilization ?? '')
      : 60,
    memoryUtilization: value.metrics.find((m) => m.resource === 'memory')?.targetUtilization ?? '',
    resourceVersion: value.resourceVersion,
  };
}
async function saveAutoscaling() {
  await action(async () => {
    const value = hpaDraft.value;
    await api(`${path(selected.value.name)}/autoscaling`, {
      method: 'PUT',
      body: {
        ...value,
        cpuUtilization: value.cpuUtilization === '' ? null : Number(value.cpuUtilization),
        memoryUtilization: value.memoryUtilization === '' ? null : Number(value.memoryUtilization),
      },
    });
    if (!alive) return;
    hpaDraft.value = null;
    selected.value = await api(path(selected.value.name));
    scaleReplicas.value = selected.value.replicas;
    await loadAutoscaling();
    success.value = '自动扩缩容配置已保存';
  }, true);
}
async function disableAutoscaling() {
  await action(async () => {
    await api(
      `${path(selected.value.name)}/autoscaling?resourceVersion=${enc(autoscaling.value.resourceVersion)}`,
      { method: 'DELETE' },
    );
    if (!alive) return;
    hpaDraft.value = null;
    selected.value = await api(path(selected.value.name));
    scaleReplicas.value = selected.value.replicas;
    await loadAutoscaling();
    success.value = '自动扩缩容已关闭，保留当前副本数';
  }, true);
}
function configureAccess() {
  emit('access', {
    cluster: cluster.value,
    namespace: runtime.value.namespace,
    name: selected.value.name,
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
async function saveBudget() {
  await action(async () => {
    warmPool.value = await api(`${path()}/-/warm-pool`, { method: 'PUT', body: budgetDraft.value });
    budgetDraft.value = null;
    success.value = '预热预算已保存';
  }, true);
}
onMounted(() => {
  action(catalogs);
  refreshTimer = setInterval(async () => {
    if (busy.value || refreshing || draft.value || hpaDraft.value || !selected.value) return;
    refreshing = true;
    const name = selected.value.name;
    try {
      const result = await api(path(name));
      if (!alive || selected.value?.name !== name || draft.value || hpaDraft.value || busy.value) return;
      selected.value = result;
      await loadHistory();
      await loadRuntime(true);
    } catch (e) {
      if (alive) error.value = errorText(e);
    } finally {
      refreshing = false;
    }
  }, 5000);
});
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
        :disabled="busy || !cluster || !!hpaDraft"
        @click="selected ? detail(selected) : action(() => loadNamespaces())"
      >
        {{ busy ? '读取中…' : '↻ 刷新状态' }}
      </button>
    </div>
    <div v-if="warmPool?.available && !draft && !selected" class="list-toolbar">
      <span>预热预算：{{ warmPool.count }} 个备用实例 / {{ warmPool.memoryMiB }} MiB</span>
      <button v-if="!budgetDraft" @click="budgetDraft = { ...warmPool }">设置</button>
      <form v-else class="inline-form" @submit.prevent="saveBudget">
        <label
          >备用实例上限<input v-model.number="budgetDraft.count" type="number" min="0" max="20" required
        /></label>
        <label
          >备用内存预算（MiB）<input v-model.number="budgetDraft.memoryMiB" type="number" min="0" required
        /></label>
        <button type="submit" :disabled="busy">保存</button
        ><button type="button" @click="budgetDraft = null">取消</button>
      </form>
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
            >副本数<input
              type="number"
              v-model.number="draft.replicas"
              :disabled="autoscaling?.enabled"
              required
              min="0"
              :max="draft.warmPool ? 20 : 100"
              step="1"
          /></label>
        </div>
        <section v-if="!draft.resourceVersion" class="deployment-section">
          <h3>弹性伸缩</h3>
          <label class="probe-toggle"
            ><input type="checkbox" v-model="draft.autoscalingEnabled" />启用自动扩缩容（HPA）</label
          >
          <AutoscalingFields
            v-if="draft.autoscalingEnabled"
            :value="draft.autoscaling"
            :max="draft.warmPool ? 20 : 100"
          />
          <label v-if="warmPool?.available" class="probe-toggle"
            ><input type="checkbox" v-model="draft.warmPool" />启用预热池加速</label
          >
        </section>
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
        <button :disabled="busy || !!hpaDraft || !autoscaling" @click="edit">编辑配置</button>
        <button class="danger" :disabled="busy || !!hpaDraft" @click="remove">删除部署</button>
      </div>
      <dl class="detail-grid">
        <dt>应用版本</dt>
        <dd>{{ selected.applicationId }}/{{ selected.version }}</dd>
        <dt>期望 / 就绪副本</dt>
        <dd>{{ selected.replicas }} / {{ selected.readyReplicas }}</dd>
        <dt>部署方式</dt>
        <dd>
          {{
            selected.warmPool
              ? autoscaling?.enabled
                ? 'HPA + 预热池'
                : '预热池'
              : autoscaling?.enabled
                ? 'HPA'
                : '固定副本'
          }}
        </dd>
        <dt>CPU 申请 / 上限（每副本）</dt>
        <dd>{{ selected.resources?.cpuRequest || '—' }} / {{ selected.resources?.cpuLimit || '—' }}</dd>
        <dt>内存申请 / 上限（每副本）</dt>
        <dd>{{ selected.resources?.memoryRequest || '—' }} / {{ selected.resources?.memoryLimit || '—' }}</dd>
        <dt>最近操作</dt>
        <dd>
          {{ operationName(selected.latestOperation?.operation) }} ·
          {{ stateName(selected.latestOperation?.state) }}
        </dd>
        <dt>最近操作耗时</dt>
        <dd>{{ durationText(selected.latestOperation?.durationMs) }}</dd>
      </dl>
      <DeploymentScaling
        v-if="warmPool?.available"
        :api="api"
        :path="path(selected.name)"
        :warm="selected.warmPool"
      />
      <section class="deployment-section" aria-label="自动扩缩容">
        <div class="section-heading">
          <h3>自动扩缩容 · HPA</h3>
          <span v-if="autoscaling">{{ autoscaling.enabled ? '已启用' : '未启用' }}</span>
          <button v-if="autoscaling?.editable && !hpaDraft" :disabled="busy" @click="editAutoscaling">
            {{ autoscaling.enabled ? '编辑自动扩缩容' : '启用自动扩缩容' }}
          </button>
          <button
            v-if="autoscaling?.enabled && autoscaling.editable && !hpaDraft"
            :disabled="busy"
            @click="disableAutoscaling"
          >
            关闭自动扩缩容
          </button>
        </div>
        <p v-if="autoscalingError" class="notice error" role="alert">{{ autoscalingError }}</p>
        <form v-if="hpaDraft" @submit.prevent="saveAutoscaling">
          <fieldset class="catalog-fields" :disabled="busy">
            <AutoscalingFields :value="hpaDraft" :max="selected.warmPool ? 20 : 100" />
            <div class="inline-form">
              <button class="primary" type="submit">保存自动扩缩容</button
              ><button type="button" @click="hpaDraft = null">取消</button>
            </div>
          </fieldset>
        </form>
        <template v-else-if="autoscaling?.enabled">
          <dl class="detail-grid">
            <dt>副本范围</dt>
            <dd>{{ autoscaling.minReplicas }}～{{ autoscaling.maxReplicas }}</dd>
            <dt>当前 / 期望副本</dt>
            <dd>{{ autoscaling.currentReplicas ?? '—' }} / {{ autoscaling.desiredReplicas ?? '—' }}</dd>
            <template v-for="metric in autoscaling.metrics" :key="metric.resource">
              <dt>{{ metric.resource === 'cpu' ? 'CPU' : '内存' }} 当前 / 目标利用率</dt>
              <dd>
                {{ metric.currentUtilization == null ? '—' : metric.currentUtilization + '%' }} /
                {{ metric.targetUtilization }}%
              </dd>
            </template>
            <dt>最近伸缩时间</dt>
            <dd>{{ autoscaling.lastScaleTime ? time(autoscaling.lastScaleTime) : '—' }}</dd>
          </dl>
          <p v-if="!autoscaling.editable" class="muted">此 HPA 配置由集群侧管理。</p>
          <details v-if="autoscaling.conditions.length">
            <summary>伸缩状态</summary>
            <ul>
              <li v-for="condition in autoscaling.conditions" :key="condition">{{ condition }}</li>
            </ul>
          </details>
        </template>
      </section>
      <form v-if="autoscaling && !autoscaling.enabled" class="inline-form" @submit.prevent="scale">
        <label
          >调整副本数<input
            aria-label="调整副本数"
            type="number"
            v-model.number="scaleReplicas"
            required
            min="0"
            :max="selected.warmPool ? 20 : 100"
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
                <th v-if="selected.warmPool">用途</th>
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
                <td v-if="selected.warmPool">{{ pod.standby ? '备用' : '业务' }}</td>
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
      <details v-if="selected.conditions.length" class="deployment-section">
        <summary>控制器状态</summary>
        <ul>
          <li v-for="c in selected.conditions" :key="c" class="mono">{{ c }}</li>
        </ul>
      </details>
      <details class="deployment-section">
        <summary>配置操作历史</summary>
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
      </details>
    </section>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>部署名称</th>
            <th>应用版本</th>
            <th>期望副本</th>
            <th>就绪副本</th>
            <th>部署类型</th>
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
            <td>{{ r.warmPool ? '预热池' : '常规' }}</td>
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
