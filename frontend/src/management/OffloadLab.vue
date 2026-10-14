<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import LoadLineChart from './LoadLineChart.vue';
import { errorText } from '../api.js';
import { destinationNames, strategyNames, taskWindow, resourceWindow } from './offload-lab.js';
const props = defineProps({ api: Function });
const runs = ref([]),
  view = ref(null),
  id = ref(''),
  error = ref(''),
  busy = ref(false);
const strategy = ref('LOCAL'),
  seconds = ref(90),
  interval = ref(10),
  seed = ref(31),
  range = ref(0);
let timer,
  alive = true,
  refreshing = false;
const active = computed(() => runs.value.find((r) => ['SENDING', 'DRAINING'].includes(r.state)));
const run = computed(() => view.value?.run);
const to = computed(() => run.value?.endedAt || Date.now() / 1000);
const from = computed(() =>
  Math.max(run.value?.startAt || to.value, range.value ? to.value - range.value : 0),
);
const tasks = computed(() => taskWindow(view.value?.tasks || [], from.value, to.value));
const resources = computed(() => resourceWindow(view.value?.samples || [], from.value, to.value));
const summary = computed(() => view.value?.summary);
const phases = computed(() =>
  (run.value?.changes || []).map((p, i) => ({ number: i + 2, beganAt: new Date(p.at * 1000).toISOString() })),
);
const number = (n) => (n == null ? '—' : n.toFixed(2));
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const rows = await props.api('/edge/offload-lab/runs');
    if (!alive) return;
    const previousActiveId = active.value?.id;
    runs.value = rows;
    if (active.value && active.value.id !== previousActiveId) {
      strategy.value = active.value.strategy;
      seconds.value = active.value.seconds;
      interval.value = active.value.interval;
      seed.value = active.value.seed;
    }
    if (!id.value && rows.length) id.value = rows[0].id;
    const selected = id.value;
    if (selected) {
      const next = await props.api(`/edge/offload-lab/runs/${selected}`);
      if (alive && selected === id.value) view.value = next;
    }
    error.value = '';
  } catch (e) {
    if (alive) error.value = errorText(e);
  } finally {
    refreshing = false;
  }
}
async function command(path, body) {
  busy.value = true;
  try {
    const result = await props.api('/edge/offload-lab' + path, { method: 'POST', body });
    if (path === '/runs') id.value = result.id;
    await refresh();
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
onMounted(() => {
  refresh();
  timer = setInterval(refresh, 3000);
});
onBeforeUnmount(() => {
  alive = false;
  clearInterval(timer);
});
</script>
<template>
  <div class="offload-lab">
    <div v-if="error" class="notice error" role="alert">{{ error }}</div>
    <div class="panel controls">
      <label
        >调度策略<select v-model="strategy" aria-label="调度策略">
          <option v-for="(name, key) in strategyNames" :key="key" :value="key">{{ name }}</option>
        </select></label
      >
      <label
        >发送时长（秒）<input v-model.number="seconds" type="number" min="1" max="3600" :disabled="!!active"
      /></label>
      <label
        >每台平均间隔（秒）<input
          v-model.number="interval"
          type="number"
          min="0.1"
          step="0.1"
          :disabled="!!active"
      /></label>
      <label>随机种子<input v-model.number="seed" type="number" :disabled="!!active" /></label>
      <button
        v-if="!active"
        class="primary"
        :disabled="busy"
        @click="command('/runs', { strategy, seconds, interval, seed })"
      >
        开始发送
      </button>
      <template v-else>
        <button
          :disabled="busy || active.state !== 'SENDING'"
          @click="command(`/runs/${active.id}/strategy`, { strategy })"
        >
          切换策略
        </button>
        <button :disabled="busy" @click="command(`/runs/${active.id}/stop`, {})">停止发送</button>
      </template>
    </div>
    <div class="controls">
      <label
        >执行记录<select v-model="id" @change="refresh">
          <option v-for="r in runs" :key="r.id" :value="r.id">
            {{ new Date(r.createdAt * 1000).toLocaleString() }} · {{ strategyNames[r.strategy] }} ·
            {{
              {
                SENDING: '发送中',
                DRAINING: '执行中',
                FINISHED: '已完成',
                ERROR: '异常',
                INTERRUPTED: '已中断',
              }[r.state] || r.state
            }}
          </option>
        </select></label
      >
      <label
        >展示区间<select v-model.number="range">
          <option :value="0">本次全部</option>
          <option :value="60">最近 1 分钟</option>
          <option :value="300">最近 5 分钟</option>
        </select></label
      >
      <span v-if="run">5 / 50 / 500 MB 混合负载</span>
    </div>
    <div class="resource-grid">
      <div class="panel">
        <h3>终端 CPU 利用率</h3>
        <LoadLineChart
          :points="resources.cpu"
          :from="from * 1000"
          :to="to * 1000"
          unit="%"
          percentage
          compact
          :phases="phases"
        />
      </div>
      <div class="panel">
        <h3>终端内存利用率</h3>
        <LoadLineChart
          :points="resources.memory"
          :from="from * 1000"
          :to="to * 1000"
          unit="%"
          color="#20858e"
          percentage
          compact
          :phases="phases"
        />
      </div>
    </div>
    <div class="panel">
      <div class="heading">
        <h3>单任务端到端耗时</h3>
        <span
          >区间累计 <strong>{{ number(tasks.total) }} s</strong> · {{ tasks.count }} 个已完成任务</span
        >
      </div>
      <LoadLineChart :points="tasks.points" :from="from * 1000" :to="to * 1000" unit="秒" :phases="phases" />
      <div class="totals" v-if="summary">
        <span>提交 {{ summary.submitted }}</span
        ><span>完成 {{ summary.completed }}</span
        ><span>失败 {{ summary.failed }}</span
        ><span>待完成 {{ summary.pending }}</span
        ><span>平均 {{ number(summary.meanSeconds) }} s</span
        ><span>P95 {{ number(summary.p95Seconds) }} s</span
        ><span>批次跨度 {{ number(summary.makespanSeconds) }} s</span>
      </div>
    </div>
    <div class="panel">
      <h3>任务执行去向</h3>
      <div v-for="(name, key) in destinationNames" :key="key" class="destination">
        <span>{{ name }}</span>
        <div class="bar">
          <div
            :style="{
              width: `${(100 * (summary?.destinations[key] || 0)) / Math.max(1, summary?.submitted || 0)}%`,
            }"
          ></div>
        </div>
        <strong>{{ summary?.destinations[key] || 0 }}</strong>
      </div>
    </div>
  </div>
</template>
<style scoped>
.offload-lab {
  display: grid;
  gap: 20px;
}
.panel {
  border: 1px solid #e6e0ee;
  border-radius: 10px;
  padding: 24px;
  background: #fff;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 16px;
}
.controls label {
  display: grid;
  gap: 8px;
}
.controls input {
  width: 150px;
}
.resource-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}
.resource-grid > div {
  min-width: 0;
}
h3 {
  margin: 0 0 16px;
}
.heading,
.totals {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 16px;
}
.heading span,
.totals {
  color: #81788e;
  font-size: 14px;
}
.heading strong {
  color: #6540b8;
  font-size: 20px;
  margin-left: 10px;
}
.destination {
  display: grid;
  grid-template-columns: 70px 1fr 50px;
  gap: 16px;
  align-items: center;
  margin-top: 16px;
}
.bar {
  height: 16px;
  background: #f2eef8;
  border-radius: 5px;
  overflow: hidden;
}
.bar > div {
  height: 100%;
  background: #8763d1;
  transition: width 0.3s;
}
@media (max-width: 850px) {
  .resource-grid {
    grid-template-columns: 1fr;
  }
}
</style>
