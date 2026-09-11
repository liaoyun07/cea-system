<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ApiError, errorText } from './api.js';
import { inputValues, makeFields, pretty, sample, submission, time } from './model.js';
import NoCodeEditor from './no-code/NoCodeEditor.vue';
import FlowRevisions from './no-code/FlowRevisions.vue';

const props = defineProps({ api: Function, namespace: String, flowId: String });
const emit = defineEmits(['dirty', 'pending', 'started', 'saved-title']);
const id = ref(props.flowId),
  source = ref(''),
  saved = ref(null),
  busy = ref(false),
  error = ref(''),
  success = ref('');
const runOpen = ref(false),
  fields = ref([]),
  preview = ref(null),
  pending = ref(null),
  schema = ref(null),
  tab = ref('nocode');
const invalidForm = ref(false);
const dirty = computed(() => source.value !== (saved.value?.source || ''));
let alive = true;
watch(dirty, (value) => emit('dirty', value));
watch(pending, (value) => emit('pending', !!value));
watch(
  source,
  () => {
    success.value = '';
    preview.value = null;
    if (!pending.value) runOpen.value = false;
  },
  { flush: 'sync' },
);
watch(
  fields,
  () => {
    preview.value = null;
  },
  { deep: true },
);
onBeforeUnmount(() => {
  alive = false;
});
const path = () => `/flows/${encodeURIComponent(id.value.trim())}`;

