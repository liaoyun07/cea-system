<script setup>
import { computed, ref } from 'vue';
import { parseJsonValue } from './document.js';
const props = defineProps({ value: null, path: Array, label: String });
const emit = defineEmits(['patch', 'invalid']);
const newKey = ref('');
const type = computed(() =>
  props.value === null ? 'null' : Array.isArray(props.value) ? 'array' : typeof props.value,
);
const types = {
  string: 'String',
  number: 'Number',
  boolean: 'Boolean',
  object: 'Object',
  array: 'Array',
  null: 'null',
};
function setType(event) {
  const next = event.target.value;
  if (next === type.value) return;
  if (props.value !== '' && props.value !== null && !window.confirm('切换类型将替换当前值，是否继续？')) {
    event.target.value = type.value;
    return;
  }
  emit('patch', {
    path: props.path,
    value: { string: '', number: 0, boolean: false, object: {}, array: [], null: null }[next],
  });
}
function number(event) {
  try {
    const value = parseJsonValue(event.target.value);
    if (typeof value !== 'number') throw new Error('请输入有效数字');
    emit('patch', { path: props.path, value });
    emit('invalid', { path: props.path, message: '' });
  } catch {
    emit('invalid', { path: props.path, message: `${props.label}：请输入安全范围内的有效数字` });
  }
}
function addKey() {
  const key = newKey.value.trim();
  if (!key || Object.hasOwn(props.value, key)) {
    emit('invalid', { path: [...props.path, '$newKey'], message: '字段名称不能为空或重复' });
    return;
  }
  emit('invalid', { path: [...props.path, '$newKey'], message: '' });
  emit('patch', { path: [...props.path, key], value: '' });
  newKey.value = '';
}
</script>
<template>
  <div class="json-value-field" :data-value-path="path.join('.')">
    <div class="json-value-heading">
      <label>{{ label }}</label>
      <select :aria-label="`${label} 类型`" :value="type" @change="setType">
        <option v-for="(name, key) in types" :key="key" :value="key">{{ name }}</option>
      </select>
    </div>
    <input
      v-if="type === 'string'"
      :aria-label="label"
      :value="value"
      @change="emit('patch', { path, value: $event.target.value })"
    />
    <input
      v-else-if="type === 'number'"
      :aria-label="label"
      :value="value"
      inputmode="decimal"
      @change="number"
    />
    <select
      v-else-if="type === 'boolean'"
      :aria-label="label"
      :value="String(value)"
      @change="emit('patch', { path, value: $event.target.value === 'true' })"
    >
      <option>true</option>
      <option>false</option>
    </select>
    <div v-else-if="type === 'object' || type === 'array'" class="json-value-children">
      <div v-for="(child, key) in value" :key="key" class="json-value-row">
        <JsonValueField
          :value="child"
          :path="[...path, key]"
          :label="type === 'array' ? `第 ${Number(key) + 1} 项` : String(key)"
          @patch="emit('patch', $event)"
          @invalid="emit('invalid', $event)"
        />
        <button
          type="button"
          class="field-clear"
          :aria-label="`删除 ${label}.${key}`"
          @click="emit('patch', { path: [...path, key], remove: true })"
        >
          ×
        </button>
      </div>
      <button
        v-if="type === 'array'"
        type="button"
        class="loop-add-value"
        :aria-label="`添加到 ${label}`"
        @click="emit('patch', { path: [...path, value.length], value: '' })"
      >
        ＋ 添加一项
      </button>
      <form v-else class="json-key-add" @submit.prevent="addKey">
        <input v-model="newKey" :aria-label="`${label} 新字段名`" placeholder="字段名" />
        <button type="submit">添加字段</button>
      </form>
    </div>
  </div>
</template>
