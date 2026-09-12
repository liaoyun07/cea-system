<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { errorText } from './api.js';
import { readDocument } from './no-code/document.js';
import { time } from './model.js';
import { chartScale, instanceLabel, metricSources, metricTags, numericMetrics } from './execution-metrics.js';

const props = defineProps({ api: Function, run: Object, tasks: Array });
const sources = ref([]),
  taskId = ref(''),
  port = ref(''),
  metric = ref('');
const rows = ref([]),
  page = ref(0),
  loading = ref(false),
  sourceError = ref(''),
  loadingSource = ref(false);
const pageSize = 20;
let alive = true,
  generation = 0,
  controller;
const ports = computed(() => sources.value.find((entry) => entry.id === taskId.value)?.ports || []);
const instances = computed(() =>
  props.tasks
    .filter((task) => task.taskId === taskId.value)
    .slice()
    .sort(
      (a, b) =>
        instanceLabel(a, props.tasks).localeCompare(instanceLabel(b, props.tasks), undefined, {
          numeric: true,
        }) || a.id.localeCompare(b.id),
    ),
);
const pages = computed(() => Math.max(1, Math.ceil(instances.value.length / pageSize)));
const visible = computed(() => instances.value.slice(page.value * pageSize, (page.value + 1) * pageSize));
const names = computed(() =>
  [...new Set(rows.value.flatMap((row) => [...(row.values?.keys() || [])]))].sort(),
);
const points = computed(() =>
  rows.value.map((row, i) => ({
    ...row,
    index: page.value * pageSize + i + 1,
    value: row.values?.get(metric.value),
  })),
);
const scale = computed(() => chartScale(points.value.map((point) => point.value)));
const chartPoints = computed(() =>
  points.value.map((point, i) => ({
    ...point,
    x: 100 + (i + 0.5) * (640 / Math.max(1, points.value.length)),
  })),
);
const label = (task) => instanceLabel(task, props.tasks);
const tick = (value) => Number(value.toPrecision(4)).toString();

async function loadSources() {
  sourceError.value = '';
  loadingSource.value = true;
  try {
    const saved = await props.api(
      `/flows/${encodeURIComponent(props.run.flowId)}?revision=${props.run.flowRevision}`,
    );
    if (!alive) return;
    sources.value = metricSources(readDocument(saved.source).value);
    if (!sources.value.some((entry) => entry.id === taskId.value)) taskId.value = sources.value[0]?.id || '';
  } catch (error) {
    if (alive) sourceError.value = errorText(error);
  } finally {
    if (alive) loadingSource.value = false;
  }
}
async function load() {
  const current = ++generation;
  controller?.abort();
  controller = new AbortController();
  rows.value = [];
  loading.value = true;
  const file = port.value,
    tasks = [...visible.value],
    results = new Array(tasks.length);
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]);
  let next = 0;
  // Only this page is read, with at most four object requests in flight.
  await Promise.all(
    Array.from({ length: Math.min(4, tasks.length) }, async () => {
      while (next < tasks.length && current === generation && alive) {
        const index = next++,
          task = tasks[index];
        if (task.state !== 'SUCCESS') {
          results[index] = { task };
          continue;
        }
        if (!file) {
          results[index] = { task };
          continue;
        }
        try {
          const data = await props.api(
            `/executions/${encodeURIComponent(props.run.id)}/tasks/${encodeURIComponent(task.id)}/output-json?port=${encodeURIComponent(file)}`,
            { signal },
          );
          results[index] = { task, values: numericMetrics(data), tags: metricTags(data) };
        } catch (error) {
          results[index] = { task, error: errorText(error) };
        }
      }
    }),
  );
  if (!alive || current !== generation) return;
  rows.value = results;
  loading.value = false;
}
watch(taskId, () => {
  page.value = 0;
  port.value = ports.value.includes('metrics.json') ? 'metrics.json' : ports.value[0] || '';
});
watch(pages, (count) => {
  if (page.value >= count) page.value = count - 1;
});
watch(
  () =>
    JSON.stringify([
      port.value,
      visible.value.map((task) => [task.id, task.state, task.outputs?.[port.value]]),
    ]),
  load,
);
watch(names, (values) => {
  if (!loading.value && !values.includes(metric.value)) metric.value = values[0] || '';
});
onMounted(loadSources);
onBeforeUnmount(() => {
  alive = false;
  ++generation;
  controller?.abort();
});
</script>