async function action(work) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  success.value = '';
  try {
    await work();
  } catch (e) {
    if (alive) error.value = errorText(e);
  } finally {
    if (alive) busy.value = false;
  }
}
async function load() {
  await action(async () => {
    if (props.flowId) {
      const value = await props.api(path());
      if (!alive) return;
      saved.value = value;
      source.value = value.source;
    }
  });
}
function insertSample() {
  if (!id.value.trim()) {
    error.value = '先填写流程 ID，再插入示例。';
    return;
  }
  if (source.value && !window.confirm('用最小 Log 示例替换当前编辑内容？')) return;
  source.value = sample(props.namespace, id.value.trim());
}
function requireId() {
  if (!id.value.trim()) throw new Error('请填写流程 ID，且与 YAML 中的 id 一致。');
}
async function validate() {
  await action(async () => {
    requireId();
    await props.api(`${path()}/validate`, { method: 'POST', body: { source: source.value } });
    if (alive) success.value = '校验通过 · 此操作不保存或执行流程';
  });
}
async function save() {
  if (pending.value || invalidForm.value) return;
  await action(async () => {
    requireId();
    const result = await props.api(`${path()}/revisions`, {
      method: 'POST',
      body: { source: source.value, expectedRevision: saved.value?.revision || 0 },
    });
    if (!alive) return;
    saved.value = result;
    source.value = result.source;
    id.value = result.flowId;
    emit('saved-title', result.flowId);
    runOpen.value = false;
    success.value = `已保存修订 r${result.revision}`;
  });
}
async function reload() {
  if (dirty.value && !window.confirm('重新读取会放弃当前编辑内容，确定继续？')) return;
  await action(async () => {
    const result = await props.api(path());
    if (!alive) return;
    saved.value = result;
    source.value = result.source;
    runOpen.value = false;
    success.value = `已读取最新修订 r${result.revision}`;
  });
}
function openRun() {
  if (!saved.value || dirty.value) return;
  fields.value = makeFields(saved.value.definition.inputs);
  preview.value = null;
  error.value = '';
  runOpen.value = true;
}
async function previewInputs() {
  await action(async () => {
    const result = await props.api(`${path()}/preview`, {
      method: 'POST',
      body: { source: saved.value.source, inputs: inputValues(fields.value) },
    });
    if (alive) preview.value = result;
  });
}
async function start() {
  if (dirty.value || !saved.value) return;
  await action(async () => {
    const request = pending.value || submission(saved.value, fields.value);
    pending.value = request;
    try {
      const accepted = await props.api('/executions', {
        method: 'POST',
        body: request.body,
        key: request.key,
      });
      if (!alive) return;
      pending.value = null;
      emit('pending', false);
      emit('started', accepted.executionId);
    } catch (e) {
      // Definite client rejection did not accept a new execution; unknown/5xx keeps the exact request.
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) pending.value = null;
      throw e;
    }
  });
}
async function showSchema() {
  tab.value = 'schema';
  if (!schema.value)
    await action(async () => {
      const result = await props.api('/flows/editor/schema');
      if (alive) schema.value = result;
    });
}
function exportDraft() {
  const url = URL.createObjectURL(new Blob([source.value], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${id.value || 'flow'}.yaml`;
  link.click();
  URL.revokeObjectURL(url);
}
function applyRevision(result) {
  saved.value = result;
  source.value = result.source;
  success.value = `已回退并保存为修订 r${result.revision}`;
  tab.value = 'nocode';
}
onMounted(load);
</script>

<template>
  <section class="editor-page">
    <div class="page-heading">
      <div>
        <span class="eyebrow">FLOW EDITOR</span>
        <h1>
          {{ saved?.flowId || '新建流程' }} <span class="tag" v-if="saved">r{{ saved.revision }}</span>
        </h1>
        <p v-if="saved" class="muted">保存于 {{ time(saved.createdAt) }}</p>
      </div>
      <div class="actions">
        <button :disabled="busy || !source || !!pending || invalidForm" @click="validate">✓ 校验</button
        ><button :disabled="busy || !source || !!pending || invalidForm" @click="save">保存修订</button
        ><button
          class="primary"
          :disabled="busy || !saved || dirty || !!pending || invalidForm"
          @click="openRun"
        >
          ▷ 执行
        </button>
      </div>
    </div>
    <div v-if="error" class="notice error" role="alert">
      {{ error }}<span v-if="!pending && saved"> 可先导出草稿，再重新读取最新修订。</span>
    </div>
    <div v-if="success" class="notice success" role="status">{{ success }}</div>
    <div v-if="pending" class="notice warning" role="alert">
      提交结果尚未确认。请保留此页面，使用“原请求重试”；输入与修订已冻结，不会新建幂等键。<span
        class="mono"
        >{{ pending.key }}</span
      >
    </div>
    <div class="editor-meta">
      <label
        >流程 ID<input v-model="id" :disabled="!!saved || busy || !!pending" placeholder="例如 my-flow"
      /></label>
      <div class="meta-item">
        <span>命名空间</span><strong>{{ namespace }}</strong>
      </div>
      <div class="meta-item">
        <span>编辑状态</span
        ><strong :class="dirty ? 'unsaved' : 'muted'">{{
          dirty ? '● 未保存' : saved ? '✓ 已保存' : '待编辑'
        }}</strong>
      </div>
      <div class="meta-actions">
        <button :disabled="busy || !!pending" @click="insertSample">插入 Log 示例</button
        ><button :disabled="!source" @click="exportDraft">导出草稿</button
        ><button v-if="saved" :disabled="busy || !!pending" @click="reload">重新读取</button>
      </div>
    </div>
    <div class="tabs" role="tablist" aria-label="编辑视图">
      <button
        role="tab"
        :aria-selected="tab === 'nocode'"
        :class="{ active: tab === 'nocode' }"
        @click="tab = 'nocode'"
      >
        可视化编排
      </button>
      <button
        role="tab"
        :aria-selected="tab === 'split'"
        :class="{ active: tab === 'split' }"
        @click="tab = 'split'"
      >
        并排编辑
      </button>
      <button
        role="tab"
        :aria-selected="tab === 'source'"
        :class="{ active: tab === 'source' }"
        @click="tab = 'source'"
      >
        源代码</button
      ><button
        role="tab"
        :aria-selected="tab === 'schema'"
        :class="{ active: tab === 'schema' }"
        :disabled="busy"
        @click="showSchema"
      >
        结构参考
      </button>
      <button
        v-if="saved"
        role="tab"
        :aria-selected="tab === 'revisions'"
        :class="{ active: tab === 'revisions' }"
        :disabled="busy || !!pending || invalidForm"
        @click="tab = 'revisions'"
      >
        修订历史
      </button>
    </div>
    <div class="editor-grid" :class="{ 'with-run': runOpen }">
      <div class="editor-workbench" :class="{ 'split-editor': tab === 'split' }">
        <NoCodeEditor
          v-show="tab === 'nocode' || tab === 'split'"
          :source="source"
          :api="api"
          :namespace="namespace"
          :flow-id="id"
          :disabled="busy || !!pending"
          @update:source="source = $event"
          @invalid="invalidForm = $event"
          @show-source="tab = 'split'"
        />
        <FlowRevisions
          v-if="tab === 'revisions'"
          :api="api"
          :flow-id="saved.flowId"
          :current="saved"
          :dirty="dirty"
          @applied="applyRevision"
        />
        <div v-show="['source', 'split', 'schema'].includes(tab)" class="code-panel">
          <div class="code-title">
            <span>{{ tab !== 'schema' ? `${id || 'flow'}.yaml` : 'FlowDefinition · JSON Schema' }}</span
            ><span v-if="tab !== 'schema'">Ctrl / ⌘ + S 保存</span>
          </div>
          <textarea
            v-if="tab !== 'schema'"
            v-model="source"
            class="code-editor"
            aria-label="Flow YAML"
            spellcheck="false"
            :disabled="busy || !!pending"
            placeholder="粘贴 Flow YAML，或插入最小示例…"
            @keydown.ctrl.s.prevent="save"
            @keydown.meta.s.prevent="save"
          ></textarea>
          <pre v-else class="schema-code">{{ schema ? pretty(schema) : '正在读取结构…' }}</pre>
          <div class="code-footer">
            <span>{{ source.split('\n').length }} 行 · UTF-8</span>
          </div>
        </div>
      </div>
      <section v-if="runOpen" class="run-panel" aria-label="执行参数">
        <div class="run-title">
          <h2>
            执行流程 <span class="tag">r{{ saved.revision }}</span>
          </h2>
          <button aria-label="关闭执行参数" :disabled="busy || !!pending" @click="runOpen = false">×</button>
        </div>
        <fieldset :disabled="busy || !!pending">
          <div v-for="field in fields" :key="field.name" class="input-field">
            <div class="input-label">
              <label :for="`input-${field.name}`"
                >{{ field.name }} <span v-if="field.required" class="required">*</span></label
              ><span class="tag">{{ field.type }}</span>
            </div>
            <label class="provide"><input type="checkbox" v-model="field.provided" />提供本次值</label>
            <template v-if="field.provided">
              <select v-if="field.type === 'SELECT'" :id="`input-${field.name}`" v-model="field.value">
                <option value="" disabled>请选择</option>
                <option v-for="option in field.values" :key="option" :value="option">{{ option }}</option>
              </select>
              <select v-else-if="field.type === 'BOOLEAN'" :id="`input-${field.name}`" v-model="field.value">
                <option value="" disabled>请选择</option>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
              <textarea
                v-else-if="['OBJECT', 'ARRAY'].includes(field.type)"
                :id="`input-${field.name}`"
                v-model="field.value"
                rows="5"
                spellcheck="false"
                class="mono"
              ></textarea>
              <input
                v-else
                :id="`input-${field.name}`"
                v-model="field.value"
                :inputmode="['NUMBER', 'INTEGER'].includes(field.type) ? 'decimal' : 'text'"
              />
            </template>
          </div>
        </fieldset>
        <p v-if="!fields.length" class="muted">此流程没有运行输入。</p>
        <div v-if="preview" class="preview-result">
          <strong>输入校验通过</strong>
          <pre>{{ pretty(preview.inputs) }}</pre>
        </div>
        <div class="run-actions">
          <button :disabled="busy || !!pending" @click="previewInputs">预览输入</button
          ><button class="primary" :disabled="busy" @click="start">
            {{ busy ? '处理中…' : pending ? '原请求重试' : '启动执行' }}
          </button>
        </div>
      </section>
    </div>
  </section>
</template>
