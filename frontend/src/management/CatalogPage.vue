<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { errorText } from '../api.js';
import { time } from '../model.js';
import { readCatalog, readDocument } from '../no-code/document.js';
import { catalogs, entryId, itemPath, newDraft, applicationDraft, requestBody, enc } from './catalogs.js';
import CatalogForm from './CatalogForm.vue';

const props = defineProps({ kind: String, api: Function, namespace: String });
const emit = defineEmits(['dirty', 'pending', 'execution']);
const config = computed(() => catalogs[props.kind]);
const rows = ref([]),
  offset = ref(0),
  busy = ref(false),
  writing = ref(false),
  loaded = ref(false),
  error = ref(''),
  success = ref('');
const draft = ref(null),
  existing = ref(false),
  immutable = computed(() => ['applications', 'datasets'].includes(props.kind)),
  raw = ref(null),
  baseline = ref(''),
  invalid = ref(false);
const clusters = ref([]),
  datasets = ref([]),
  gateways = ref([]),
  catalogError = ref('');
const targetCluster = ref(''),
  prepared = ref(null);
const form = ref(null);
const abort = new AbortController();
let alive = true;
const dirty = computed(
  () => !!draft.value && !readonly.value && JSON.stringify(draft.value) !== baseline.value,
);
const readonly = computed(() => existing.value && immutable.value);
watch(dirty, (v) => emit('dirty', v));
watch(writing, (v) => emit('pending', v), { flush: 'sync' });
onBeforeUnmount(() => {
  alive = false;
  abort.abort();
});
const api = (path, options = {}) =>
  props.api(path, {
    ...options,
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(options.long ? 600000 : 20000)]),
  });

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
async function loadRows() {
  loaded.value = false;
  rows.value = [];
  const result = await api(`${config.value.path}?limit=20&offset=${offset.value}`);
  if (alive) {
    rows.value = result;
    loaded.value = true;
  }
}
async function dependencies() {
  catalogError.value = '';
  try {
    const paths =
      {
        applications: ['/resources/clusters', '/resources/datasets'],
        datasets: ['/resources/clusters'],
        gateways: ['/resources/clusters'],
        policies: ['/resources/clusters'],
        terminals: ['/edge/gateways'],
      }[props.kind] || [];
    const values = await Promise.all(paths.map((p) => readCatalog(api, p)));
    if (!alive) return;
    paths.forEach((p, i) => {
      if (p.endsWith('/clusters')) clusters.value = values[i];
      else if (p.endsWith('/datasets')) datasets.value = values[i];
      else gateways.value = values[i];
    });
  } catch (e) {
    if (alive) catalogError.value = errorText(e);
  }
}
function begin(value, saved = false, record = null) {
  draft.value = value;
  existing.value = saved;
  raw.value = record;
  baseline.value = JSON.stringify(value);
  error.value = '';
  success.value = '';
  invalid.value = false;
  prepared.value = null;
  targetCluster.value = '';
}
async function open(row) {
  await action(async () => {
    await dependencies();
    if (!alive) return;
    if (props.kind === 'observations') {
      raw.value = row;
      return;
    }
    if (!row) {
      begin(newDraft(props.kind, props.namespace));
      return;
    }
    let data = row;
    if (immutable.value || props.kind === 'policies') data = await api(itemPath(props.kind, row));
    if (!alive) return;
    if (props.kind === 'applications') begin(applicationDraft(data), true, data);
    else if (props.kind === 'policies')
      begin({ ...data.policy, expectedRevision: data.flow.revision, source: data.flow.source }, true, data);
    else if (props.kind === 'gateways')
      begin(
        { id: row.id, clusterId: row.clusterId, principal: row.principal, enabled: row.enabled },
        true,
        row,
      );
    else if (props.kind === 'terminals')
      begin({ id: row.id, gatewayId: row.gatewayId, enabled: row.enabled }, true, row);
    else begin(JSON.parse(JSON.stringify(data)), true, data);
  });
}
function back() {
  if (busy.value || (dirty.value && !window.confirm('放弃未保存的修改？'))) return;
  draft.value = null;
  raw.value = null;
  error.value = '';
  success.value = '';
  invalid.value = false;
  action(loadRows);
}
function cloneVersion() {
  const value = JSON.parse(JSON.stringify(draft.value));
  value.version = '';
  begin(value);
  baseline.value = ''; // A copy is an unsaved new version, not an edit of the original.
}
async function save() {
  if (readonly.value || invalid.value || !form.value.reportValidity()) return;
  await action(async () => {
    const body = requestBody(props.kind, draft.value);
    const result = await api(itemPath(props.kind, draft.value), { method: 'PUT', body });
    if (!alive) return;
    if (props.kind === 'policies')
      draft.value = { ...result.policy, expectedRevision: result.flow.revision, source: result.flow.source };
    existing.value = true;
    raw.value = result;
    baseline.value = JSON.stringify(draft.value);
    success.value = props.kind === 'policies' ? `策略已保存 · r${result.flow.revision}` : '已保存到目录';
  }, true);
}
async function validatePolicy() {
  await action(async () => {
    const value = readDocument(draft.value.source).value;
    if (value.schedule && !value.schedule.disabled)
      throw new Error('策略不能启用独立 Schedule，请移除或禁用。');
    await api(`/flows/${enc(draft.value.id)}/validate`, {
      method: 'POST',
      body: { source: draft.value.source },
    });
    if (alive) success.value = 'Flow 校验通过；事件路由和修订在保存时校验。此操作没有保存或执行。';
  });
}
async function prepare() {
  if (!targetCluster.value || !readonly.value) return;
  prepared.value = null;
  await action(async () => {
    const result = await api(
      `${itemPath('applications', draft.value)}/preparations/${enc(targetCluster.value)}`,
      { method: 'POST', long: true },
    );
    if (alive) {
      prepared.value = result;
      success.value = '镜像准备完成 · 未启动容器';
    }
  }, true);
}
function cell(row, key) {
  const value = row[key];
  if (key === 'enabled') return value ? '启用' : '停用';
  if (key.endsWith('At')) return value ? time(value) : '尚无记录';
  if (key === 'locations') return value.map((v) => v.clusterId).join('、');
  if (key === 'target') return `${value.kind} / ${value.id}`;
  return value ?? '—';
}
onMounted(() => action(loadRows));
</script>

