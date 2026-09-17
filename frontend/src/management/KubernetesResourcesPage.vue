<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { errorText } from '../api.js';
import { readCatalog } from '../no-code/document.js';
import { percentText, coresText, memoryText } from './operations.js';
import KubernetesManagement from './KubernetesManagement.vue';
import KubernetesIngress from './KubernetesIngress.vue';
const props = defineProps({ api: Function, workspace: String, mode: String, context: Object });
const serviceMode = props.mode === 'services';
const tabs = serviceMode
  ? [
      ['services', 'Service'],
      ['ingresses', 'Ingress'],
      ['namespace', 'Kubernetes Namespace'],
    ]
  : [['nodes', '节点']];
const emit = defineEmits(['pending']);
const managementPending = ref(false);
function pending(value) {
  managementPending.value = value;
  emit('pending', value);
}
const refresh = ref(0);
const clusters = ref([]),
  cluster = ref(props.context?.cluster || ''),
  tab = ref(tabs[0][0]),
  data = ref(null);
const error = ref(''),
  catalogError = ref(''),
  loading = ref(false),
  catalogLoading = ref(false),
  tokens = ref(['']);
const usage = ref(null),
  usageError = ref('');
const nodeUsage = (name) => usage.value?.nodes.find((row) => row.name === name)?.usage;
const usageCards = computed(() =>
  [
    { key: 'cpu', label: '集群 CPU 使用率', field: 'cpuCores', percentage: 'cpuPercent' },
    { key: 'memory', label: '集群内存使用率', field: 'memoryBytes', percentage: 'memoryPercent' },
  ].map((card) => {
    const value = usage.value?.[card.percentage];
    const available = typeof value === 'number' && Number.isFinite(value) && value >= 0;
    const nodes = usage.value?.nodes || [];
    const complete =
      available &&
      nodes.length > 0 &&
      nodes.every(
        (node) =>
          node.usage.status === 'AVAILABLE' &&
          typeof node.usage[card.field] === 'number' &&
          Number.isFinite(node.usage[card.field]),
      );
    const total = complete ? nodes.reduce((sum, node) => sum + node.usage[card.field], 0) : null;
    return {
      ...card,
      percentage: available ? percentText(value) : '—',
      arc: available ? Math.min(value, 100) : 0,
      used:
        card.key === 'cpu'
          ? coresText(total)
          : total === null
            ? '—'
            : `${(total / 1073741824).toFixed(2)} GiB`,
      state: loading.value ? '正在采样' : available ? '已使用' : '用量不可用',
    };
  }),
);
let alive = true,
  generation = 0,
  controller;
