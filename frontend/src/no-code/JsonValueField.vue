<script setup>
import { computed, ref, watch } from 'vue';
import { parseJsonValue } from './document.js';
const props = defineProps({ value: null, path: Array, label: String });
const emit = defineEmits(['patch', 'invalid']);
const fieldId = computed(() => `json-value-${JSON.stringify(props.path)}`);
const draft = ref(JSON.stringify(props.value, null, 2));
let applied = JSON.stringify(props.value);
watch(
  () => JSON.stringify(props.value),
  (value) => {
    // Keep in-progress text on our own edits; refresh when an item moves or YAML changes.
    if (value !== applied) draft.value = JSON.stringify(props.value, null, 2);
    applied = value;
  },
);
function input(event) {
  draft.value = event.target.value;
  try {
    const value = parseJsonValue(draft.value);
    applied = JSON.stringify(value);
    emit('invalid', { path: props.path, message: '' });
    emit('patch', { path: props.path, value });
  } catch (error) {
    emit('invalid', {
      path: props.path,
      message: `${props.label}：JSON 格式错误，原值未修改。${error.message}`,
    });
  }
}
</script>
<template>
  <div class="json-value-field" :data-value-path="path.join('.')">
    <div class="json-value-heading">
      <label :for="fieldId">{{ label }}</label>
    </div>
    <textarea
      :id="fieldId"
      :aria-label="label"
      :value="draft"
      :rows="Math.min(8, Math.max(2, (draft || '').split('\n').length))"
      spellcheck="false"
      @input="input"
    />
  </div>
</template>
