<script setup>
import { computed, ref } from 'vue';
import BindingField from './BindingField.vue';
import JsonValueField from './JsonValueField.vue';
const props = defineProps({ value: Object, path: Array, flow: Object });
const emit = defineEmits(['patch', 'invalid']);
const errors = ref({});
const arrayMode = computed(() => props.value?.source === 'LITERAL');
const validArray = computed(() => Array.isArray(props.value?.value));
const invalid = computed(() => Object.values(errors.value).some(Boolean));
function report(event) {
  errors.value = { ...errors.value, [JSON.stringify(event.path)]: event.message };
  emit('invalid', event);
}
function patch(event) {
  errors.value = Object.fromEntries(
    Object.entries(errors.value).filter(
      ([key]) => !event.path.every((part, i) => JSON.parse(key)[i] === part),
    ),
  );
  emit('patch', event);
}
function mode(array) {
  if (array === arrayMode.value || invalid.value) return;
  if (!window.confirm('切换集合来源将替换当前配置，是否继续？')) return;
  let value = [];
  if (array && props.value?.source === 'INPUT') {
    const initial = props.flow.inputs?.[props.value.name]?.defaultValue;
    if (Array.isArray(initial)) value = initial;
  }
  patch({ path: props.path, value: array ? { source: 'LITERAL', value } : { source: 'INPUT', name: '' } });
}
function move(index, delta) {
  const values = [...props.value.value];
  [values[index], values[index + delta]] = [values[index + delta], values[index]];
  patch({ path: [...props.path, 'value'], value: values });
}
</script>
<template>
  <div class="loop-values-field">
    <div class="loop-value-modes" role="group" aria-label="values 来源模式">
      <button type="button" :aria-pressed="!arrayMode" :disabled="invalid" @click="mode(false)">引用</button>
      <button type="button" :aria-pressed="arrayMode" :disabled="invalid" @click="mode(true)">Array</button>
    </div>
    <template v-if="arrayMode && validArray">
      <div v-for="(item, index) in value.value" :key="index" class="loop-value-item" :data-loop-item="index">
        <div class="loop-value-actions">
          <button
            type="button"
            :aria-label="`上移 values 第 ${index + 1} 项`"
            :disabled="invalid || index === 0"
            @click="move(index, -1)"
          >
            ↑
          </button>
          <button
            type="button"
            :aria-label="`下移 values 第 ${index + 1} 项`"
            :disabled="invalid || index === value.value.length - 1"
            @click="move(index, 1)"
          >
            ↓
          </button>
          <button
            type="button"
            :aria-label="`删除 values 第 ${index + 1} 项`"
            :disabled="invalid"
            @click="patch({ path: [...path, 'value', index], remove: true })"
          >
            ×
          </button>
        </div>
        <JsonValueField
          :value="item"
          :path="[...path, 'value', index]"
          :label="`第 ${index + 1} 项`"
          @patch="patch"
          @invalid="report"
        />
      </div>
      <button
        type="button"
        class="loop-add-value"
        :disabled="invalid || value.value.length >= 1000"
        @click="patch({ path: [...path, 'value', value.value.length], value: '' })"
      >
        ＋ 添加到 values
      </button>
    </template>
    <template v-else-if="arrayMode">
      <p role="alert" class="notice error">values 固定值必须为数组，请修正源码或重新设置。</p>
      <button type="button" @click="patch({ path, value: { source: 'LITERAL', value: [] } })">
        重新设置 Array
      </button>
    </template>
    <BindingField
      v-else
      :value="value"
      :path="path"
      :flow="flow"
      :allowed-sources="['INPUT', 'VARIABLE', 'TASK_OUTPUT']"
      @patch="patch"
      @invalid="report"
    />
  </div>
</template>
