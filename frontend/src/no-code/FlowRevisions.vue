<script setup>
import { onMounted, ref, onBeforeUnmount } from 'vue';
import { errorText } from '../api.js';
import { time } from '../model.js';
const props = defineProps({ api: Function, flowId: String, current: Object, dirty: Boolean });
const emit = defineEmits(['applied']);
const rows = ref([]),
  selected = ref(null),
  error = ref(''),
  busy = ref(false),
  offset = ref(0);
let alive = true,
  generation = 0;
const path = `/flows/${encodeURIComponent(props.flowId)}`;
onBeforeUnmount(() => {
  alive = false;
});
async function load() {
  busy.value = true;
  error.value = '';
  try {
    const value = await props.api(`${path}/revisions?limit=20&offset=${offset.value}`);
    if (alive) rows.value = value;
  } catch (e) {
    if (alive) error.value = errorText(e);
  } finally {
    if (alive) busy.value = false;
  }
}
async function inspect(revision) {
  const token = ++generation;
  try {
    const value = await props.api(`${path}?revision=${revision}`);
    if (alive && token === generation) selected.value = value;
  } catch (e) {
    if (alive) error.value = errorText(e);
  }
}
async function rollback() {
  if (props.dirty || !selected.value || busy.value) return;
  if (!window.confirm(`将 r${selected.value.revision} 的内容保存为新修订？历史记录不会被删除。`)) return;
  busy.value = true;
  error.value = '';
  try {
    const result = await props.api(`${path}/rollback`, {
      method: 'POST',
      body: { expectedRevision: props.current.revision, targetRevision: selected.value.revision },
    });
    if (alive) emit('applied', result);
  } catch (e) {
    if (alive) error.value = errorText(e);
  } finally {
    if (alive) busy.value = false;
  }
}
onMounted(load);
</script>
<template>
  <section class="revision-view">
    <div v-if="error" class="notice error" role="alert">{{ error }}</div>
    <div class="revision-list">
      <button v-for="row in rows" :key="row.revision" @click="inspect(row.revision)">
        r{{ row.revision }} · {{ time(row.createdAt) }}
      </button>
    </div>
    <div class="actions">
      <button
        :disabled="busy || offset === 0"
        @click="
          offset -= 20;
          load();
        "
      >
        上一页</button
      ><button
        :disabled="busy || rows.length < 20"
        @click="
          offset += 20;
          load();
        "
      >
        下一页</button
      ><button
        class="primary"
        :disabled="busy || dirty || !selected || selected.revision === current.revision"
        @click="rollback"
      >
        回退为新修订
      </button>
    </div>
    <div v-if="selected" class="revision-compare">
      <div>
        <h2>当前保存版本 r{{ current.revision }}</h2>
        <pre>{{ current.source }}</pre>
      </div>
      <div>
        <h2>选中版本 r{{ selected.revision }}</h2>
        <pre>{{ selected.source }}</pre>
      </div>
    </div>
  </section>
</template>
