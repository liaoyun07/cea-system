<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { errorText } from '../api.js';
import TaskTree from './TaskTree.vue';
import SchemaField from './SchemaField.vue';
import {
  at,
  pathKey,
  readDocument,
  changeSource,
  taskEntries,
  taskLabels,
  sections,
  addTask,
  moveTask,
  removeTask,
  readCatalog,
  taskFormFields,
} from './document.js';

const props = defineProps({
  source: String,
  api: Function,
  disabled: Boolean,
  namespace: String,
  flowId: String,
});
const emit = defineEmits(['update:source', 'invalid', 'show-source']);
const schema = ref(null),
  selected = ref([]),
  error = ref(''),
  loading = ref(false);
const apps = ref([]),
  clusters = ref([]),
  datasets = ref([]),
  catalogError = ref('');
const invalidFields = ref({});
const adding = ref(null),
  newType = ref('core.Log'),
  newId = ref(''),
  destination = ref('');
let alive = true;
let emittedSource = null;
const externalEdit = ref(0);
watch(
  () => props.source,
  (value) => {
    if (value !== emittedSource) {
      invalidFields.value = {};
      externalEdit.value++;
    }
  },
);
const parsed = computed(() => {
  try {
    return { value: readDocument(props.source).value };
  } catch (error) {
    return { error: error.message };
  }
});
const flow = computed(() => parsed.value.value);
const entries = computed(() => (flow.value ? taskEntries(flow.value) : []));
const current = computed(() => at(flow.value, selected.value));
const entry = computed(() => entries.value.find((e) => pathKey(e.path) === pathKey(selected.value)));
const taskFields = computed(() =>
  selected.value.length && current.value && schema.value ? taskFormFields(current.value, schema.value) : [],
);
const properties = computed(() => {
  const fields = schema.value?.$defs.FlowDefinition?.properties || {};
  const visible = selected.value.length
    ? []
    : [
        'description',
        'labels',
        'inputs',
        'variables',
        'outputs',
        'concurrency',
        'schedule',
        'webhook',
        'checks',
        'sla',
      ];
  return Object.fromEntries(visible.filter((key) => fields[key]).map((key) => [key, fields[key]]));
});
const app = computed(() =>
  apps.value.find(
    (a) =>
      a.applicationId === current.value?.container?.applicationId &&
      a.version === current.value?.container?.version,
  ),
);
const appFields = computed(() => schema.value?.$defs.Container.properties || {});
const appKey = computed(() =>
  JSON.stringify([current.value?.container?.applicationId, current.value?.container?.version]),
);
const parameterNames = computed(() => [
  ...new Set([
    ...Object.keys(app.value?.parameters || {}),
    ...Object.keys(current.value?.container?.parameters || {}),
  ]),
]);
const taskTypes = computed(
  () => schema.value?.$defs.Task.properties.type.anyOf.find((v) => v.enum)?.enum || [],
);
const allowedTypes = computed(() =>
  taskTypes.value.filter((type) => {
    const parents = entries.value.filter(
      (e) => adding.value?.length > e.path.length && e.path.every((v, i) => adding.value[i] === v),
    );
    return (
      !(type === 'core.Repeat' && parents.some((e) => e.task.repeat || e.task.loop)) &&
      !(type === 'core.Loop' && parents.some((e) => e.task.loop))
    );
  }),
);
const destinations = computed(() => {
  const values = Object.entries(sections).map(([key, label]) => ({ path: [key], label }));
  for (const e of entries.value)
    for (const field of ['tasks', 'then', 'else'])
      if (Array.isArray(e.task[field]))
        values.push({ path: [...e.path, field], label: `${e.task.id} / ${field}` });
  return values.filter(
    (v) => !(selected.value.length && selected.value.every((key, i) => v.path[i] === key)),
  );
});
watch(selected, () => {
  destination.value = '';
});
watch(
  () => Object.values(invalidFields.value).some(Boolean),
  (value) => emit('invalid', value),
);
onBeforeUnmount(() => {
  alive = false;
  emit('invalid', false);
});
function invalid({ path, message }) {
  invalidFields.value = { ...invalidFields.value, [pathKey(path)]: message };
}
function mutate(work) {
  if (props.disabled) return;
  try {
    const next = work();
    error.value = '';
    emittedSource = next;
    emit('update:source', next);
  } catch (e) {
    error.value = e.message;
  }
}
function patch(change) {
  invalidFields.value = Object.fromEntries(
    Object.entries(invalidFields.value).filter(
      ([key]) => !change.path.every((v, i) => JSON.parse(key)[i] === v),
    ),
  );
  mutate(() => changeSource(props.source, change.path, change.value, change.remove));
}
function select(path) {
  if (Object.values(invalidFields.value).some(Boolean)) {
    error.value = '请先修正右侧输入错误，再切换任务。';
    return;
  }
  selected.value = path;
  error.value = '';
}
function openAdd(path) {
  if (Object.values(invalidFields.value).some(Boolean)) {
    error.value = '请先修正右侧输入错误。';
    return;
  }
  adding.value = path;
  newType.value = 'core.Log';
  newId.value = '';
}
function create() {
  mutate(() => {
    if (!allowedTypes.value.includes(newType.value)) throw new Error('当前作用域不支持该任务类型。');
    const path = [...adding.value, at(flow.value, adding.value)?.length || 0];
    const next = addTask(props.source, adding.value, newType.value, newId.value.trim());
    selected.value = path;
    adding.value = null;
    return next;
  });
}
function move(change) {
  mutate(() => {
    const next = moveTask(props.source, change.path, change.target, change.index);
    selected.value = [];
    return next;
  });
}
function remove(path) {
  if (!window.confirm(`删除任务 ${at(flow.value, path)?.id} 及其内部任务？仅修改草稿。`)) return;
  mutate(() => {
    const next = removeTask(props.source, path);
    selected.value = [];
    invalidFields.value = {};
    return next;
  });
}
async function loadSchema() {
  loading.value = true;
  error.value = '';
  try {
    const result = await props.api('/flows/editor/schema');
    if (alive) schema.value = result;
  } catch (e) {
    if (alive) error.value = errorText(e);
  } finally {
    if (alive) loading.value = false;
  }
}
async function loadCatalogs() {
  catalogError.value = '';
  try {
    const values = await Promise.all(
      ['/applications', '/resources/clusters', '/resources/datasets'].map((p) => readCatalog(props.api, p)),
    );
    if (alive) [apps.value, clusters.value, datasets.value] = values;
  } catch (e) {
    if (alive) catalogError.value = errorText(e);
  }
}
function selectApp(event) {
  const [applicationId, version] = JSON.parse(event.target.value);
  mutate(() => {
    let source = changeSource(props.source, [...selected.value, 'container', 'applicationId'], applicationId);
    return changeSource(source, [...selected.value, 'container', 'version'], version);
  });
}
function toggleCluster(id) {
  const ids = current.value.container.candidateClusters;
  patch({
    path: [...selected.value, 'container', 'candidateClusters'],
    value: ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id],
  });
}
function options(parameter) {
  if (parameter?.dataset)
    return parameter.dataset.allowed.map((ref) => ({
      value: `${ref.datasetId}/${ref.version}`,
      label: `${ref.datasetId} / ${ref.version}${datasets.value.some((d) => d.datasetId === ref.datasetId && d.version === ref.version) ? '' : '（目录中不可见）'}`,
    }));
  return parameter?.choices?.map((value) => ({ value, label: String(value) }));
}
function initFlow() {
  if (!props.flowId?.trim()) {
    error.value = '先填写上方流程 ID。';
    return;
  }
  emit(
    'update:source',
    `schemaVersion: 1\nnamespace: ${JSON.stringify(props.namespace)}\nid: ${JSON.stringify(props.flowId.trim())}\ntasks: []\n`,
  );
}
onMounted(() => {
  loadSchema();
  loadCatalogs();
});
</script>
<template>
  <section class="no-code" aria-label="可视化流程编辑器">
    <div v-if="error" class="notice error" role="alert">{{ error }}</div>
    <div v-if="Object.values(invalidFields).some(Boolean)" class="notice error" role="alert">
      {{ Object.values(invalidFields).filter(Boolean).join('；') }}
    </div>
    <div v-if="!source.trim()" class="no-code-empty">
      <h2>从一个任务开始</h2>
      <button class="primary" :disabled="disabled" @click="initFlow">创建空流程</button>
    </div>
    <div v-else-if="parsed.error" class="notice warning">
      <strong>暂时无法显示 No-code</strong>
      <pre>{{ parsed.error }}</pre>
      <button @click="emit('show-source')">打开源码修正</button>
    </div>
    <div v-else-if="!schema" class="no-code-empty">
      <p>{{ loading ? '正在读取编辑结构…' : '无法读取编辑结构' }}</p>
      <button :disabled="loading" @click="loadSchema">重新读取</button>
    </div>
    <div v-else class="no-code-layout">
      <div class="task-canvas">
        <div class="canvas-heading">
          <span
            ><strong>{{ flow.id }}</strong
            ><small>任务结构 · {{ entries.length }} 个定义</small></span
          ><button :class="{ primary: !selected.length }" :disabled="disabled" @click="select([])">
            流程设置
          </button>
        </div>
        <TaskTree
          v-for="(label, section) in sections"
          :key="section"
          :tasks="flow[section]"
          :path="[section]"
          :selected="selected"
          :label="label"
          :disabled="disabled || Object.values(invalidFields).some(Boolean)"
          @select="select"
          @add="openAdd"
          @move="move"
          @remove="remove"
        />
      </div>
      <aside class="task-inspector" aria-label="任务配置">
        <header>
          <div>
            <span class="eyebrow">CONFIGURATION</span>
            <h2>{{ selected.length ? current?.id : '流程设置' }}</h2>
          </div>
          <button @click="emit('show-source')">YAML ↗</button>
        </header>
        <fieldset :key="externalEdit" :disabled="disabled">
          <template v-if="current">
            <template v-if="selected.length">
              <div v-for="name in ['type', 'id']" :key="name" class="schema-field" :data-task-identity="name">
                <label class="field-heading" :for="`current-task-${name}`"
                  ><span class="required" aria-hidden="true">*</span> {{ name }}</label
                >
                <input :id="`current-task-${name}`" :value="current[name]" readonly :aria-required="true" />
              </div>
              <SchemaField
                v-for="field in taskFields.filter((f) => f.required)"
                :key="`${pathKey(selected)}-${field.path.join('.')}`"
                :schema="field.schema"
                :root="schema"
                :value="at(current, field.path)"
                :path="[...selected, ...field.path]"
                :flow="flow"
                :required="true"
                @patch="patch"
                @invalid="invalid"
              />
            </template>
            <template v-if="entry?.parent?.task.type === 'core.Dag'">
              <label class="field-heading">依赖任务</label>
              <div class="dependency-options">
                <label
                  v-for="sibling in at(flow, selected.slice(0, -1)).filter((t) => t.id !== current.id)"
                  :key="sibling.id"
                  ><input
                    type="checkbox"
                    :checked="current.dependsOn?.includes(sibling.id)"
                    @change="
                      patch({
                        path: [...selected, 'dependsOn'],
                        value: $event.target.checked
                          ? [...(current.dependsOn || []), sibling.id]
                          : (current.dependsOn || []).filter((id) => id !== sibling.id),
                      })
                    "
                  />{{ sibling.id }}</label
                >
              </div>
            </template>
            <template v-if="current.type === 'platform.Application'">
              <div v-if="catalogError" class="notice warning">
                目录读取失败：{{ catalogError }}<button @click="loadCatalogs">重试目录</button>
              </div>
              <label class="field-heading" for="application-version"
                ><span class="required" aria-hidden="true">*</span> 应用与版本</label
              >
              <select id="application-version" :value="appKey" @change="selectApp">
                <option :value="JSON.stringify(['', ''])" disabled>选择已登记的应用版本</option>
                <option v-if="current.container?.applicationId && !app" :value="appKey">
                  {{ current.container.applicationId }} / {{ current.container.version }}（目录不可见）
                </option>
                <option
                  v-for="a in apps"
                  :key="`${a.applicationId}/${a.version}`"
                  :value="JSON.stringify([a.applicationId, a.version])"
                >
                  {{ a.applicationId }} / {{ a.version }}
                </option>
              </select>
              <p v-if="app?.image" class="catalog-image">{{ app.image }}</p>
              <details open class="form-section">
                <summary>参数绑定</summary>
                <p v-if="!parameterNames.length" class="muted small">暂无参数</p>
                <div v-for="name in parameterNames" :key="name" class="contract-parameter">
                  <SchemaField
                    :schema="{ $ref: '#/$defs/Binding' }"
                    :root="schema"
                    :value="current.container?.parameters?.[name]"
                    :path="[...selected, 'container', 'parameters', name]"
                    :label="name"
                    :flow="flow"
                    :options="options(app?.parameters?.[name])"
                    @patch="patch"
                    @invalid="invalid"
                  />
                  <small
                    >{{ app?.parameters?.[name]?.type || '契约中未声明' }} ·
                    {{ app?.parameters?.[name]?.required ? '必填' : '可选'
                    }}<template
                      v-if="
                        app?.parameters?.[name]?.defaultValue !== undefined &&
                        app?.parameters?.[name]?.defaultValue !== null
                      "
                    >
                      · 默认 {{ app.parameters[name].defaultValue }}</template
                    >
                  </small>
                </div>
              </details>
              <details open class="form-section">
                <summary>位置与文件</summary>
                <div
                  v-for="field in [
                    'execution',
                    'candidateClusters',
                    'command',
                    'inputFiles',
                    'outputFiles',
                    'namespaceFiles',
                  ]"
                  :key="field"
                >
                  <template v-if="field === 'candidateClusters'">
                    <div class="cluster-picker">
                      <span class="small">候选集群模式</span>
                      <button
                        v-if="Array.isArray(current.container?.candidateClusters)"
                        type="button"
                        @click="
                          patch({
                            path: [...selected, 'container', 'candidateClusters'],
                            value: { source: 'LITERAL', value: current.container.candidateClusters },
                          })
                        "
                      >
                        改为参数引用
                      </button>
                      <button
                        v-else
                        type="button"
                        @click="
                          patch({
                            path: [...selected, 'container', 'candidateClusters'],
                            value:
                              current.container?.candidateClusters?.source === 'LITERAL' &&
                              Array.isArray(current.container.candidateClusters.value)
                                ? current.container.candidateClusters.value
                                : [],
                          })
                        "
                      >
                        改为固定列表
                      </button>
                    </div>
                    <div
                      v-if="Array.isArray(current.container?.candidateClusters)"
                      class="cluster-picker"
                      role="group"
                      aria-label="候选集群选择"
                    >
                      <span class="small">已选 {{ current.container.candidateClusters.length }} 个</span>
                      <button
                        v-for="cluster in clusters"
                        :key="cluster.id"
                        type="button"
                        :aria-pressed="current.container.candidateClusters.includes(cluster.id)"
                        :disabled="
                          !cluster.enabled && !current.container.candidateClusters.includes(cluster.id)
                        "
                        @click="toggleCluster(cluster.id)"
                      >
                        {{ current.container.candidateClusters.includes(cluster.id) ? '✓' : '＋' }}
                        {{ cluster.id }} · {{ cluster.kind }}
                      </button>
                    </div>
                  </template>
                  <SchemaField
                    :schema="appFields[field]"
                    :root="schema"
                    :value="current.container?.[field]"
                    :path="[...selected, 'container', field]"
                    :flow="flow"
                    @patch="patch"
                    @invalid="invalid"
                  />
                </div>
              </details>
            </template>
            <SchemaField
              v-for="field in taskFields.filter((f) => !f.required)"
              :key="`${pathKey(selected)}-${field.path.join('.')}`"
              :schema="field.schema"
              :root="schema"
              :value="at(current, field.path)"
              :path="[...selected, ...field.path]"
              :label="field.path.join('.') === 'loop.outputs' ? '循环输出' : undefined"
              :flow="flow"
              @patch="patch"
              @invalid="invalid"
            />
            <SchemaField
              v-for="(field, name) in properties"
              :key="`${pathKey(selected)}-${name}`"
              :schema="field"
              :root="schema"
              :value="current[name]"
              :path="[...selected, name]"
              :flow="flow"
              @patch="patch"
              @invalid="invalid"
            />
            <details v-if="selected.length" class="form-section">
              <summary>移动到其他任务组</summary>
              <select v-model="destination" aria-label="目标任务组">
                <option value="" disabled>选择目标组</option>
                <option
                  v-for="target in destinations"
                  :key="pathKey(target.path)"
                  :value="pathKey(target.path)"
                >
                  {{ target.label }}
                </option></select
              ><button
                :disabled="!destination"
                @click="move({ path: selected, target: JSON.parse(destination) })"
              >
                移动到组末尾
              </button>
            </details>
          </template>
          <p v-else class="muted">此任务已从 YAML 移除，请选择其他任务。</p>
        </fieldset>
      </aside>
    </div>
    <div v-if="adding" class="dialog-backdrop" @click.self="adding = null">
      <form class="task-add-dialog" role="dialog" aria-label="添加任务" @submit.prevent="create">
        <h2>添加任务</h2>
        <p v-if="error" class="notice error">{{ error }}</p>
        <p class="muted">{{ adding.join(' / ') }}</p>
        <label
          >任务类型<select v-model="newType" aria-label="任务类型">
            <option v-for="type in allowedTypes" :key="type" :value="type">
              {{ taskLabels[type] || type }} · {{ type }}
            </option>
          </select></label
        ><label
          >任务 ID<input v-model="newId" aria-label="任务 ID" autofocus placeholder="例如 train"
        /></label>
        <div class="actions">
          <button type="button" @click="adding = null">取消</button
          ><button type="submit" class="primary" :disabled="!newId.trim()">添加到流程</button>
        </div>
      </form>
    </div>
  </section>
</template>
