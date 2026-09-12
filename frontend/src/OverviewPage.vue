<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { errorText } from './api.js';
import { time } from './model.js';
import { overviewCounts, overviewDays } from './overview.js';
const props = defineProps({ api: Function });
defineEmits(['execution']);
const days = ref(7),
  data = ref(null),
  error = ref(''),
  loading = ref(false);
let generation = 0,
  controller;
const counts = computed(() => (data.value ? overviewCounts(data.value) : {}));
const total = computed(() => Object.values(counts.value).reduce((sum, n) => sum + n, 0));
const active = computed(() =>
  ['CREATED', 'QUEUED', 'RUNNING', 'RETRYING', 'KILLING'].reduce(
    (sum, key) => sum + (counts.value[key] || 0),
    0,
  ),
);
const daily = computed(() => (data.value ? overviewDays(data.value) : []));
const chart = ref(null);
watch(daily, async () => {
  await nextTick();
  if (chart.value) chart.value.scrollLeft = chart.value.scrollWidth;
});
const max = computed(() => Math.max(1, ...daily.value.map((row) => row.count)));
async function load() {
  const current = ++generation;
  controller?.abort();
  controller = new AbortController();
  loading.value = true;
  error.value = '';
  data.value = null;
  try {
    const value = await props.api(`/executions/overview?days=${days.value}`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
    });
    if (current === generation) data.value = value;
  } catch (e) {
    if (current === generation) error.value = errorText(e);
  } finally {
    if (current === generation) loading.value = false;
  }
}
watch(days, load);
onMounted(load);
onBeforeUnmount(() => {
  generation++;
  controller?.abort();
});
</script>
<template>
  <section class="list-page management-page">
    <div class="page-heading">
      <div>
        <span class="eyebrow">OVERVIEW</span>
        <h1>运行总览</h1>
      </div>
      <div class="inspection-controls">
        <label
          >提交时间范围<select v-model="days" aria-label="总览时间范围">
            <option :value="1">今天（UTC）</option>
            <option :value="7">近 7 天（UTC）</option>
            <option :value="30">近 30 天（UTC）</option>
          </select></label
        ><button :disabled="loading" @click="load">刷新总览</button>
      </div>
    </div>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <div v-if="loading" class="empty">正在读取总览…</div>
    <template v-if="data">
      <div class="summary-cards">
        <article
          v-for="card in [
            ['执行总数', total],
            ['成功', counts.SUCCESS || 0],
            ['失败', counts.FAILED || 0],
            ['活跃', active],
          ]"
          :key="card[0]"
          class="summary-card"
        >
          <span>{{ card[0] }}</span
          ><strong :data-count="card[0]">{{ card[1] }}</strong>
        </article>
      </div>
      <div class="inspection-grid">
        <section class="panel">
          <h2>每日提交量</h2>
          <div ref="chart" class="daily-chart" role="img" aria-label="每日提交量图">
            <div
              v-for="row in daily"
              :key="row.date"
              class="daily-column"
              :title="`${row.date}: ${row.count}`"
            >
              <span>{{ row.count }}</span>
              <div class="daily-track">
                <i
                  class="daily-bar"
                  :style="{ height: `${(row.count / max) * 100}%` }"
                  :data-date="row.date"
                  :data-count="row.count"
                ></i>
              </div>
              <small>{{ row.date.slice(5) }}</small>
            </div>
          </div>
        </section>
        <section class="panel">
          <h2>当前状态分布</h2>
          <div v-if="!total" class="empty">此时间范围暂无执行</div>
          <div v-for="(count, state) in counts" :key="state" class="state-count">
            <span class="status" :data-state="state">{{ state }}</span>
            <div class="state-track"><i :style="{ width: `${(count / total) * 100}%` }"></i></div>
            <strong>{{ count }}</strong>
          </div>
        </section>
      </div>
      <section class="panel">
        <h2>最近执行</h2>
        <div class="table-wrap">
          <table class="overview-recent" aria-label="最近执行">
            <thead>
              <tr>
                <th>执行 ID</th>
                <th>流程</th>
                <th>状态</th>
                <th>提交时间</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="run in data.recent" :key="run.id">
                <td>
                  <button class="text-link mono" @click="$emit('execution', run.id)">{{ run.id }}</button>
                </td>
                <td>{{ run.flowId }}</td>
                <td>
                  <span class="status" :data-state="run.state">{{ run.state }}</span>
                </td>
                <td>{{ time(run.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="!data.recent.length" class="empty">暂无执行</p>
      </section>
    </template>
  </section>
</template>
