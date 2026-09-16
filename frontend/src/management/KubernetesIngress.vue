<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { errorText } from '../api.js';
import { time } from '../model.js';
const props = defineProps({ api: Function, cluster: String, refresh: Number });
const emit = defineEmits(['pending']);
const namespaces = ref([]),
  selected = ref(''),
  classes = ref([]),
  services = ref([]),
  rows = ref([]);
const loading = ref(false),
  busy = ref(false),
  error = ref(''),
  draft = ref(null),
  editing = ref(null),
  detail = ref(null);
const base = computed(() => `/clusters/${encodeURIComponent(props.cluster)}/kubernetes`);
const scope = computed(() => `${base.value}/namespaces/${encodeURIComponent(selected.value)}`);
const canCreate = computed(
  () =>
    namespaces.value.find((n) => n.name === selected.value)?.phase === 'Active' && classes.value.length > 0,
);
const ports = (name) =>
  (services.value.find((s) => s.name === name)?.ports ?? []).filter((p) => p.protocol === 'TCP');
const freshRoute = () => ({ host: '', path: '/', pathType: 'Prefix', service: '', port: '' });
function entryPoint(row) {
  try {
    const value = new URL(classes.value.find((c) => c.name === row.ingressClassName)?.httpEntryPoint);
    return value.protocol === 'http:' &&
      !value.username &&
      !value.password &&
      value.pathname === '/' &&
      !value.search &&
      !value.hash
      ? value.origin
      : '';
  } catch {
    return '';
  }
}
function routeUrl(row, route) {
  const entry = entryPoint(row);
  if (!entry || route.host?.includes('*') || !route.path?.startsWith('/')) return '';
  const url = new URL(entry);
  if (route.host) url.hostname = route.host;
  url.pathname = route.path;
  return url.href;
}
let generation = 0,
  controller;
watch(busy, (value) => emit('pending', value), { flush: 'sync' });
async function load() {
  const current = ++generation;
  controller?.abort();
  controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]);
  loading.value = true;
  error.value = '';
  rows.value = [];
  services.value = [];
  detail.value = null;
  try {
    const [ns, types] = await Promise.all([
      props.api(`${base.value}/namespaces`, { signal }),
      props.api(`${base.value}/ingress-classes`, { signal }),
    ]);
    if (current !== generation) return;
    namespaces.value = ns;
    classes.value = types;
    if (!ns.some((n) => n.name === selected.value))
      selected.value = ns.find((n) => n.executionDefault)?.name || ns[0]?.name || '';
    if (selected.value) {
      const [list, backends] = await Promise.all([
        props.api(`${scope.value}/ingresses`, { signal }),
        props.api(`${scope.value}/services`, { signal }),
      ]);
      if (current === generation) {
        rows.value = list;
        services.value = backends;
      }
    }
  } catch (e) {
    if (current === generation) error.value = errorText(e);
  } finally {
    if (current === generation) loading.value = false;
  }
}
function create() {
  editing.value = null;
  detail.value = null;
  draft.value = { name: '', ingressClassName: classes.value[0]?.name || '', routes: [freshRoute()] };
}
function edit(row) {
  editing.value = row;
  detail.value = null;
  draft.value = {
    name: row.name,
    ingressClassName: row.ingressClassName,
    routes: row.routes.map((r) => ({ ...r })),
  };
}
function changeService(route) {
  route.port = ports(route.service)[0]?.port || '';
}
const identity = (row) =>
  `uid=${encodeURIComponent(row.uid)}&resourceVersion=${encodeURIComponent(row.resourceVersion)}`;