<template>
  <section class="metrics-view" aria-label="执行 Metrics">
    <div v-if="sourceError" class="notice error" role="alert">
      {{ sourceError }} <button @click="loadSources">重新读取</button>
    </div>
    <p v-else-if="loadingSource" class="empty">正在读取指标来源…</p>
    <p v-else-if="!sources.length" class="empty">此执行未声明 JSON 指标产物</p>
    <template v-else>
      <div class="metrics-toolbar">
        <label
          >任务<select v-model="taskId" aria-label="指标任务">
            <option v-for="source in sources" :key="source.id" :value="source.id">{{ source.id }}</option>
          </select></label
        >
        <label
          >产物<select v-model="port" aria-label="指标产物">
            <option v-for="file in ports" :key="file" :value="file">{{ file }}</option>
          </select></label
        >
        <label
          >指标<select v-model="metric" aria-label="指标名称" :disabled="!names.length">
            <option v-if="!names.length" value="">暂无数值指标</option>
            <option v-for="name in names" :key="name" :value="name">{{ name }}</option>
          </select></label
        >
        <button :disabled="loading" @click="load">{{ loading ? '读取中…' : '刷新指标' }}</button>
      </div>
      <div class="panel metrics-chart" v-if="metric && !loading">
        <header>
          <h2>{{ metric }}</h2>
          <span class="muted"
            >任务实例 · {{ page * pageSize + 1 }}–{{ page * pageSize + points.length }}</span
          >
        </header>
        <div class="metrics-plot" :class="{ dense: points.length > 8 }">
          <svg viewBox="0 0 800 280" role="img" :aria-label="`${metric} 按任务实例分布`">
            <g v-for="value in [scale.min, scale.max]" :key="value">
              <line x1="100" x2="740" :y1="scale.y(value)" :y2="scale.y(value)" class="grid-line" />
              <text x="90" :y="scale.y(value) + 4" text-anchor="end">{{ tick(value) }}</text>
            </g>
            <line x1="100" x2="740" :y1="scale.y(0)" :y2="scale.y(0)" class="axis-line" />
            <g v-for="point in chartPoints" :key="point.task.id">
              <rect
                v-if="Number.isFinite(point.value)"
                :x="point.x - Math.min(22, 220 / points.length)"
                :width="Math.min(44, 440 / points.length)"
                :y="Math.min(scale.y(0), scale.y(point.value))"
                :height="Math.max(1, Math.abs(scale.y(point.value) - scale.y(0)))"
                rx="3"
                class="metric-bar"
                :data-task-run="point.task.id"
                :data-value="point.value"
              >
                <title>{{ label(point.task) }} · {{ metric }} = {{ point.value }}</title>
              </rect>
              <text :x="point.x" y="247" text-anchor="middle">{{ point.index }}</text>
            </g>
            <text x="420" y="273" text-anchor="middle">任务实例序号</text>
          </svg>
        </div>
      </div>
      <div class="table-wrap" :aria-busy="loading">
        <table aria-label="指标明细">
          <thead>
            <tr>
              <th># / 任务实例</th>
              <th>指标</th>
              <th>值</th>
              <th>标签</th>
              <th>完成时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in points" :key="row.task.id">
              <td>
                <strong>{{ row.index }} · {{ label(row.task) }}</strong
                ><small class="mono muted">{{ row.task.id }}</small>
              </td>
              <td>{{ metric || '—' }}</td>
              <td>
                <span v-if="row.error" class="error-text" role="alert">{{ row.error }}</span
                ><span v-else-if="row.task.state !== 'SUCCESS'" class="status" :data-state="row.task.state">{{
                  row.task.state
                }}</span
                ><span v-else>{{
                  row.value === undefined ? (row.values?.size ? '此实例无此指标' : '无数值指标') : row.value
                }}</span>
              </td>
              <td>
                <span v-for="[name, value] in row.tags || []" :key="name" class="metric-tag"
                  >{{ name }}: {{ value }}</span
                ><span v-if="!row.tags?.length">—</span>
              </td>
              <td>{{ time(row.task.endedAt) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="loading" class="empty" role="status">正在读取指标…</p>
        <p v-else-if="!points.length" class="empty">尚无任务实例</p>
      </div>
      <div class="metrics-pagination">
        <span>{{ instances.length }} 个实例 · 第 {{ page + 1 }} / {{ pages }} 页</span
        ><button :disabled="page === 0 || loading" @click="page--">上一页</button
        ><button :disabled="page + 1 >= pages || loading" @click="page++">下一页</button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.metrics-view {
  display: grid;
  gap: 18px;
  min-width: 0;
}
.metrics-toolbar {
  display: flex;
  align-items: end;
  flex-wrap: wrap;
  gap: 14px;
}
.metrics-toolbar label {
  display: grid;
  gap: 7px;
  flex: 1;
  min-width: 150px;
}
.metrics-toolbar select {
  width: 100%;
}
.metrics-chart {
  padding: 20px;
}
.metrics-chart header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.metrics-chart h2 {
  margin: 0;
}
.metrics-chart svg {
  display: block;
  width: 100%;
  max-height: 320px;
}
.metrics-plot {
  overflow-x: auto;
}
.metrics-view table {
  min-width: 850px;
}
.metrics-view td:first-child {
  min-width: 260px;
}
.metrics-chart text {
  fill: var(--muted, #776c89);
  font-size: 13px;
}
.grid-line {
  stroke: #e8e2ef;
  stroke-dasharray: 3 4;
}
.axis-line {
  stroke: #b9adca;
}
.metric-bar {
  fill: #7146ce;
}
td small {
  display: block;
  margin-top: 6px;
  font-size: 11px;
}
td {
  vertical-align: top;
}
td .error-text {
  display: inline-block;
  max-width: 320px;
  overflow-wrap: anywhere;
  white-space: normal;
}
.metric-tag {
  display: block;
  max-width: 260px;
  overflow-wrap: anywhere;
  white-space: normal;
}
.metrics-pagination {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: flex-end;
  color: var(--muted, #776c89);
  font-size: 13px;
}
@media (max-width: 600px) {
  .metrics-plot:not(.dense) text {
    font-size: 26px;
  }
  .metrics-plot.dense svg {
    min-width: 800px;
  }
  .metrics-plot.dense text {
    font-size: 16px;
  }
  .metrics-toolbar label {
    flex-basis: 100%;
  }
  .metrics-chart {
    padding: 12px 4px;
  }
  .metrics-chart header {
    padding: 0 8px;
  }
  .metrics-pagination {
    flex-wrap: wrap;
  }
}
</style>
