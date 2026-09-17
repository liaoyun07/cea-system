<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { errorText } from '../api.js';
import { time } from '../model.js';
import { readCatalog } from '../no-code/document.js';
import { durationText } from './operations.js';
import ExecutionDetail from '../ExecutionDetail.vue';

const props = defineProps({ api: Function });
const rows = ref([]),
  policies = ref([]),
  policyId = ref(''),
  state = ref('');
const offset = ref(0),
  busy = ref(false),
  error = ref(''),
  catalogError = ref('');
const selected = ref(null),
  loaded = ref(false);
const states = [
  'CREATED',
  'QUEUED',
  'RUNNING',
  'RETRYING',
  'KILLING',
  'SUCCESS',
  'FAILED',
  'KILLED',
  'SKIPPED',
];
let alive = true,
  generation = 0;
onBeforeUnmount(() => {
  alive = false;
  generation++;
});
async function load() {
  const request = ++generation;
  busy.value = true;
  loaded.value = false;
  error.value = '';
  rows.value = [];
  const query = new URLSearchParams({ limit: 20, offset: offset.value });
  if (policyId.value) query.set('policyId', policyId.value);
  if (state.value) query.set('state', state.value);
  try {
    const result = await props.api(`/edge/processing-records?${query}`);
    if (alive && request === generation) {
      rows.value = result;
      loaded.value = true;
    }
  } catch (e) {
    if (alive && request === generation) error.value = errorText(e);
  } finally {
    if (alive && request === generation) busy.value = false;
  }
}
async function loadPolicies() {
  catalogError.value = '';
  try {
    const result = await readCatalog(props.api, '/edge/policies');
    if (alive) policies.value = result;
  } catch (e) {
    if (alive) catalogError.value = errorText(e);
  }
}
function filter() {
  offset.value = 0;
  load();
}
function paginate(delta) {
  offset.value += delta * 20;
  load();
}
function refresh() {
  load();
  loadPolicies();
}
function back() {
  selected.value = null;
  load();
}
onMounted(refresh);
</script>

<template>
  <div v-if="selected">
    <div class="edge-record-back"><button @click="back">← 返回处理记录</button></div>
    <ExecutionDetail :key="selected" :api="api" :execution-id="selected" />
  </div>
  <section v-else class="list-page">
    <div class="page-heading">
      <div>
        <span class="eyebrow">EDGE PROCESSING</span>
        <h1>边缘数据处理记录</h1>
      </div>
      <button :disabled="busy" @click="refresh">{{ busy ? '加载中…' : '↻ 刷新' }}</button>
    </div>
    <div class="edge-record-filters">
      <label
        >策略<select v-model="policyId" :disabled="busy" @change="filter">
          <option value="">全部策略</option>
          <option v-for="policy in policies" :key="policy.id" :value="policy.id">
            {{ policy.id }}{{ policy.enabled ? '' : ' · 已停用' }}
          </option>
        </select></label
      >
      <label
        >状态<select v-model="state" :disabled="busy" @change="filter">
          <option value="">全部状态</option>
          <option v-for="value in states" :key="value" :value="value">{{ value }}</option>
        </select></label
      >
    </div>
    <div v-if="catalogError" class="notice error" role="alert">策略列表：{{ catalogError }}</div>
    <div v-if="error" class="notice error" role="alert">{{ error }}</div>
    <div class="table-wrap">
      <table class="edge-record-table">
        <thead>
          <tr>
            <th>策略 / 执行 ID</th>
            <th>来源终端 / 网关</th>
            <th>来源边缘</th>
            <th>状态</th>
            <th>提交时间</th>
            <th>开始 / 结束</th>
            <th>执行耗时</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.execution.id">
            <td>
              <strong>{{ row.execution.flowId }}</strong>
              <span class="tag">r{{ row.execution.flowRevision }}</span>
              <small>{{ row.eventType }}</small>
              <button class="text-link mono" @click="selected = row.execution.id">
                {{ row.execution.id }}
              </button>
            </td>
            <td>
              {{ row.origin?.terminalId || '—' }}<small>{{ row.origin?.gatewayId || '—' }}</small>
            </td>
            <td>{{ row.origin?.clusterId || '—' }}</td>
            <td>
              <span class="status" :data-state="row.execution.state">{{ row.execution.state }}</span>
            </td>
            <td>{{ time(row.execution.createdAt) }}</td>
            <td>
              {{ time(row.execution.startedAt) }}<small>{{ time(row.execution.endedAt) }}</small>
            </td>
            <td>
              {{
                row.execution.startedAt && row.execution.endedAt
                  ? durationText(Date.parse(row.execution.endedAt) - Date.parse(row.execution.startedAt))
                  : '—'
              }}
            </td>
            <td><button @click="selected = row.execution.id">详情与结果 →</button></td>
          </tr>
        </tbody>
      </table>
      <div v-if="!rows.length && !error" class="empty">
        <span>⋈</span>
        <h2>{{ busy ? '正在加载…' : '暂无处理记录' }}</h2>
      </div>
    </div>
    <footer class="pagination">
      <span>每页 20 条 · 第 {{ offset / 20 + 1 }} 页</span>
      <div>
        <button :disabled="busy || offset === 0" @click="paginate(-1)">上一页</button
        ><button :disabled="busy || !loaded || rows.length < 20" @click="paginate(1)">下一页</button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.edge-record-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 20px;
}
.edge-record-filters label {
  display: grid;
  gap: 8px;
  width: min(300px, 100%);
}
.edge-record-table {
  min-width: 1160px;
}
.edge-record-table small {
  display: block;
  margin-top: 6px;
  color: var(--muted);
}
.edge-record-table .mono {
  display: block;
  max-width: 285px;
  overflow-wrap: anywhere;
  margin-top: 6px;
  text-align: left;
}
.edge-record-back {
  padding: 20px 28px 0;
}
</style>
