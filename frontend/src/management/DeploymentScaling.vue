<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { time } from '../model.js';
import { errorText } from '../api.js';
import { durationText } from './operations.js';
import { replicaChart, scalingSummary } from './scaling-history.js';
const props = defineProps({ api: Function, path: String, warm: Boolean });
const hours = ref(2),
  data = ref({ samples: [], events: [] }),
  error = ref('');
const chart = computed(() => replicaChart(data.value.samples));
const summary = computed(() => scalingSummary(data.value.events));
const state = {
  OBSERVING: '进行中',
  SUCCEEDED: '完成',
  SUPERSEDED: '被后续变更替代',
  INTERRUPTED: '采集中断',
  TIMEOUT: '超时',
  REMOVED: '已删除',
};
const elapsed = (v) => (v === 0 ? '同次采样内' : durationText(v));
let alive = true,
  loading = false;
async function load() {
  if (loading) return;
  loading = true;
  const path = props.path;
  try {
    const result = await props.api(
      `${path}/scaling?since=${encodeURIComponent(new Date(Date.now() - hours.value * 3600000).toISOString())}`,
    );
    if (alive && path === props.path) {
      data.value = result;
      error.value = '';
    }
  } catch (e) {
    if (alive) error.value = errorText(e);
  } finally {
    loading = false;
  }
}
watch(
  () => [props.path, hours.value],
  () => {
    data.value = { samples: [], events: [] };
    load();
  },
  { immediate: true },
);
const timer = setInterval(load, 5000);
onBeforeUnmount(() => {
  alive = false;
  clearInterval(timer);
});
</script>
<template>
  <section class="deployment-section">
    <div class="section-heading">
      <h3>副本变化</h3>
      <select v-model.number="hours" aria-label="伸缩记录时间范围">
        <option :value="0.5">最近 30 分钟</option>
        <option :value="2">最近 2 小时</option>
        <option :value="24">最近 24 小时</option>
      </select>
    </div>
    <p v-if="error" class="notice error">{{ error }}</p>
    <template v-if="data.samples.length">
      <div class="replica-legend">
        <span class="desired">● 期望副本</span><span class="ready">● 就绪业务副本</span
        ><span v-if="warm" class="standby">● 备用实例</span>
      </div>
      <svg
        viewBox="0 0 960 210"
        class="replica-chart"
        role="img"
        aria-label="运行期间的期望副本、就绪业务副本与备用实例变化"
      >
        <g v-for="tick in chart.ticks" :key="tick.value">
          <line x1="42" x2="936" :y1="tick.y" :y2="tick.y" stroke="#e7e2ee" />
          <text x="28" :y="tick.y + 4" text-anchor="end">{{ tick.value }}</text>
        </g>
        <path
          v-for="(line, i) in chart.paths.slice(0, warm ? 3 : 2)"
          :key="i"
          :d="line"
          fill="none"
          :stroke="['#9463db', '#209891', '#d59838'][i]"
          :stroke-dasharray="i === 0 ? '5 4' : undefined"
          stroke-width="2.5"
        />
        <text
          v-for="(label, i) in chart.labels"
          :key="i"
          :x="label.x"
          y="198"
          :text-anchor="i === 0 ? 'start' : i === 2 ? 'end' : 'middle'"
        >
          {{ label.label }}
        </text>
      </svg>
    </template>
    <p v-else class="muted">暂无副本记录</p>
    <div class="section-heading">
      <h3>伸缩记录</h3>
      <span
        >扩容 {{ summary.total }} 次 · 完成 {{ summary.completed }} 次 · 平均耗时
        {{ elapsed(summary.mean) }}</span
      >
    </div>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>时间</th>
            <th>副本变化</th>
            <th>状态</th>
            <th>耗时</th>
            <th v-if="warm">预热命中</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="event in data.events" :key="event.id">
            <td>{{ time(event.startedAt) }}</td>
            <td>{{ event.fromReplicas }} → {{ event.toReplicas }}</td>
            <td>{{ state[event.state] || event.state }}</td>
            <td>{{ elapsed(event.durationMs) }}</td>
            <td v-if="warm">
              {{
                event.warmHits == null ? '—' : `${event.warmHits} / ${event.toReplicas - event.fromReplicas}`
              }}
            </td>
          </tr>
          <tr v-if="!data.events.length">
            <td :colspan="warm ? 5 : 4" class="muted">暂无伸缩记录</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
<style scoped>
.section-heading h3 {
  flex: none;
  white-space: nowrap;
}
.section-heading select {
  width: auto;
}
.replica-chart {
  width: 100%;
  max-height: 260px;
  display: block;
  font-size: 12px;
  fill: #888197;
}
.replica-legend {
  display: flex;
  gap: 22px;
  font-size: 13px;
}
.desired {
  color: #9463db;
}
.ready {
  color: #209891;
}
.standby {
  color: #d59838;
}
</style>
