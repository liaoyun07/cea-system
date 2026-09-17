<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { errorText } from '../api.js';
import { time } from '../model.js';
const props = defineProps({
  api: Function,
  cluster: String,
  tab: String,
  workspace: String,
  refresh: Number,
  context: Object,
});
const emit = defineEmits(['pending']);
const namespaces = ref([]),
  selected = ref(''),
  services = ref([]),
  detail = ref(null);
const error = ref(''),
  busy = ref(false),
  loading = ref(false),
  creating = ref(false),
  namespaceName = ref('');
const draft = ref({
  name: '',
  type: 'ClusterIP',
  selector: [{ key: 'cea-system/deployment', value: '' }],
  ports: [{ name: 'http', port: 80, targetPort: '8080', protocol: 'TCP', nodePort: '' }],
});
const base = computed(() => `/clusters/${encodeURIComponent(props.cluster)}/kubernetes/namespaces`);
watch(busy, (value) => emit('pending', value), { flush: 'sync' });
const servicePath = computed(() => `${base.value}/${encodeURIComponent(selected.value)}/services`);
const canCreate = computed(() => namespaces.value.find((n) => n.name === selected.value)?.phase === 'Active');
let generation = 0,
  controller;
let contextApplied = false;
async function load() {
  const current = ++generation;
  controller?.abort();
  controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]);
  error.value = '';
  loading.value = true;
  detail.value = null;
  services.value = [];
  try {
    const values = await props.api(base.value, { signal });
    if (current !== generation) return;
    namespaces.value = values;
    if (!contextApplied && props.context?.cluster === props.cluster && props.tab === 'services') {
      selected.value = props.context.namespace;
      draft.value.name = props.context.name;
      draft.value.selector = Object.entries(props.context.selector).map(([key, value]) => ({ key, value }));
      creating.value = true;
      contextApplied = true;
    }
    if (!values.some((v) => v.name === selected.value))
      selected.value = values.find((v) => v.executionDefault)?.name || values[0]?.name || '';
    if (props.tab === 'services' && selected.value) {
      const rows = await props.api(servicePath.value, { signal });
      if (current === generation) services.value = rows;
    }
  } catch (e) {
    if (current === generation) error.value = errorText(e);
  } finally {
    if (current === generation) loading.value = false;
  }
}
async function mutate(work) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  const current = generation;
  try {
    await work();
    if (current === generation) {
      creating.value = false;
      await load();
    }
  } catch (e) {
    if (current === generation) error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
function createNamespace() {
  const path = base.value,
    name = namespaceName.value;
  mutate(() => props.api(path, { method: 'POST', body: { name } }));
}
function createService() {
  const body = {
    name: draft.value.name,
    type: draft.value.type,
    selector: {},
    ports: draft.value.ports.map((p) => ({
      ...p,
      port: Number(p.port),
      targetPort: String(p.targetPort),
      nodePort: p.nodePort === '' || draft.value.type === 'ClusterIP' ? null : Number(p.nodePort),
    })),
  };
  for (const row of draft.value.selector) {
    if (!row.key || Object.hasOwn(body.selector, row.key)) {
      error.value = 'Selector 键不能为空或重复';
      return;
    }
    body.selector[row.key] = row.value;
  }
  const path = servicePath.value;
  mutate(() => props.api(path, { method: 'POST', body }));
}
function remove(row, kind) {
  const warning =
    kind === 'namespace'
      ? '将级联删除其中的 Service、配置和其它剩余资源，不强制清理 finalizer。'
      : '将中断此 Service 的访问入口，不删除 Pod。';
  if (
    window.prompt(
      `删除 ${kind === 'namespace' ? 'Namespace' : 'Service'} ${row.name}？${warning}\n请输入名称确认：`,
    ) !== row.name
  )
    return;
  const path = `${kind === 'namespace' ? base.value : servicePath.value}/${encodeURIComponent(row.name)}?uid=${encodeURIComponent(row.uid)}&resourceVersion=${encodeURIComponent(row.resourceVersion)}`;
  mutate(() => props.api(path, { method: 'DELETE' }));
}
async function inspect(row) {
  const current = generation;
  error.value = '';
  detail.value = null;
  try {
    const value = await props.api(`${servicePath.value}/${encodeURIComponent(row.name)}`);
    if (current === generation) detail.value = value;
  } catch (e) {
    if (current === generation) error.value = errorText(e);
  }
}
watch(
  () => [props.cluster, props.tab, props.refresh],
  () => {
    selected.value = '';
    creating.value = false;
    namespaces.value = [];
    load();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  generation++;
  controller?.abort();
});
</script>
<template>
  <section class="panel">
    <div class="page-heading">
      <label v-if="tab === 'services'"
        >Kubernetes Namespace
        <select
          v-model="selected"
          aria-label="Service Namespace"
          :disabled="loading || busy"
          @change="
            creating = false;
            load();
          "
        >
          <option v-for="row in namespaces" :key="row.name" :value="row.name">{{ row.name }}</option>
        </select>
      </label>
      <span v-else>Kubernetes Namespace</span>
      <button :disabled="busy || loading || (tab === 'services' && !canCreate)" @click="creating = !creating">
        {{ creating ? '取消创建' : tab === 'services' ? '创建 Service' : '创建 Namespace' }}
      </button>
    </div>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <form v-if="creating && tab === 'namespace'" @submit.prevent="createNamespace">
      <label
        >Namespace 名称<input
          v-model="namespaceName"
          required
          :placeholder="`cea-${workspace}-demo`"
          :disabled="busy"
      /></label>
      <button class="primary" :disabled="busy">创建 Namespace</button>
    </form>
    <form v-if="creating && tab === 'services'" @submit.prevent="createService">
      <fieldset :disabled="busy">
        <div class="form-grid">
          <label>Service 名称<input v-model="draft.name" required /></label
          ><label
            >类型<select v-model="draft.type">
              <option>ClusterIP</option>
              <option>NodePort</option>
              <option>LoadBalancer</option>
            </select></label
          >
        </div>
        <h3>Pod Selector</h3>
        <div v-for="(row, index) in draft.selector" :key="index" class="port-row">
          <input v-model="row.key" aria-label="Selector 键" required /><input
            v-model="row.value"
            aria-label="Selector 值"
          /><button
            type="button"
            :disabled="draft.selector.length === 1"
            @click="draft.selector.splice(index, 1)"
          >
            移除
          </button>
        </div>
        <button type="button" @click="draft.selector.push({ key: '', value: '' })">添加 Selector</button>
        <h3>端口</h3>
        <div v-for="(port, index) in draft.ports" :key="index" class="port-row">
          <label>名称<input v-model="port.name" required /></label
          ><label>Service 端口<input v-model="port.port" type="number" min="1" max="65535" required /></label>
          <label>目标端口<input v-model="port.targetPort" required /></label
          ><label
            >协议<select v-model="port.protocol">
              <option>TCP</option>
              <option>UDP</option>
              <option>SCTP</option>
            </select></label
          >
          <label v-if="draft.type !== 'ClusterIP'"
            >NodePort<input v-model="port.nodePort" type="number" min="1" max="65535" placeholder="自动分配"
          /></label>
          <button type="button" :disabled="draft.ports.length === 1" @click="draft.ports.splice(index, 1)">
            移除
          </button>
        </div>
        <button
          type="button"
          @click="draft.ports.push({ name: '', port: 80, targetPort: '8080', protocol: 'TCP', nodePort: '' })"
        >
          添加端口
        </button>
        <button class="primary">创建 Service</button>
      </fieldset>
    </form>
    <p v-if="loading" class="empty">正在读取资源…</p>
    <div v-else-if="!error" class="table-wrap">
      <table v-if="tab === 'namespace'" aria-label="Kubernetes Namespace">
        <thead>
          <tr>
            <th>名称</th>
            <th>状态</th>
            <th>执行默认</th>
            <th>创建时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in namespaces" :key="row.name">
            <td>{{ row.name }}</td>
            <td>{{ row.phase }}</td>
            <td>{{ row.executionDefault ? '是' : '否' }}</td>
            <td>{{ time(row.createdAt) }}</td>
            <td>
              <button
                class="danger"
                :disabled="busy || row.executionDefault || !row.managed || row.phase === 'Terminating'"
                @click="remove(row, 'namespace')"
              >
                删除 Namespace
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <table v-else aria-label="Service">
        <thead>
          <tr>
            <th>名称</th>
            <th>类型</th>
            <th>Cluster IP</th>
            <th>端口 → 目标端口</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in services" :key="row.name">
            <td>{{ row.name }}</td>
            <td>{{ row.type }}</td>
            <td>{{ row.clusterIP || '—' }}</td>
            <td>
              <div v-for="p in row.ports" :key="`${p.protocol}/${p.port}`">
                {{ p.port }}/{{ p.protocol }} → {{ p.targetPort
                }}{{ p.nodePort ? ` · NodePort ${p.nodePort}` : '' }}
              </div>
            </td>
            <td>
              <button :disabled="busy" @click="inspect(row)">访问详情</button
              ><button class="danger" :disabled="busy || !row.managed" @click="remove(row, 'service')">
                删除 Service
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <section v-if="detail" class="panel" aria-label="Service 访问详情">
      <div class="page-heading">
        <h2>{{ detail.name }}</h2>
        <button @click="detail = null">关闭</button>
      </div>
      <dl class="detail-grid">
        <dt>集群内 DNS</dt>
        <dd>{{ detail.name }}.{{ detail.namespace }}.svc</dd>
        <dt>Cluster IP</dt>
        <dd>{{ detail.clusterIP }}</dd>
        <dt>外部地址</dt>
        <dd>{{ detail.externalAddresses.join(', ') || '未分配' }}</dd>
        <dt>节点地址</dt>
        <dd>
          <div v-for="address in detail.nodeAddresses" :key="address">{{ address }}</div>
          <span v-if="!detail.nodeAddresses.length">—</span>
        </dd>
        <dt>端口</dt>
        <dd>
          <div v-for="p in detail.ports" :key="p.port">
            {{ p.port }}/{{ p.protocol }} → {{ p.targetPort
            }}{{ p.nodePort ? ` · NodePort ${p.nodePort}` : '' }}
          </div>
        </dd>
      </dl>
      <h3>关联 Pod</h3>
      <div class="table-wrap">
        <table aria-label="Service 关联 Pod">
          <thead>
            <tr>
              <th>Pod</th>
              <th>IP</th>
              <th>状态</th>
              <th>Ready</th>
              <th>节点</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="pod in detail.pods" :key="pod.name">
              <td>{{ pod.name }}</td>
              <td>{{ pod.ip || '—' }}</td>
              <td>{{ pod.phase }}</td>
              <td>{{ pod.ready ? '是' : '否' }}</td>
              <td>{{ pod.node || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </section>
</template>
<style scoped>
.port-row {
  display: flex;
  gap: 12px;
  align-items: end;
  margin: 12px 0;
}
.port-row > * {
  min-width: 0;
  flex: 1;
}
fieldset {
  border: 0;
  padding: 0;
}
form {
  margin-bottom: 24px;
}
.detail-grid dd {
  overflow-wrap: anywhere;
}
table {
  min-width: 650px;
}
@media (max-width: 650px) {
  .detail-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }
  .detail-grid dd {
    margin-bottom: 12px;
  }
  .port-row {
    flex-wrap: wrap;
  }
  .port-row > * {
    flex-basis: 120px;
  }
}
</style>
