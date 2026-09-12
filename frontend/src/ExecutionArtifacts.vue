<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { instanceLabel } from './execution-metrics.js';
import { errorText } from './api.js';
const props = defineProps({ api: Function, run: Object, tasks: Array });
const sources = ref([]),
  error = ref(''),
  loading = ref(false),
  page = ref(0);
const selected = ref(null),
  content = ref(null),
  previewError = ref(''),
  reading = ref(false);
let alive = true,
  generation = 0,
  controller;
const rows = computed(() =>
  props.tasks
    .flatMap((task) =>
      (sources.value.find((source) => source.id === task.taskId)?.ports || []).map((port) => ({
        task,
        port,
        label: instanceLabel(task, props.tasks),
        uri: task.outputs?.[port],
        key: `${task.id}/${port}`,
      })),
    )
    .sort(
      (a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }) || a.port.localeCompare(b.port),
    ),
);
const pages = computed(() => Math.max(1, Math.ceil(rows.value.length / 20)));
const visible = computed(() => rows.value.slice(page.value * 20, page.value * 20 + 20));
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const value = await props.api(`/executions/${encodeURIComponent(props.run.id)}/output-files`);
    if (alive) sources.value = value;
  } catch (e) {
    if (alive) error.value = errorText(e);
  } finally {
    if (alive) loading.value = false;
  }
}
function close() {
  generation++;
  controller?.abort();
  selected.value = null;
  content.value = null;
  previewError.value = '';
  reading.value = false;
}
async function preview(row) {
  close();
  selected.value = row;
  reading.value = true;
  const current = generation;
  controller = new AbortController();
  try {
    const value = await props.api(
      `/executions/${encodeURIComponent(props.run.id)}/tasks/${encodeURIComponent(row.task.id)}/output-json?port=${encodeURIComponent(row.port)}`,
      {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
      },
    );
    if (alive && current === generation) content.value = JSON.stringify(value, null, 2);
  } catch (e) {
    if (alive && current === generation) previewError.value = errorText(e);
  } finally {
    if (alive && current === generation) reading.value = false;
  }
}
watch(pages, (count) => {
  if (page.value >= count) page.value = count - 1;
});
watch(
  () => props.tasks,
  () => {
    if (!selected.value) return;
    const current = rows.value.find((row) => row.key === selected.value.key);
    if (!current || current.uri !== selected.value.uri || current.task.state !== 'SUCCESS') close();
  },
);
onMounted(load);
onBeforeUnmount(() => {
  alive = false;
  close();
});
</script>

<template>
  <section class="panel artifact-panel">
    <div class="panel-heading">
      <h2>任务产物</h2>
      <button :disabled="loading" @click="load">刷新产物</button>
    </div>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <div v-if="loading" class="empty">正在读取产物…</div>
    <div v-else-if="!rows.length && !error" class="empty">暂无声明的任务产物</div>
    <div v-else-if="rows.length" class="table-wrap">
      <table class="artifact-table" aria-label="任务产物">
        <thead>
          <tr>
            <th>任务实例</th>
            <th>输出端口</th>
            <th>状态</th>
            <th>产物地址</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in visible" :key="row.key" :data-artifact="row.key">
            <td>
              {{ row.label }}<small class="artifact-id">{{ row.task.id }}</small>
            </td>
            <td>{{ row.port }}</td>
            <td>
              <span class="status" :data-state="row.task.state">{{ row.task.state }}</span>
            </td>
            <td class="artifact-uri">{{ typeof row.uri === 'string' ? row.uri : '—' }}</td>
            <td>
              <button
                v-if="row.port.endsWith('.json')"
                :disabled="row.task.state !== 'SUCCESS' || typeof row.uri !== 'string'"
                @click="preview(row)"
              >
                预览 JSON</button
              ><span v-else class="muted">仅地址</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="rows.length" class="pagination">
      <button :disabled="page === 0" @click="page--">上一页</button><span>{{ page + 1 }} / {{ pages }}</span
      ><button :disabled="page + 1 >= pages" @click="page++">下一页</button>
    </div>
    <section v-if="selected" class="artifact-preview" aria-label="产物预览">
      <div class="panel-heading">
        <h3>{{ selected.label }} · {{ selected.port }}</h3>
        <button @click="close">关闭预览</button>
      </div>
      <p v-if="reading" role="status">正在读取 JSON…</p>
      <p v-if="previewError" role="alert" class="error">{{ previewError }}</p>
      <pre v-if="content !== null" class="output-code" data-testid="artifact-json">{{ content }}</pre>
    </section>
  </section>
</template>