async function loadClusters() {
  catalogLoading.value = true;
  catalogError.value = '';
  try {
    const values = await readCatalog(props.api, '/resources/clusters');
    if (!alive) return;
    clusters.value = values;
    if (!values.some((row) => row.id === cluster.value)) cluster.value = values[0]?.id || '';
  } catch (e) {
    if (alive) catalogError.value = errorText(e);
  } finally {
    if (alive) catalogLoading.value = false;
  }
}
async function load(reset = false) {
  refresh.value++;
  if (reset) tokens.value = [''];
  const current = ++generation;
  controller?.abort();
  controller = new AbortController();
  data.value = null;
  usage.value = null;
  usageError.value = '';
  error.value = '';
  loading.value = !!cluster.value;
  if (!cluster.value) return;
  if (tab.value !== 'nodes') {
    loading.value = false;
    return;
  }
  try {
    const query = `?limit=50&continueToken=${encodeURIComponent(tokens.value.at(-1))}`;
    const value = await props.api(`/clusters/${encodeURIComponent(cluster.value)}/kubernetes/nodes${query}`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
    });
    if (alive && current === generation) data.value = value;
    if (tab.value === 'nodes' && current === generation) {
      try {
        const measured = await props.api(
          `/clusters/${encodeURIComponent(cluster.value)}/kubernetes/usage/nodes`,
          { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) },
        );
        if (alive && current === generation) usage.value = measured;
      } catch (e) {
        if (alive && current === generation) usageError.value = errorText(e);
      }
    }
  } catch (e) {
    if (alive && current === generation) error.value = errorText(e);
  } finally {
    if (alive && current === generation) loading.value = false;
  }
}
function next() {
  tokens.value.push(data.value.continueToken);
  load();
}
function previous() {
  tokens.value.pop();
  load();
}
watch([cluster, tab], () => load(true));
onMounted(loadClusters);
onBeforeUnmount(() => {
  alive = false;
  generation++;
  controller?.abort();
});
</script>
<template>
  <section class="list-page management-page">
    <div class="page-heading">
      <div>
        <span class="eyebrow">KUBERNETES</span>
        <h1>{{ serviceMode ? '服务资源管理' : '集群运行资源' }}</h1>
      </div>
      <button
        :disabled="loading || catalogLoading || managementPending"
        @click="catalogError || !cluster ? loadClusters() : load(true)"
      >
        刷新资源
      </button>
    </div>
    <p v-if="catalogError" role="alert" class="error">{{ catalogError }}</p>
    <div class="inspection-controls resource-selector">
      <label
        >集群<select v-model="cluster" aria-label="资源集群" :disabled="catalogLoading || managementPending">
          <option v-for="row in clusters" :key="row.id" :value="row.id">
            {{ row.id }} · {{ row.kind }}{{ row.enabled ? '' : ' · 已禁用' }}
          </option>
        </select></label
      ><span v-if="data && tab === 'nodes'" class="muted">范围：集群</span
      ><span v-if="data && tab === 'services'" class="muted">Kubernetes Namespace：{{ data.namespace }}</span>
    </div>
    <div class="tabs" role="tablist" aria-label="Kubernetes 资源类型">
      <button
        v-for="entry in tabs"
        :key="entry[0]"
        role="tab"
        :disabled="managementPending"
        :aria-selected="tab === entry[0]"
        :class="{ active: tab === entry[0] }"
        @click="tab = entry[0]"
      >
        {{ entry[1] }}
      </button>
    </div>
    <KubernetesManagement
      v-if="cluster && ['services', 'namespace'].includes(tab)"
      :api="api"
      :cluster="cluster"
      :tab="tab"
      :workspace="workspace"
      :context="context"
      :refresh="refresh"
      @pending="pending"
    />
    <KubernetesIngress
      v-if="cluster && tab === 'ingresses'"
      :api="api"
      :cluster="cluster"
      :refresh="refresh"
      @pending="pending"
    />
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="usageError" role="alert" class="error">用量不可用：{{ usageError }}</p>
    <section v-if="cluster && tab === 'nodes'" class="usage-overview" aria-label="集群资源用量">
      <article v-for="card in usageCards" :key="card.key" class="usage-card" :class="card.key">
        <div class="usage-ring" role="img" :aria-label="`${card.label} ${card.percentage}`">
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle class="ring-track" cx="60" cy="60" r="50" />
            <circle
              v-if="card.arc > 0"
              class="ring-value"
              cx="60"
              cy="60"
              r="50"
              pathLength="100"
              :stroke-dasharray="`${card.arc} 100`"
              transform="rotate(-90 60 60)"
            />
          </svg>
          <strong aria-hidden="true">{{ card.percentage }}</strong>
        </div>
        <div class="usage-description">
          <h2>{{ card.label }}</h2>
          <p class="usage-amount">
            {{ card.state }} <strong>{{ card.used }}</strong>
          </p>
          <p class="muted">占全部节点总容量</p>
        </div>
      </article>
    </section>
    <p v-if="cluster && tab === 'nodes'" class="usage-scope muted">
      来源：Kubernetes 节点指标；内存为工作集，包含部分文件缓存，不等同于应用进程内存。
    </p>
    <div v-if="loading || catalogLoading" class="empty">正在读取资源…</div>
    <div v-else-if="!cluster && !catalogError" class="empty">暂无登记集群</div>
    <section v-if="data" class="panel">
      <div class="table-wrap">
        <table v-if="tab === 'nodes'" aria-label="节点">
          <thead>
            <tr>
              <th>名称</th>
              <th>Ready</th>
              <th>封锁调度</th>
              <th>地址</th>
              <th>容量 CPU / 内存</th>
              <th>可分配 CPU / 内存</th>
              <th>CPU 用量 / 容量占比</th>
              <th>内存用量 / 容量占比</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="node in data.items" :key="node.name">
              <td>{{ node.name }}</td>
              <td>{{ node.ready }}</td>
              <td>{{ node.unschedulable ? '是' : '否' }}</td>
              <td>
                <div v-for="address in node.addresses" :key="address">{{ address }}</div>
              </td>
              <td>{{ node.capacity.cpu || '—' }} / {{ node.capacity.memory || '—' }}</td>
              <td>{{ node.allocatable.cpu || '—' }} / {{ node.allocatable.memory || '—' }}</td>
              <td>
                {{ coresText(nodeUsage(node.name)?.cpuCores) }} /
                {{ percentText(nodeUsage(node.name)?.cpuPercent) }}
              </td>
              <td>
                {{ memoryText(nodeUsage(node.name)?.memoryBytes) }} /
                {{ percentText(nodeUsage(node.name)?.memoryPercent) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="data.items && !data.items.length" class="empty">此范围暂无资源</p>
      <div v-if="tab !== 'namespace'" class="pagination">
        <button :disabled="loading || tokens.length === 1" @click="previous">上一页</button
        ><span>第 {{ tokens.length }} 页</span
        ><button :disabled="loading || !data.continueToken" @click="next">下一页</button>
      </div>
    </section>
  </section>
</template>
<style scoped>
.usage-overview {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  margin-top: 24px;
}
.usage-card {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 24px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  --ring-color: #7544cf;
}
.usage-card.memory {
  --ring-color: #238b87;
}
.usage-ring {
  position: relative;
  flex: 0 0 120px;
  width: 120px;
  height: 120px;
}
.usage-ring svg {
  width: 100%;
  height: 100%;
  fill: none;
  stroke-width: 10;
}
.ring-track {
  stroke: #eeeaf4;
}
.ring-value {
  stroke: var(--ring-color);
}
.usage-ring strong {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 24px;
  font-variant-numeric: tabular-nums;
}
.usage-description {
  min-width: 0;
}
.usage-description h2 {
  margin: 0 0 12px;
  font-size: 17px;
}
.usage-description p {
  margin: 6px 0 0;
  font-size: 14px;
}
.usage-amount strong {
  margin-left: 6px;
}
.usage-scope {
  margin: 12px 0 20px;
  font-size: 13px;
}
@media (max-width: 1050px) {
  .usage-overview {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 420px) {
  .usage-card {
    padding: 18px;
    gap: 16px;
  }
  .usage-ring {
    flex-basis: 104px;
    width: 104px;
    height: 104px;
  }
}
table[aria-label='节点'] {
  min-width: 1100px;
}
td {
  white-space: nowrap;
}
</style>
