<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { errorText } from '../api.js';
import { time } from '../model.js';
import { readCatalog } from '../no-code/document.js';
import { percentText, coresText, memoryText, usageState } from './operations.js';
import KubernetesManagement from './KubernetesManagement.vue';
import KubernetesIngress from './KubernetesIngress.vue';
const props = defineProps({ api: Function, workspace: String, mode: String });
const serviceMode = props.mode === 'services';
const tabs = serviceMode
  ? [
      ['services', 'Service'],
      ['ingresses', 'Ingress'],
    ]
  : [
      ['nodes', '节点'],
      ['namespace', 'Kubernetes Namespace'],
    ];
const emit = defineEmits(['pending']);
const managementPending = ref(false);
function pending(value) {
  managementPending.value = value;
  emit('pending', value);
}
const refresh = ref(0);
const clusters = ref([]),
  cluster = ref(''),
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
        <h1>{{ serviceMode ? '服务与访问入口' : '集群运行资源' }}</h1>
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
    <div v-if="usage && tab === 'nodes'" class="inspection-controls">
      <span>集群 CPU 使用率 {{ percentText(usage.cpuPercent) }}</span
      ><span>内存使用率 {{ percentText(usage.memoryPercent) }}</span>
    </div>
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
              <th>容量 CPU / 内存 / Pod</th>
              <th>可分配 CPU / 内存 / Pod</th>
              <th>CPU 用量 / 容量占比</th>
              <th>内存用量 / 容量占比</th>
              <th>采样状态 / 时间 / 窗口</th>
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
              <td>
                {{ node.capacity.cpu || '—' }} / {{ node.capacity.memory || '—' }} /
                {{ node.capacity.pods || '—' }}
              </td>
              <td>
                {{ node.allocatable.cpu || '—' }} / {{ node.allocatable.memory || '—' }} /
                {{ node.allocatable.pods || '—' }}
              </td>
              <td>
                {{ coresText(nodeUsage(node.name)?.cpuCores) }} /
                {{ percentText(nodeUsage(node.name)?.cpuPercent) }}
              </td>
              <td>
                {{ memoryText(nodeUsage(node.name)?.memoryBytes) }} /
                {{ percentText(nodeUsage(node.name)?.memoryPercent) }}
              </td>
              <td>
                {{ usageState(nodeUsage(node.name)?.status) }}
                <div>{{ nodeUsage(node.name)?.timestamp ? time(nodeUsage(node.name).timestamp) : '—' }}</div>
                <div>{{ nodeUsage(node.name)?.window || '—' }}</div>
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
table[aria-label='节点'] {
  min-width: 1300px;
}
td {
  white-space: nowrap;
}
</style>