async function mutate(path, options) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  const current = generation;
  try {
    await props.api(path, options);
    if (current === generation) {
      draft.value = null;
      editing.value = null;
      await load();
    }
  } catch (e) {
    if (current === generation) error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
function save() {
  const body = { ...draft.value, routes: draft.value.routes.map((r) => ({ ...r, port: Number(r.port) })) };
  const path = `${scope.value}/ingresses${editing.value ? `/${encodeURIComponent(editing.value.name)}?${identity(editing.value)}` : ''}`;
  mutate(path, { method: editing.value ? 'PUT' : 'POST', body });
}
function remove(row) {
  if (
    window.prompt(`删除 Ingress ${row.name}？只删除访问规则，不删除 Service 或 Pod。\n请输入名称确认：`) !==
    row.name
  )
    return;
  mutate(`${scope.value}/ingresses/${encodeURIComponent(row.name)}?${identity(row)}`, { method: 'DELETE' });
}
async function inspect(row) {
  const current = generation;
  error.value = '';
  try {
    const value = await props.api(`${scope.value}/ingresses/${encodeURIComponent(row.name)}`);
    if (current === generation) detail.value = value;
  } catch (e) {
    if (current === generation) error.value = errorText(e);
  }
}
watch(
  () => [props.cluster, props.refresh],
  () => {
    selected.value = '';
    draft.value = null;
    editing.value = null;
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
      <label
        >Kubernetes Namespace<select
          v-model="selected"
          aria-label="Ingress Namespace"
          :disabled="loading || busy || !!draft"
          @change="load"
        >
          <option v-for="ns in namespaces" :key="ns.name" :value="ns.name">{{ ns.name }}</option>
        </select></label
      >
      <button v-if="!draft" :disabled="busy || loading || !canCreate" @click="create">创建 Ingress</button>
      <button
        v-else
        :disabled="busy"
        @click="
          draft = null;
          editing = null;
        "
      >
        取消编辑
      </button>
    </div>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="!loading && !error && !classes.length" class="empty">此集群没有 IngressClass</p>
    <form v-if="draft" @submit.prevent="save">
      <fieldset :disabled="busy">
        <div class="form-grid">
          <label>Ingress 名称<input v-model="draft.name" required :disabled="!!editing" /></label>
          <label
            >IngressClass<select v-model="draft.ingressClassName" required>
              <option v-for="type in classes" :key="type.name" :value="type.name">{{ type.name }}</option>
            </select></label
          >
        </div>
        <div
          v-for="(route, index) in draft.routes"
          :key="index"
          class="route-row"
          :aria-label="`路由 ${index + 1}`"
        >
          <label>域名<input v-model="route.host" placeholder="所有域名" /></label>
          <label>路径<input v-model="route.path" required /></label>
          <label
            >匹配<select v-model="route.pathType">
              <option value="Prefix">前缀 Prefix</option>
              <option value="Exact">精确 Exact</option>
            </select></label
          >
          <label
            >Service<select v-model="route.service" required @change="changeService(route)">
              <option value="" disabled>选择 Service</option>
              <option
                v-for="service in services.filter((s) => ports(s.name).length)"
                :key="service.name"
                :value="service.name"
              >
                {{ service.name }}
              </option>
            </select></label
          >
          <label
            >Service 端口<select v-model="route.port" required>
              <option value="" disabled>选择端口</option>
              <option v-for="port in ports(route.service)" :key="port.port" :value="port.port">
                {{ port.port }}{{ port.name ? ` · ${port.name}` : '' }}
              </option>
            </select></label
          >
          <button type="button" :disabled="draft.routes.length === 1" @click="draft.routes.splice(index, 1)">
            移除路由
          </button>
        </div>
        <div class="actions">
          <button
            type="button"
            :disabled="draft.routes.length >= 32"
            @click="draft.routes.push(freshRoute())"
          >
            添加路由</button
          ><button class="primary">保存 Ingress</button>
        </div>
      </fieldset>
    </form>
    <p v-if="loading" class="empty">正在读取资源…</p>
    <div v-else class="table-wrap">
      <table aria-label="Ingress">
        <thead>
          <tr>
            <th>名称</th>
            <th>IngressClass</th>
            <th>路由 → Service</th>
            <th>入口地址</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.name">
            <td>{{ row.name }}</td>
            <td>{{ row.ingressClassName || '—' }}</td>
            <td>
              <div v-for="(route, i) in row.routes" :key="i">
                {{ route.host || '*' }}{{ route.path }} · {{ route.pathType }} → {{ route.service || '—' }}:{{
                  route.port || '命名端口'
                }}
              </div>
            </td>
            <td>{{ entryPoint(row) || row.addresses.join(', ') || '未上报' }}</td>
            <td class="actions">
              <button :disabled="busy" @click="inspect(row)">详情</button
              ><button :disabled="busy || !row.managed || loading" @click="edit(row)">编辑</button
              ><button class="danger" :disabled="busy || !row.managed" @click="remove(row)">
                删除 Ingress
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!rows.length && !error" class="empty">暂无 Ingress</p>
    </div>
    <section v-if="detail" class="panel" aria-label="Ingress 详情">
      <div class="page-heading">
        <h2>{{ detail.name }}</h2>
        <button @click="detail = null">关闭</button>
      </div>
      <dl class="detail-grid">
        <dt>Namespace</dt>
        <dd>{{ detail.namespace }}</dd>
        <dt>IngressClass</dt>
        <dd>{{ detail.ingressClassName || '—' }}</dd>
        <dt>HTTP 入口</dt>
        <dd>{{ entryPoint(detail) || '未配置' }}</dd>
        <dt>控制器上报地址</dt>
        <dd>{{ detail.addresses.join(', ') || '未上报' }}</dd>
        <dt>创建时间</dt>
        <dd>{{ time(detail.createdAt) }}</dd>
        <dt>路由</dt>
        <dd>
          <div v-for="(route, i) in detail.routes" :key="i">
            {{ route.host || '*' }}{{ route.path }} · {{ route.pathType }} → {{ route.service }}:{{
              route.port || '命名端口'
            }}
            <a
              v-if="routeUrl(detail, route)"
              :href="routeUrl(detail, route)"
              target="_blank"
              rel="noopener noreferrer"
              >访问 ↗</a
            >
          </div>
        </dd>
      </dl>
    </section>
  </section>
</template>
<style scoped>
fieldset {
  border: 0;
  padding: 0;
}
form {
  margin-bottom: 24px;
}
.route-row {
  display: grid;
  grid-template-columns: 2fr 2fr 1fr 2fr 1fr auto;
  gap: 12px;
  align-items: end;
  margin: 20px 0;
}
.route-row > * {
  min-width: 0;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
table {
  min-width: 800px;
}
.detail-grid dd {
  overflow-wrap: anywhere;
}
@media (max-width: 900px) {
  .route-row {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-width: 500px) {
  .route-row,
  .detail-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
