<script setup>
import { onBeforeUnmount, ref, watch } from 'vue';
import { errorText } from '../api.js';
import { time } from '../model.js';
import { itemPath } from './catalogs.js';
import { durationText, stateName } from './operations.js';

const props = defineProps({ api: Function, application: Object, refresh: Number, disabled: Boolean });
const rows = ref([]),
  offset = ref(0),
  loading = ref(false),
  error = ref('');
let generation = 0,
  controller;
async function load() {
  const current = ++generation;
  controller?.abort();
  controller = new AbortController();
  rows.value = [];
  error.value = '';
  loading.value = !!props.application;
  if (!props.application) return;
  try {
    const data = await props.api(
      `${itemPath('applications', props.application)}/preparations?limit=20&offset=${offset.value}`,
      { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) },
    );
    if (current === generation) rows.value = data;
  } catch (e) {
    if (current === generation) error.value = errorText(e);
  } finally {
    if (current === generation) loading.value = false;
  }
}
watch(
  () => [props.application?.applicationId, props.application?.version, props.refresh],
  () => {
    offset.value = 0;
    load();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  generation++;
  controller?.abort();
});
function paginate(delta) {
  offset.value += delta * 20;
  load();
}
const duration = (row) =>
  row.finishedAt ? durationText(Date.parse(row.finishedAt) - Date.parse(row.startedAt)) : '—';
</script>

<template>
  <section class="management-editor">
    <div class="section-heading">
      <h2>按需分发历史</h2>
      <button :disabled="disabled || loading || !application" @click="load">刷新历史</button>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="table-wrap">
      <table aria-label="按需分发历史">
        <thead>
          <tr>
            <th>目标集群</th>
            <th>状态</th>
            <th>发起人</th>
            <th>开始时间</th>
            <th>耗时</th>
            <th>源 / 目标镜像</th>
            <th>错误</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td>{{ row.clusterId }}</td>
            <td>{{ stateName(row.state) }}</td>
            <td>{{ row.requestedBy }}</td>
            <td>{{ time(row.startedAt) }}</td>
            <td>{{ duration(row) }}</td>
            <td class="mono">
              <div>{{ row.sourceImage }}</div>
              <div>{{ row.targetImage || '—' }}</div>
            </td>
            <td>{{ row.error || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="loading" class="empty">正在读取分发记录…</p>
    <p v-else-if="!rows.length && !error" class="empty">
      {{ application ? '暂无分发记录' : '请选择应用版本' }}
    </p>
    <div class="pagination">
      <button :disabled="disabled || loading || offset === 0" @click="paginate(-1)">上一页</button>
      <span>第 {{ offset / 20 + 1 }} 页</span>
      <button :disabled="disabled || loading || rows.length < 20" @click="paginate(1)">下一页</button>
    </div>
  </section>
</template>
