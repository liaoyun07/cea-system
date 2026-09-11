<script setup>
import { computed } from 'vue';
import { bindingScope, outputPorts, parseJsonValue } from './document.js';
const props = defineProps({ value: Object, path: Array, flow: Object, options: Array });
const emit = defineEmits(['patch', 'invalid']);
const scope = computed(() => bindingScope(props.flow, props.path));
const selected = computed(() => scope.value.entries.find((e) => e.task.id === props.value?.taskId)?.task);
const sources = {
  LITERAL: '固定值',
  INPUT: '流程输入',
  VARIABLE: '流程变量',
  TASK_OUTPUT: '上游输出',
  ITEM: '当前 item',
};
const patch = (field, value) => emit('patch', { path: [...props.path, field], value });
function changeSource(source) {
  const values = {
    LITERAL: { value: '' },
    INPUT: { name: '' },
    VARIABLE: { name: '' },
    TASK_OUTPUT: { taskId: '', port: '' },
    ITEM: { path: ['value'] },
  };
  emit('patch', { path: props.path, value: { source, ...values[source] } });
}
const literalType = computed(() => {
  const v = props.value?.value;
  return v === null ? 'null' : typeof v === 'object' ? 'json' : typeof v;
});
function literal(event) {
  try {
    const raw = event.target.value;
    const value = literalType.value === 'string' ? raw : parseJsonValue(raw);
    emit('invalid', { path: props.path, message: '' });
    patch('value', value);
  } catch (error) {
    emit('invalid', { path: props.path, message: `固定值格式错误：${error.message}` });
  }
}
</script>
<template>
  <div class="binding-field">
    <label class="sr-only">参数来源</label>
    <select
      aria-label="参数来源"
      :value="value?.source || 'LITERAL'"
      @change="changeSource($event.target.value)"
    >
      <option
        v-for="(label, key) in sources"
        :key="key"
        :value="key"
        :disabled="key === 'ITEM' && !scope.item"
      >
        {{ label }}
      </option>
    </select>
    <template v-if="value?.source === 'INPUT' || value?.source === 'VARIABLE'">
      <select
        :aria-label="value.source === 'INPUT' ? '流程输入引用' : '流程变量引用'"
        :value="value.name"
        @change="patch('name', $event.target.value)"
      >
        <option value="" disabled>选择已显式定义的名称</option>
        <option
          v-if="
            value.name && !(value.name in (flow[value.source === 'INPUT' ? 'inputs' : 'variables'] || {}))
          "
          :value="value.name"
        >
          {{ value.name }}（引用已失效）
        </option>
        <option
          v-for="(_, name) in flow[value.source === 'INPUT' ? 'inputs' : 'variables'] || {}"
          :key="name"
        >
          {{ name }}
        </option>
      </select>
      <small>在“流程设置”中定义；这里仅引用，不自动创建。</small>
    </template>
    <template v-else-if="value?.source === 'TASK_OUTPUT'">
      <select
        aria-label="上游任务"
        :value="value.taskId"
        @change="emit('patch', { path, value: { ...value, taskId: $event.target.value, port: '' } })"
      >
        <option value="" disabled>选择当前作用域中可用的上游</option>
        <option v-if="value.taskId && !selected" :value="value.taskId">
          {{ value.taskId }}（当前作用域不可用）
        </option>
        <option v-for="entry in scope.entries" :key="entry.task.id" :value="entry.task.id">
          {{ entry.task.id }}
        </option>
      </select>
      <select aria-label="输出端口" :value="value.port" @change="patch('port', $event.target.value)">
        <option value="" disabled>选择输出端口</option>
        <option v-if="value.port && !outputPorts(selected || {}).includes(value.port)" :value="value.port">
          {{ value.port }}（未声明）
        </option>
        <option v-for="port in outputPorts(selected || {})" :key="port">{{ port }}</option>
      </select>
      <small v-if="!scope.entries.length"
        >当前没有可引用的上游。DAG 内请先设置依赖；循环外请引用循环的输出。</small
      >
    </template>
    <template v-else-if="value?.source === 'ITEM'">
      <input
        aria-label="item 路径"
        :value="(value.path || []).join('.')"
        placeholder="value / value.cluster / index"
        @change="patch('path', $event.target.value.split('.').filter(Boolean))"
      />
      <small>value 为当前元素，index 为从 0 开始的下标；仅在 Loop 内可用。</small>
    </template>
    <template v-else>
      <template v-if="options?.length">
        <select
          aria-label="契约允许值"
          :value="JSON.stringify(value?.value)"
          @change="patch('value', JSON.parse($event.target.value))"
        >
          <option value="" disabled>选择契约允许的值</option>
          <option
            v-if="!options.some((o) => JSON.stringify(o.value) === JSON.stringify(value?.value))"
            :value="JSON.stringify(value?.value)"
          >
            {{ value?.value }}（不在允许范围）
          </option>
          <option
            v-for="option in options"
            :key="JSON.stringify(option.value)"
            :value="JSON.stringify(option.value)"
          >
            {{ option.label }}
          </option>
        </select>
      </template>
      <template v-else>
        <select
          aria-label="固定值类型"
          :value="literalType"
          @change="
            patch(
              'value',
              { string: '', number: 0, boolean: false, json: [], null: null }[$event.target.value],
            )
          "
        >
          <option value="string">文本</option>
          <option value="number">数字</option>
          <option value="boolean">布尔值</option>
          <option value="json">数组 / 对象</option>
          <option value="null">null</option>
        </select>
        <select
          v-if="literalType === 'boolean'"
          aria-label="固定值"
          :value="String(value.value)"
          @change="literal"
        >
          <option>true</option>
          <option>false</option>
        </select>
        <textarea
          v-else-if="literalType === 'json'"
          aria-label="固定值 JSON"
          rows="4"
          :value="JSON.stringify(value.value, null, 2)"
          @change="literal"
        />
        <input
          v-else-if="literalType !== 'null'"
          aria-label="固定值"
          :value="value?.value ?? ''"
          @change="literal"
        />
      </template>
    </template>
  </div>
</template>
