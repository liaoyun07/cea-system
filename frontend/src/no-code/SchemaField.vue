<script setup>
import { computed, ref } from 'vue';
import BindingField from './BindingField.vue';
import LoopValuesField from './LoopValuesField.vue';
import { shape, initialValue, pathKey, parseJsonValue } from './document.js';
const props = defineProps({
  schema: Object,
  root: Object,
  value: null,
  path: Array,
  flow: Object,
  label: String,
  options: Array,
  disabled: Boolean,
  required: Boolean,
});
const emit = defineEmits(['patch', 'invalid']);
const inputSpec = computed(() =>
  props.path.length === 3 && props.path[0] === 'inputs' ? props.flow.inputs?.[props.path[1]] : null,
);
const selectDefault = computed(
  () => inputSpec.value?.type === 'SELECT' && props.path.at(-1) === 'defaultValue',
);
const s = computed(() =>
  selectDefault.value
    ? { type: 'string', enum: Array.isArray(inputSpec.value.values) ? inputSpec.value.values : [] }
    : shape(props.schema, props.root, props.value),
);
const properties = computed(() =>
  Object.fromEntries(
    Object.entries(s.value.properties || {}).filter(
      ([key]) =>
        !(
          props.path.length === 2 &&
          props.path[0] === 'inputs' &&
          key === 'values' &&
          props.value?.type !== 'SELECT' &&
          props.value?.values == null
        ),
    ),
  ),
);
const newKey = ref('');
const fieldId = computed(() => `field-${pathKey(props.path)}`);
const loopValues = computed(() => props.path.at(-2) === 'loop' && props.path.at(-1) === 'values');
const patch = (value, remove = false) => emit('patch', { path: props.path, value, remove });
const labels = {
  description: '说明',
  inputs: '流程输入',
  variables: '流程变量',
  outputs: '流程输出',
  labels: '标签',
  type: '类型',
  required: '必填',
  defaultValue: '默认值',
  message: '消息 / 表达式',
  duration: '等待时间（ISO 8601）',
  timeout: '超时（ISO 8601）',
  retry: '失败重试',
  maxAttempts: '最大尝试次数',
  interval: '重试间隔',
  condition: '条件表达式',
  iterations: '轮数来源',
  initial: '首次状态输入',
  feedback: '每轮状态反馈',
  values: 'values',
  concurrency: '并发限制',
  limit: '并发上限',
  behavior: '超限行为',
  command: '容器命令（有序参数）',
  parameters: '参数绑定',
  inputFiles: '输入文件绑定',
  outputFiles: '声明输出文件名',
  candidateClusters: '候选集群',
  execution: '执行位置',
  namespaceFiles: '命名空间文件',
  schedule: '定时触发',
  cron: 'Cron（含秒）',
  timezone: '时区',
  disabled: '禁用',
  webhook: '允许 Webhook',
  checks: '提交检查',
  when: '条件',
  sla: '时限告警',
  maxDuration: '最长耗时',
  connection: '连接配置名',
  method: '请求方法',
  path: '路径',
  body: '请求体',
  query: '只读 SQL',
};
function addKey() {
  const key = newKey.value.trim();
  if (!key || Object.hasOwn(props.value || {}, key)) {
    emit('invalid', { path: props.path, message: '名称不能为空或重复。' });
    return;
  }
  emit('invalid', { path: props.path, message: '' });
  emit('patch', {
    path: [...props.path, key],
    value: initialValue(s.value.additionalProperties, props.root),
  });
  newKey.value = '';
}
function scalar(event) {
  try {
    const raw = event.target.value;
    const value = ['integer', 'number'].includes(s.value.type) ? Number(raw) : raw;
    if (
      ['integer', 'number'].includes(s.value.type) &&
      (!raw.trim() || !Number.isFinite(value) || (s.value.type === 'integer' && !Number.isSafeInteger(value)))
    )
      throw new Error('请填写有效的安全数值');
    emit('invalid', { path: props.path, message: '' });
    patch(value);
  } catch (error) {
    emit('invalid', { path: props.path, message: error.message });
  }
}
function json(event) {
  try {
    const value = parseJsonValue(event.target.value);
    emit('invalid', { path: props.path, message: '' });
    patch(value);
  } catch (error) {
    emit('invalid', { path: props.path, message: `请输入有效 JSON；尚未写入 YAML。${error.message}` });
  }
}
</script>
<template>
  <div class="schema-field" :data-field="path.join('.')">
    <div class="field-heading">
      <label :for="fieldId"
        ><span v-if="required" class="required" aria-hidden="true">* </span
        >{{ label || labels[path.at(-1)] || path.at(-1) }}</label
      >
      <button
        v-if="!disabled && value !== undefined && value !== null"
        class="field-clear"
        type="button"
        :aria-label="`移除 ${label || path.at(-1)}`"
        @click="patch(undefined, true)"
      >
        移除
      </button>
    </div>
    <template v-if="value === undefined || (value === null && s.type)">
      <button
        type="button"
        class="field-enable"
        :disabled="disabled || (selectDefault && !s.enum.length)"
        @click="patch(loopValues ? { source: 'LITERAL', value: [] } : initialValue(s, root))"
      >
        ＋ 设置 {{ label || labels[path.at(-1)] || path.at(-1) }}
      </button>
    </template>
    <LoopValuesField
      v-else-if="loopValues"
      :value="value"
      :path="path"
      :flow="flow"
      @patch="emit('patch', $event)"
      @invalid="emit('invalid', $event)"
    />
    <template v-else-if="s.oneOf">
      <BindingField
        :value="value"
        :path="path"
        :flow="flow"
        :options="options"
        @patch="emit('patch', $event)"
        @invalid="emit('invalid', $event)"
      />
    </template>
    <template v-else-if="s.enum">
      <select :id="fieldId" :value="value" :disabled="disabled" @change="patch($event.target.value)">
        <option v-if="selectDefault && !s.enum.includes(value)" :value="value" disabled>
          {{ value }}（不在选项中）
        </option>
        <option v-for="option in s.enum" :key="option">{{ option }}</option>
      </select>
    </template>
    <template v-else-if="s.type === 'object' && s.properties">
      <div class="nested-fields">
        <SchemaField
          v-for="(child, key) in properties"
          :key="key"
          :schema="child"
          :root="root"
          :value="value?.[key]"
          :path="[...path, key]"
          :flow="flow"
          @patch="emit('patch', $event)"
          @invalid="emit('invalid', $event)"
        />
      </div>
    </template>
    <template v-else-if="s.type === 'object' && typeof s.additionalProperties === 'object'">
      <div class="map-fields">
        <SchemaField
          v-for="(item, key) in value"
          :key="key"
          :schema="s.additionalProperties"
          :root="root"
          :value="item"
          :path="[...path, key]"
          :flow="flow"
          @patch="emit('patch', $event)"
          @invalid="emit('invalid', $event)"
        />
        <form class="map-add" @submit.prevent="addKey">
          <input v-model="newKey" aria-label="新增字段名称" placeholder="新名称" /><button type="submit">
            添加
          </button>
        </form>
      </div>
    </template>
    <template v-else-if="s.type === 'array'">
      <div class="array-fields">
        <SchemaField
          v-for="(item, i) in value"
          :key="i"
          :schema="s.items"
          :root="root"
          :value="item"
          :path="[...path, i]"
          :label="`第 ${i + 1} 项`"
          :flow="flow"
          @patch="emit('patch', $event)"
          @invalid="emit('invalid', $event)"
        />
        <button
          type="button"
          @click="emit('patch', { path: [...path, value.length], value: initialValue(s.items, root) })"
        >
          ＋ 添加一项
        </button>
      </div>
    </template>
    <input
      v-else-if="s.type === 'boolean'"
      :id="fieldId"
      type="checkbox"
      :checked="value"
      @change="patch($event.target.checked)"
    />
    <textarea
      v-else-if="
        s.type === 'string' && ['message', 'query', 'condition', 'description'].includes(path.at(-1))
      "
      :id="fieldId"
      :value="value"
      rows="3"
      @change="scalar"
    />
    <input
      v-else-if="s.type"
      :id="fieldId"
      :value="value"
      :disabled="disabled || 'const' in s"
      @change="scalar"
    />
    <textarea v-else :id="fieldId" :value="JSON.stringify(value, null, 2)" rows="3" @change="json" />
  </div>
</template>
