<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { errorText } from '../api.js';
import { time } from '../model.js';
import { readCatalog, readDocument } from '../no-code/document.js';
import {
  catalogs,
  offloadingTarget,
  decisionLatency,
  inferenceLatency,
  measurementStatus,
  entryId,
  itemPath,
  newDraft,
  applicationDraft,
  requestBody,
  parameterContract,
  enc,
} from './catalogs.js';
import DistributionHistory from './DistributionHistory.vue';
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
const uploadMode = ref(false),
  buildMode = ref(false),
  buildLog = ref(''),
  archive = ref(null),
  historyRefresh = ref(0);
const abort = new AbortController();
let alive = true;
const dirty = computed(
  () =>
    !!draft.value && !readonly.value && (JSON.stringify(draft.value) !== baseline.value || !!archive.value),
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
    signal: AbortSignal.any([
      abort.signal,
      AbortSignal.timeout(options.build ? 1200000 : options.long ? 600000 : 20000),
    ]),
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
  uploadMode.value = false;
  buildMode.value = false;
  buildLog.value = '';
  archive.value = null;
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
async function open(row, upload = false, build = false) {
  await action(async () => {
    await dependencies();
    if (!alive) return;
    if (props.kind === 'observations') {
      raw.value = row;
      return;
    }
    if (!row) {
      begin(newDraft(props.kind, props.namespace));
      uploadMode.value = upload;
      buildMode.value = build;
      return;
    }
    let data = row;
    if (immutable.value || props.kind === 'policies') data = await api(itemPath(props.kind, row));
    if (!alive) return;
    if (props.kind === 'applications') {
      begin(applicationDraft(data), true, data);
    } else if (props.kind === 'policies')
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
    let result;
    if (uploadMode.value || buildMode.value) {
      const building = buildMode.value;
      if (
        !archive.value ||
        archive.value.size === 0 ||
        archive.value.size > (building ? 100 * 1024 ** 2 : 2 * 1024 ** 3)
      )
        throw new Error(
          building
            ? '请选择不超过 100 MiB、根目录包含 Dockerfile 的 ZIP。'
            : '请选择不超过 2 GiB 的非空 Docker save 镜像归档。',
        );
      const body = new FormData();
      body.append('file', archive.value);
      body.append(
        'contract',
        new Blob([JSON.stringify({ parameters: parameterContract(draft.value.parameterRows) })], {
          type: 'application/json',
        }),
      );
      result = await api(`${itemPath('applications', draft.value)}/${building ? 'build' : 'upload'}`, {
        method: 'POST',
        body,
        long: true,
        build: building,
      });
      if (!alive) return;
      const log = building ? result.log : '';
      if (building) result = result.application;
      begin(applicationDraft(result), true, result);
      buildLog.value = log;
    } else {
      const body = requestBody(props.kind, draft.value);
      result = await api(itemPath(props.kind, draft.value), { method: 'PUT', body });
    }
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
  if (alive) historyRefresh.value++;
}
async function removeApplication() {
  const id = `${draft.value.applicationId}/${draft.value.version}`;
  if (
    window.prompt(`从应用目录移除 ${id}？不会删除仓库镜像；此版本号不能再次使用。请输入应用 ID 确认：`) !==
    draft.value.applicationId
  )
    return;
  await action(async () => {
    await api(itemPath('applications', draft.value), { method: 'DELETE', long: true });
    if (alive) {
      draft.value = null;
      raw.value = null;
      await loadRows();
      success.value = '已从目录移除；仓库镜像保留。';
    }
  }, true);
}
async function removeDataset() {
  const id = draft.value.datasetId;
  if (
    window.prompt(
      `删除数据集 ${id}/${draft.value.version}？原始文件保留，此版本号不可复用。请输入数据集 ID：`,
    ) !== id
  )
    return;
  await action(async () => {
    await api(itemPath('datasets', draft.value), { method: 'DELETE' });
    if (alive) {
      draft.value = null;
      raw.value = null;
      await loadRows();
      success.value = '数据集版本已删除，原始文件保留';
    }
  }, true);
}
function cell(row, key) {
  const value = row[key];
  if (key === 'enabled') return value ? '启用' : '停用';
  if (key.endsWith('At')) return value ? time(value) : '尚无记录';
  if (key === 'locations') return value.map((v) => v.clusterId).join('、');
  if (key === 'target') return offloadingTarget(value);
  if (key === 'decisionMs') return decisionLatency(row);
  if (key === 'measurement') return measurementStatus(value);
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
      <div
        v-if="kind === 'applications' && !draft && !raw"
        class="catalog-heading-actions"
        role="group"
        aria-label="应用操作"
      >
        <button class="primary" :disabled="busy" @click="open()">＋ {{ config.create }}</button>
        <button :disabled="busy" @click="open(null, true)">上传镜像</button>
        <button :disabled="busy" @click="open(null, false, true)">在线构建</button>
      </div>
      <button v-else-if="!draft && !raw && config.create" class="primary" :disabled="busy" @click="open()">
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
            <h2>
              {{
                readonly
                  ? '版本详情'
                  : buildMode
                    ? '在线构建镜像'
                    : uploadMode
                      ? '上传镜像版本'
                      : existing
                        ? '编辑配置'
                        : '新建登记'
              }}
            </h2>
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
              v-if="readonly && kind === 'applications'"
              type="button"
              class="danger"
              :disabled="busy"
              @click="removeApplication"
            >
              删除应用版本
            </button>
            <button
              v-if="!readonly"
              type="button"
              class="primary"
              :disabled="busy || invalid || !!catalogError"
              @click="save"
            >
              {{
                writing
                  ? buildMode
                    ? '正在构建…'
                    : '正在提交…'
                  : buildMode
                    ? '构建并登记'
                    : uploadMode
                      ? '上传并登记'
                      : '保存配置'
              }}
            </button>
            <button
              v-if="readonly && kind === 'datasets'"
              type="button"
              class="danger"
              :disabled="busy"
              @click="removeDataset"
            >
              删除数据集版本
            </button>
          </div>
        </div>
        <label v-if="uploadMode || buildMode"
          >{{
            buildMode
              ? '构建源码（ZIP，根目录含 Dockerfile，最大 100 MiB）'
              : '镜像归档（Docker save，最大 2 GiB）'
          }}<input
            type="file"
            :accept="buildMode ? '.zip' : '.tar'"
            required
            :disabled="busy"
            @change="archive = $event.target.files[0] || null"
        /></label>
        <CatalogForm
          :kind="kind"
          :draft="draft"
          :existing="existing"
          :readonly="readonly"
          :upload="uploadMode || buildMode"
          :busy="busy"
          :api="api"
          :namespace="namespace"
          :clusters="clusters"
          :datasets="datasets"
          :gateways="gateways"
          @invalid="invalid = $event"
        />
      </form>
      <section v-if="buildLog" class="management-editor">
        <h2>构建日志</h2>
        <pre class="json-preview">{{ buildLog }}</pre>
      </section>
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
      <DistributionHistory
        v-if="kind === 'applications' && readonly"
        :api="props.api"
        :application="draft"
        :refresh="historyRefresh"
        :disabled="busy"
      />
      <details v-if="raw" class="raw-detail">
        <summary>服务端原始记录</summary>
        <pre>{{ JSON.stringify(raw, null, 2) }}</pre>
      </details>
    </template>
    <section v-else-if="raw" class="management-editor">
      <h2>卸载样本</h2>
      <p class="muted">{{ raw.strategy }} · {{ raw.outcome || '尚未完成' }}</p>
      <button v-if="raw.executionId" @click="emit('execution', raw.executionId)">查看关联执行</button>
      <dl>
        <dt>执行位置</dt>
        <dd>{{ offloadingTarget(raw.target) }}</dd>
        <dt>决策时延</dt>
        <dd>{{ decisionLatency(raw) }}</dd>
        <template v-if="raw.strategy === 'DQN'">
          <dt>模型版本</dt>
          <dd class="mono">{{ raw.modelVersion }}</dd>
          <dt>模型推理耗时</dt>
          <dd>{{ inferenceLatency(raw) }}</dd>
        </template>
      </dl>
      <template v-if="raw.measurement">
        <h3>{{ measurementStatus(raw.measurement) }}</h3>
        <div class="table-wrap">
          <table aria-label="卸载六维状态">
            <thead>
              <tr>
                <th>决策时观测</th>
                <th>值</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(label, index) in [
                  '输入量 D（MiB）',
                  '终端未完成量 QL（MiB）',
                  '边缘未完成量 QE（MiB）',
                  '云未完成量 QC（MiB）',
                  '预计边缘传输 TE（秒）',
                  '预计云传输 TC（秒）',
                ]"
                :key="label"
              >
                <td>{{ label }}</td>
                <td>
                  {{
                    raw.measurement.inputs[index] == null
                      ? '未测得'
                      : Number(raw.measurement.inputs[index]).toFixed(4)
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <dl>
          <dt>终端端到端耗时</dt>
          <dd>
            {{
              raw.measurement.elapsedSeconds == null
                ? '未测得'
                : raw.measurement.elapsedSeconds.toFixed(3) + ' 秒'
            }}
          </dd>
          <dt>反馈</dt>
          <dd>{{ raw.measurement.feedbackOutcome || '待上报' }}</dd>
          <dt>奖励</dt>
          <dd>{{ raw.reward == null ? '—' : raw.reward.toFixed(4) }}</dd>
          <dt>奖励时限</dt>
          <dd>{{ raw.measurement.limitSeconds }} 秒</dd>
          <dt>下一决策样本</dt>
          <dd class="mono">{{ raw.measurement.nextKey || '尚无下一决策' }}</dd>
        </dl>
      </template>
      <details class="raw-detail">
        <summary>原始记录</summary>
        <pre class="record-json">{{ JSON.stringify(raw, null, 2) }}</pre>
      </details>
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
<style scoped>
table[aria-label='按需分发历史'] {
  min-width: 1050px;
}
table[aria-label='按需分发历史'] td:not(:nth-child(6)):not(:last-child) {
  white-space: nowrap;
}
table[aria-label='按需分发历史'] td:nth-child(6) {
  min-width: 380px;
}
</style>
