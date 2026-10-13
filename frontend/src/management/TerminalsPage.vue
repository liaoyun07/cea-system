<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { errorText } from '../api.js';
import { time } from '../model.js';
import LoadLineChart from './LoadLineChart.vue';
import CatalogPage from './CatalogPage.vue';
import { places, strategyName, summarize, resourceSeries, usage, stamp } from './terminal-load.js';
const props = defineProps({ api: Function, namespace: String });
const emit = defineEmits(['execution', 'dirty', 'pending']);
const editing = ref(false),
  editingRow = ref(null);
function edit(row = null) {
  editingRow.value = row;
  editing.value = true;
}
const tab = ref('devices'),
  devices = ref([]),
  profiles = ref({}),
  runs = ref([]),
  view = ref(null);
const selected = ref([]),
  profileId = ref(''),
  meanIntervalSeconds = ref(5),
  inputSize = ref('mixed'),
  seed = ref(31);
const strategy = ref('LOCAL'),
  runId = ref(''),
  range = ref(300),
  terminalFilter = ref(''),
  busy = ref(false),
  error = ref('');
const now = ref(Date.now());
let timer,
  alive = true,
  refreshing = false,
  generation = 0;
const current = computed(() => view.value?.data.run);
const draining = computed(() => devices.value.some((d) => d.loadRunId === runId.value && runId.value));
const members = computed(() =>
  terminalFilter.value ? [terminalFilter.value] : current.value?.config.terminals || [],
);
const to = computed(() => {
  const data = view.value?.data;
  if (!data || current.value.sending || draining.value) return now.value;
  return data.requests.reduce(
    (end, r) => Math.max(end, stamp(r.finishedAt) || 0),
    data.samples.reduce((end, s) => Math.max(end, stamp(s.sampledAt)), stamp(current.value.stoppedAt)),
  );
});
const from = computed(() =>
  Number(range.value) === 0
    ? stamp(current.value?.createdAt) || now.value
    : Math.max(stamp(current.value?.createdAt) || now.value, to.value - Number(range.value) * 1000),
);
const summary = computed(() => summarize(view.value, members.value, from.value, to.value));
const resources = computed(() =>
  resourceSeries(view.value?.data.samples || [], members.value, from.value, to.value),
);
const online = (device) => now.value - stamp(device.terminal.lastSeenAt) < 15000;
const measured = (device) => now.value - stamp(device.sampledAt) < 15000;
const percent = (value) => (value == null ? '—' : `${value.toFixed(1)}%`);
const last = (points) => (points.length ? points[points.length - 1].y : null);
async function refresh() {
  if (refreshing || !alive) return;
  refreshing = true;
  const epoch = generation;
  try {
    const [nextDevices, nextRuns] = await Promise.all([
      props.api('/edge/load/devices'),
      props.api('/edge/load/runs'),
    ]);
    if (!alive || epoch !== generation) return;
    devices.value = nextDevices;
    runs.value = nextRuns;
    now.value = Date.now();
    if (!runId.value && nextRuns.length) runId.value = nextRuns[0].id;
    const id = runId.value;
    if (id) {
      const result = await props.api(`/edge/load/runs/${encodeURIComponent(id)}`);
      if (alive && epoch === generation && id === runId.value) view.value = result;
    }
  } catch (e) {
    if (alive) error.value = errorText(e);
  } finally {
    refreshing = false;
  }
}
async function mutate(action) {
  busy.value = true;
  error.value = '';
  try {
    await action();
    await refresh();
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
function start() {
  return mutate(async () => {
    const result = await props.api('/edge/load/runs', {
      method: 'POST',
      body: {
        profileId: profileId.value,
        terminals: selected.value,
        meanIntervalSeconds: Number(meanIntervalSeconds.value),
        inputSize: inputSize.value,
        seed: Number(seed.value),
        strategy: strategy.value,
      },
    });
    runId.value = result.id;
    view.value = null;
    terminalFilter.value = '';
    generation++;
  });
}
function switchStrategy(value) {
  if (!current.value?.sending) {
    strategy.value = value;
    return;
  }
  return mutate(async () => {
    await props.api(`/edge/load/runs/${runId.value}/strategy`, { method: 'POST', body: { strategy: value } });
    strategy.value = value;
  });
}
const activeStrategy = computed(() =>
  current.value?.sending ? view.value.data.phases.at(-1)?.strategy : strategy.value,
);
function selectRun() {
  generation++;
  view.value = null;
  terminalFilter.value = '';
  refresh();
}
onMounted(async () => {
  try {
    profiles.value = await props.api('/edge/load/profiles');
    profileId.value = Object.keys(profiles.value)[0] || '';
  } catch (e) {
    error.value = errorText(e);
  }
  await refresh();
  if (alive) timer = setInterval(refresh, 2000);
});
onBeforeUnmount(() => {
  alive = false;
  clearInterval(timer);
});
</script>
<template>
  <CatalogPage
    v-if="editing"
    kind="terminals"
    :api="api"
    :namespace="namespace"
    form-only
    :initial-row="editingRow"
    @close="
      editing = false;
      refresh();
    "
    @dirty="emit('dirty', $event)"
    @pending="emit('pending', $event)"
  />
  <section v-else class="list-page terminal-page">
    <div class="page-heading">
      <div>
        <span class="eyebrow">TERMINALS</span>
        <h1>终端设备接入</h1>
      </div>
      <button v-if="tab === 'devices'" class="primary" @click="edit()">＋ 登记终端</button>
    </div>
    <div class="tabs">
      <button :class="{ active: tab === 'devices' }" @click="tab = 'devices'">设备列表</button
      ><button :class="{ active: tab === 'load' }" @click="tab = 'load'">负载与调度</button>
    </div>
    <div v-if="error" class="notice error" role="alert">{{ error }}</div>
    <div v-if="tab === 'devices'" class="list-toolbar">
      <button :disabled="busy" @click="refresh">刷新</button>
    </div>
    <div v-if="tab === 'devices'" class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>终端</th>
            <th>所属网关</th>
            <th>CPU / 内存额度</th>
            <th>CPU 利用率</th>
            <th>内存利用率</th>
            <th>状态</th>
            <th>最近活动</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="device in devices" :key="device.terminal.id">
            <td>{{ device.terminal.id }}</td>
            <td>{{ device.terminal.gatewayId }}</td>
            <td>
              {{
                device.resource
                  ? `${device.resource.cpuCores} 核 / ${(device.resource.memoryLimitBytes / 1048576).toFixed(0)} MiB`
                  : '—'
              }}
            </td>
            <td>{{ measured(device) ? percent(usage(device.resource).cpu) : '—' }}</td>
            <td>{{ measured(device) ? percent(usage(device.resource).memory) : '—' }}</td>
            <td>
              <span class="status" :data-state="online(device) ? 'SUCCESS' : 'CREATED'">{{
                !device.terminal.enabled ? '已停用' : online(device) ? '在线' : '离线'
              }}</span>
            </td>
            <td>{{ device.terminal.lastSeenAt ? time(device.terminal.lastSeenAt) : '尚无记录' }}</td>
            <td><button @click="edit(device.terminal)">编辑 →</button></td>
          </tr>
        </tbody>
      </table>
      <div v-if="!devices.length" class="empty">暂无终端</div>
    </div>
    <template v-else>
      <div class="load-panel">
        <div class="load-config">
          <label
            >测试应用<select v-model="profileId" :disabled="current?.sending">
              <option v-for="(profile, id) in profiles" :key="id" :value="id">{{ profile.label }}</option>
            </select></label
          >
          <label
            >每台平均请求间隔（秒）<input
              v-model="meanIntervalSeconds"
              type="number"
              min="0.1"
              max="3600"
              step="0.1"
              :disabled="current?.sending"
          /></label>
          <label
            >输入规模<select v-model="inputSize" :disabled="current?.sending">
              <option value="small">小</option>
              <option value="medium">中</option>
              <option value="large">大</option>
              <option value="mixed">混合</option>
            </select></label
          >
          <label>随机种子<input v-model="seed" type="number" :disabled="current?.sending" /></label>
        </div>
        <div class="terminal-selection">
          <label v-for="device in devices" :key="device.terminal.id"
            ><input
              v-model="selected"
              type="checkbox"
              :value="device.terminal.id"
              :disabled="
                current?.sending || !measured(device) || !device.terminal.enabled || !!device.loadRunId
              "
            />{{ device.terminal.id }}<small>{{ device.terminal.gatewayId }}</small></label
          >
        </div>
        <div class="load-actions">
          <div class="strategy-toggle">
            <button
              v-for="value in ['LOCAL', 'DQN']"
              :key="value"
              :class="{ chosen: activeStrategy === value }"
              :disabled="busy"
              @click="switchStrategy(value)"
            >
              {{ strategyName(value) }}
            </button>
          </div>
          <button
            v-if="current?.sending"
            :disabled="busy"
            @click="mutate(() => api(`/edge/load/runs/${runId}/stop`, { method: 'POST' }))"
          >
            停止发送
          </button>
          <button
            v-else
            class="primary"
            :disabled="
              busy ||
              !selected.length ||
              !profileId ||
              selected.some((id) => devices.find((d) => d.terminal.id === id)?.loadRunId)
            "
            @click="start"
          >
            开始发送
          </button>
        </div>
      </div>
      <div class="load-filters">
        <label
          >负载记录<select v-model="runId" @change="selectRun">
            <option v-for="run in runs" :key="run.id" :value="run.id">
              {{ time(run.createdAt) }} · {{ run.config.label }}
            </option>
          </select></label
        >
        <label
          >终端<select v-model="terminalFilter">
            <option value="">全部终端</option>
            <option v-for="id in current?.config.terminals || []" :key="id" :value="id">{{ id }}</option>
          </select></label
        >
        <label
          >展示区间<select v-model="range">
            <option :value="60">最近 1 分钟</option>
            <option :value="300">最近 5 分钟</option>
            <option :value="1800">最近 30 分钟</option>
            <option :value="0">全部</option>
          </select></label
        >
      </div>
      <div class="resource-grid">
        <div class="load-panel">
          <div class="chart-heading">
            <h3>终端 CPU 利用率</h3>
            <strong>{{ percent(last(resources.cpu)) }}</strong>
          </div>
          <LoadLineChart
            :points="resources.cpu"
            :from="from"
            :to="to"
            unit="CPU %"
            compact
            percentage
            :phases="view?.data.phases || []"
          />
        </div>
        <div class="load-panel">
          <div class="chart-heading">
            <h3>终端内存利用率</h3>
            <strong>{{ percent(last(resources.memory)) }}</strong>
          </div>
          <LoadLineChart
            :points="resources.memory"
            :from="from"
            :to="to"
            unit="内存 %"
            compact
            color="#358bc6"
            percentage
            :phases="view?.data.phases || []"
          />
        </div>
      </div>
      <div class="load-panel">
        <div class="chart-heading">
          <div>
            <h3>任务端到端耗时</h3>
            <small>秒</small>
          </div>
          <div class="elapsed-total">
            <span>区间累计任务耗时</span><strong>{{ summary.total.toFixed(2) }} <small>s</small></strong
            ><span>{{ summary.completed }} 个已完成任务</span>
          </div>
        </div>
        <LoadLineChart
          :points="summary.points"
          :from="from"
          :to="to"
          unit="任务耗时（秒）"
          :phases="view?.data.phases || []"
        />
        <div class="load-counts">
          <span
            >提交 <b>{{ summary.submitted }}</b></span
          ><span
            >完成 <b>{{ summary.completed }}</b></span
          ><span
            >失败 / 超时 / 未确认 <b>{{ summary.failed }}</b></span
          ><span
            >待完成 <b>{{ summary.pending }}</b></span
          >
        </div>
      </div>
      <div class="load-panel">
        <div class="chart-heading">
          <h3>任务执行位置</h3>
          <div class="place-legend">
            <span v-for="place in places" :key="place.key"
              ><i :style="{ background: place.color }"></i>{{ place.label }}</span
            >
          </div>
        </div>
        <div v-for="row in summary.destinations" :key="row.strategy" class="destination-row">
          <span>{{ strategyName(row.strategy) }}</span>
          <div class="destination-bar">
            <template v-if="row.total"
              ><div
                v-for="place in places.filter((p) => row.counts[p.key])"
                :key="place.key"
                :style="{ width: `${(100 * row.counts[place.key]) / row.total}%`, background: place.color }"
                :title="`${place.label}：${row.counts[place.key]} 个 · ${((100 * row.counts[place.key]) / row.total).toFixed(1)}%`"
              >
                {{ ((100 * row.counts[place.key]) / row.total).toFixed(0) }}%
              </div></template
            ><span v-else>暂无数据</span>
          </div>
          <b>{{ row.total }} 个</b>
        </div>
      </div>
    </template>
  </section>
</template>
<style scoped>
.terminal-page {
  min-width: 0;
}
.load-panel {
  background: #fff;
  border: 1px solid var(--border, #e6e0f0);
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 20px;
  min-width: 0;
}
.load-config {
  display: grid;
  grid-template-columns: 2fr 1.5fr 1fr 1fr;
  gap: 20px;
}
.load-config label,
.load-filters label {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.terminal-selection {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 22px;
  margin: 24px 0;
}
.terminal-selection label {
  display: flex;
  align-items: center;
  gap: 8px;
}
.terminal-selection input {
  width: auto;
}
small,
.elapsed-total span,
.load-counts,
.place-legend {
  color: #898298;
}
.load-actions,
.chart-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}
.strategy-toggle {
  display: flex;
  background: #f5f2fa;
  padding: 4px;
  border-radius: 9px;
}
.strategy-toggle button {
  border: 0;
  background: transparent;
}
.strategy-toggle .chosen {
  background: #fff;
  color: #7042ce;
  box-shadow: 0 1px 4px #39235418;
}
.load-filters {
  display: flex;
  gap: 20px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}
.resource-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}
h3 {
  margin: 0 0 8px;
  font-size: 17px;
}
.chart-heading {
  margin-bottom: 14px;
}
.chart-heading > strong {
  font-size: 24px;
  color: #7954d8;
}
.elapsed-total {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}
.elapsed-total strong {
  font-size: 27px;
  color: #7954d8;
  font-weight: 600;
}
.load-counts {
  display: flex;
  gap: 32px;
  flex-wrap: wrap;
  padding-top: 12px;
}
.load-counts b {
  margin-left: 8px;
  color: #30283e;
}
.place-legend {
  display: flex;
  gap: 18px;
  font-size: 13px;
}
.place-legend i {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 3px;
  margin-right: 7px;
}
.destination-row {
  display: grid;
  grid-template-columns: 150px 1fr 65px;
  align-items: center;
  gap: 20px;
  margin-top: 22px;
}
.destination-bar {
  display: flex;
  align-items: stretch;
  height: 35px;
  background: #f3f1f7;
  border-radius: 6px;
  overflow: hidden;
}
.destination-bar > div {
  color: white;
  display: flex;
  justify-content: center;
  align-items: center;
  font-size: 12px;
  min-width: 0;
  overflow: hidden;
}
.destination-bar > span {
  margin: auto;
  font-size: 13px;
  color: #9992a4;
}
@media (max-width: 1000px) {
  .resource-grid {
    grid-template-columns: 1fr;
    gap: 0;
  }
  .load-config {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-width: 650px) {
  .load-config {
    grid-template-columns: 1fr;
  }
  .load-actions,
  .chart-heading {
    align-items: flex-start;
    flex-direction: column;
  }
  .destination-row {
    grid-template-columns: 1fr 55px;
    gap: 10px;
  }
  .destination-row > span {
    grid-column: 1 / -1;
  }
  .load-panel {
    padding: 16px;
  }
}
</style>