<template>
  <section class="list-page management-page">
    <div class="page-heading">
      <div>
        <span class="eyebrow">{{ config.caption }}</span>
        <h1>{{ config.title }}</h1>
      </div>
      <button v-if="!draft && !raw && config.create" class="primary" :disabled="busy" @click="open()">
        ＋ {{ config.create }}
      </button>
      <button v-if="draft || raw" :disabled="busy" @click="back">← 返回列表</button>
    </div>
    <div v-if="error" class="notice error" role="alert">{{ error }}</div>
    <div v-if="success" class="notice success" role="status">{{ success }}</div>
    <template v-if="draft">
      <div v-if="catalogError" class="notice error" role="alert">
        候选目录读取失败：{{ catalogError }}
        <button :disabled="busy" @click="action(dependencies)">重试目录</button>
      </div>
      <form ref="form" class="management-editor" @submit.prevent>
        <div class="editor-actions management-actions">
          <div>
            <h2>{{ readonly ? '版本详情' : existing ? '编辑配置' : '新建登记' }}</h2>
            <span class="muted small">{{
              dirty ? '有未保存修改' : readonly ? '不可变版本' : existing ? '已保存' : '未保存'
            }}</span>
          </div>
          <div class="button-row">
            <button
              v-if="kind === 'policies'"
              type="button"
              :disabled="busy || invalid"
              @click="validatePolicy"
            >
              校验策略
            </button>
            <button v-if="readonly" type="button" :disabled="busy" @click="cloneVersion">
              基于此版本新建
            </button>
            <button
              v-else
              type="button"
              class="primary"
              :disabled="busy || invalid || !!catalogError"
              @click="save"
            >
              {{ writing ? '正在提交…' : '保存配置' }}
            </button>
          </div>
        </div>
        <CatalogForm
          :kind="kind"
          :draft="draft"
          :existing="existing"
          :readonly="readonly"
          :busy="busy"
          :api="api"
          :namespace="namespace"
          :clusters="clusters"
          :datasets="datasets"
          :gateways="gateways"
          @invalid="invalid = $event"
        />
      </form>
      <section v-if="kind === 'applications' && readonly" class="management-editor">
        <h2>准备 / 分发镜像</h2>
        <div class="inline-form">
          <label
            >目标集群<select v-model="targetCluster" aria-label="目标集群" :disabled="busy">
              <option value="" disabled>选择目标集群</option>
              <option v-for="c in clusters.filter((c) => c.enabled)" :key="c.id" :value="c.id">
                {{ c.id }} · {{ c.kind }}
              </option>
            </select></label
          ><button class="primary" :disabled="busy || !targetCluster || !!catalogError" @click="prepare">
            {{ writing ? '镜像准备中…' : '准备镜像' }}
          </button>
        </div>
        <div v-if="prepared" class="prepared-result" role="status">
          <span class="tag">{{ prepared.clusterId }}</span
          ><code>{{ prepared.image }}</code>
        </div>
      </section>
      <details v-if="raw" class="raw-detail">
        <summary>服务端原始记录</summary>
        <pre>{{ JSON.stringify(raw, null, 2) }}</pre>
      </details>
    </template>
    <section v-else-if="raw" class="management-editor">
      <h2>卸载样本</h2>
      <p class="muted">{{ raw.strategy }} · {{ raw.outcome || '尚未完成' }}</p>
      <button v-if="raw.executionId" @click="emit('execution', raw.executionId)">查看关联执行</button>
      <pre class="record-json">{{ JSON.stringify(raw, null, 2) }}</pre>
    </section>
    <template v-else>
      <div class="list-toolbar">
        <span class="muted">当前命名空间 · 每页 20 条</span
        ><button :disabled="busy" @click="action(loadRows)">{{ busy ? '加载中…' : '↻ 刷新' }}</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th v-for="[key, title] in config.columns" :key="key">{{ title }}</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="`${entryId(row)}/${row.version || ''}`">
              <td v-for="[key] in config.columns" :key="key">
                <span :class="{ tag: key === 'kind', mono: key === 'image' }">{{ cell(row, key) }}</span>
              </td>
              <td>
                <button :disabled="busy" @click="open(row)">
                  {{ immutable || kind === 'observations' ? '详情' : '编辑' }} →
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="!rows.length" class="empty">
          <span>◇</span>
          <h2>{{ busy ? '正在读取…' : loaded ? '暂无记录' : '未能读取目录' }}</h2>
        </div>
      </div>
      <footer class="pagination">
        <span>第 {{ offset / 20 + 1 }} 页</span>
        <div>
          <button
            :disabled="busy || offset === 0"
            @click="
              offset -= 20;
              action(loadRows);
            "
          >
            上一页</button
          ><button
            :disabled="busy || !loaded || rows.length < 20"
            @click="
              offset += 20;
              action(loadRows);
            "
          >
            下一页
          </button>
        </div>
      </footer>
    </template>
  </section>
</template>
