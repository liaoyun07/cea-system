<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { errorText } from '../api.js';
import { readCatalog } from '../no-code/document.js';
import { deploymentBody, deploymentDraft, enc } from './catalogs.js';
import { time } from '../model.js';
import { durationText, deploymentTarget, operationName, stateName } from './operations.js';
const props = defineProps({ api: Function });
const emit = defineEmits(['dirty', 'pending']);
const clusters = ref([]),
  apps = ref([]),
  cluster = ref(''),
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
const path = (name) => `/clusters/${enc(cluster.value)}/deployments${name ? `/${enc(name)}` : ''}`;
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
  loaded.value = false;
  if (!cluster.value) return;
  const result = await api(path());
  if (alive) {
    rows.value = result;
    loaded.value = true;
  }
}
function create() {
  draft.value = {
    name: '',
    application: '',
    replicas: 1,
    parameters: '{}',
    command: '[]',
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
    }
  });
}
async function loadHistory() {
  const result = await api(`${path(selected.value.name)}/history?limit=20&offset=${historyOffset.value}`);
  if (alive) history.value = result;
}
async function edit() {
  await action(async () => {
    const result = await api(`${path(selected.value.name)}/configuration`);
    if (!alive) return;
    draft.value = deploymentDraft(selected.value.name, result);
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
    success.value = '副本配置已提交';
  }, true);
}
async function remove() {
  const value = selected.value;
  if (
    !window.confirm(
      `删除集群 ${cluster.value} 的部署 ${value.name}？将使用当前 resourceVersion ${value.resourceVersion}，不会删除应用或数据集。`,
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
        <h1>应用部署</h1>
      </div>
      <button
        v-if="!draft && !selected"
        class="primary"
        :disabled="busy || !cluster || !catalogsLoaded"
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
          @change="action(list)"
        >
          <option value="" disabled>选择集群</option>
          <option v-for="c in clusters" :key="c.id" :value="c.id">
            {{ c.id }} · {{ c.kind }}{{ c.enabled ? '' : '（目录已禁用）' }}
          </option>
        </select></label
      ><button v-if="!catalogsLoaded" :disabled="busy" @click="action(catalogs)">重试目录</button
      ><button
        v-else-if="!draft"
        :disabled="busy || !cluster"
        @click="selected ? detail(selected) : action(list)"
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
            >应用版本<select v-model="draft.application" aria-label="应用版本" required>
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
          <label class="span-2"
            >参数值 JSON<textarea v-model="draft.parameters" rows="4" spellcheck="false" required />
          </label>
          <label class="checkbox-row"
            ><input type="checkbox" v-model="draft.readinessEnabled" />HTTP 就绪探针</label
          >
          <template v-if="draft.readinessEnabled">
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
          </template>
          <label class="span-2"
            >启动命令 JSON<textarea
              v-model="draft.command"
              aria-label="启动命令 JSON"
              rows="3"
              spellcheck="false"
              required
            />
          </label>
        </div>
        <details v-if="app">
          <summary>所选版本的参数契约</summary>
          <pre>{{ JSON.stringify(app.parameters, null, 2) }}</pre>
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
table[aria-label='部署操作历史'] {
  min-width: 860px;
}
table[aria-label='部署操作历史'] td {
  white-space: nowrap;
}
</style>
