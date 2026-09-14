<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { errorText } from './api.js';
import { mergeLogs, pretty, tasksByStartTime, terminal, time } from './model.js';
import { duration } from './execution-graph.js';
import ExecutionGraph from './ExecutionGraph.vue';
import TaskRunDetail from './TaskRunDetail.vue';
import ExecutionMetrics from './ExecutionMetrics.vue';
import ExecutionArtifacts from './ExecutionArtifacts.vue';
import { processingRate } from './execution-metrics.js';

const props = defineProps({ api: Function, executionId: String });
const run = ref(null),
  tasks = ref([]),
  logs = ref([]),
  attempts = ref([]),
  selectedTaskId = ref(null);
const measurement = ref(null);
const selectedTask = computed(() => tasks.value.find((task) => task.id === selectedTaskId.value));
const sortedTasks = computed(() => tasksByStartTime(tasks.value));
const tab = ref('overview'),
  loading = ref(false),
  cancelling = ref(false),
  error = ref(''),
  attemptError = ref(''),
  refreshed = ref(null);
const moreLogs = ref(false),
  totalLogs = ref(0);
let alive = true,
  timer,
  cursor = 0,
  attemptGeneration = 0;
const base = `/executions/${encodeURIComponent(props.executionId)}`;
const afterTasks = computed(() => tasks.value.filter((t) => t.phase === 'AFTER_EXECUTION'));
const afterPending = computed(() => afterTasks.value.some((t) => !terminal(t.state)));
const done = computed(
  () => run.value && terminal(run.value.state) && tasks.value.every((t) => terminal(t.state)),
);
const elapsed = computed(() =>
  run.value?.startedAt && run.value?.endedAt
    ? `${((new Date(run.value.endedAt) - new Date(run.value.startedAt)) / 1000).toFixed(2)} s`
    : '—',
);

async function loadAttempts(task) {
  selectedTaskId.value = task?.id || null;
  attempts.value = [];
  attemptError.value = '';
  const generation = ++attemptGeneration;
  if (!task) return;
  try {
    const result = await props.api(`${base}/tasks/${encodeURIComponent(task.id)}/attempts`);
    if (alive && generation === attemptGeneration) attempts.value = result;
  } catch (e) {
    if (alive && generation === attemptGeneration) attemptError.value = errorText(e);
  }
}
async function refresh() {
  if (!alive || loading.value) return;
  clearTimeout(timer);
  loading.value = true;
  error.value = '';
  let ok = false;
  try {
    const [value, rows] = await Promise.all([props.api(base), props.api(`${base}/tasks`)]);
    if (!alive) return;
    // Read logs after task states: a terminal snapshot must not stop before its final log is visible.
    const entries = await props.api(`${base}/logs?afterId=${cursor}&limit=100`);
    if (!alive) return;
    run.value = value;
    tasks.value = rows;
    if (!measurement.value && value.state === 'SUCCESS' && rows.every((task) => terminal(task.state))) {
      try {
        const result = await props.api(`${base}/measurement`);
        if (alive) measurement.value = result;
      } catch {
        if (alive) measurement.value = null;
      }
    }
    logs.value = mergeLogs(logs.value, entries);
    totalLogs.value += entries.length;
    if (entries.length) cursor = entries.at(-1).id;
    moreLogs.value = entries.length === 100;
    refreshed.value = new Date().toISOString();
    if (selectedTask.value) await loadAttempts(selectedTask.value);
    ok = true;
  } catch (e) {
    if (alive) error.value = errorText(e);
  } finally {
    if (alive) {
      loading.value = false;
      // Stop on errors; no hidden retry storm. Drain final log pages before stopping.
      if (ok && (!done.value || moreLogs.value)) timer = setTimeout(refresh, moreLogs.value ? 200 : 2000);
    }
  }
}
async function cancel() {
  if (cancelling.value || !window.confirm('确认请求取消此执行？任务停止和 Finally 清理可能需要时间。'))
    return;
  cancelling.value = true;
  error.value = '';
  try {
    await props.api(`${base}/cancel`, { method: 'POST' });
    if (alive) await refresh();
  } catch (e) {
    if (alive) error.value = errorText(e);
  } finally {
    if (alive) cancelling.value = false;
  }
}
onMounted(refresh);
onBeforeUnmount(() => {
  alive = false;
  clearTimeout(timer);
});
</script>

<template>
  <section class="execution-page">
    <div class="page-heading">
      <div>
        <span class="eyebrow">EXECUTION</span>
        <h1>
          {{ run?.flowId || '执行详情' }}
          <span v-if="run" class="status" :data-state="run.state">{{ run.state }}</span>
        </h1>
        <p class="mono muted execution-id">{{ executionId }}</p>
      </div>
      <div class="actions">
        <button
          :disabled="loading"
          @click="
            measurement = null;
            refresh();
          "
        >
          {{ loading ? '刷新中…' : '↻ 刷新' }}</button
        ><button v-if="run && !terminal(run.state)" class="danger" :disabled="cancelling" @click="cancel">
          {{ cancelling ? '正在请求…' : '取消执行' }}
        </button>
      </div>
    </div>
    <div v-if="error" class="notice error" role="alert">{{ error }} 自动刷新已暂停，可手动重试。</div>
    <div v-if="run?.error" class="notice error" role="alert"><strong>主执行错误</strong> {{ run.error }}</div>
    <div v-if="run?.cleanupError" class="notice error" role="alert">
      <strong>清理错误</strong> {{ run.cleanupError }}
    </div>
    <div v-if="run?.slaViolatedAt" class="notice warning">
      SLA 超限：{{ time(run.slaViolatedAt) }}（不自动取消执行）
    </div>
    <div v-if="run && terminal(run.state) && afterPending" class="notice info">
      主执行已结束，后处理仍在运行。这里会继续刷新后处理状态。
    </div>
    <div class="tabs" role="tablist" aria-label="执行视图">
      <button
        v-for="entry in [
          ['overview', '概览'],
          ['graph', '拓扑'],
          ['tasks', '任务实例'],
          ['logs', '日志'],
          ['metrics', 'Metrics'],
          ['outputs', '输出'],
        ]"
        :key="entry[0]"
        role="tab"
        :aria-selected="tab === entry[0]"
        :class="{ active: tab === entry[0] }"
        @click="tab = entry[0]"
      >
        {{ entry[1] }}<span v-if="entry[0] === 'tasks'" class="tab-count">{{ tasks.length }}</span>
      </button>
    </div>
    <template v-if="run">
      <div v-if="tab === 'overview'" class="overview-grid">
        <section class="panel">
          <h2>执行信息</h2>
          <dl>
            <dt>命名空间</dt>
            <dd>{{ run.namespace }}</dd>
            <dt>流程修订</dt>
            <dd>r{{ run.flowRevision }}</dd>
            <dt>提交者</dt>
            <dd>{{ run.submittedBy }}</dd>
            <dt>创建时间</dt>
            <dd>{{ time(run.createdAt) }}</dd>
            <dt>开始时间</dt>
            <dd>{{ time(run.startedAt) }}</dd>
            <dt>结束时间</dt>
            <dd>{{ time(run.endedAt) }}</dd>
            <dt>主执行耗时</dt>
            <dd>{{ elapsed }}</dd>
            <dt>数据处理速率</dt>
            <dd data-testid="processing-rate">{{ processingRate(measurement) }}</dd>
          </dl>
        </section>
        <section class="panel">
          <h2>本次输入</h2>
          <pre>{{ pretty(run.inputs) }}</pre>
          <h2>解析后的变量</h2>
          <pre>{{ pretty(run.variables) }}</pre>
        </section>
        <section class="panel full-panel" v-if="afterTasks.length">
          <h2>后处理 <span class="tag">AFTER_EXECUTION</span></h2>
          <div class="after-list">
            <div v-for="task in afterTasks" :key="task.id">
              <span class="mono">{{ task.taskId }}</span
              ><span class="status" :data-state="task.state">{{ task.state }}</span
              ><span v-if="task.error" class="error-text">{{ task.error }}</span>
            </div>
          </div>
        </section>
      </div>
      <div
        v-else-if="tab === 'graph'"
        class="execution-inspection"
        :class="{ 'has-selection': selectedTask }"
      >
        <ExecutionGraph
          :api="api"
          :run="run"
          :tasks="tasks"
          :selected-id="selectedTaskId"
          @select="loadAttempts"
        />
        <TaskRunDetail v-if="selectedTask" :task="selectedTask" :attempts="attempts" :error="attemptError" />
      </div>
      <div v-else-if="tab === 'tasks'">
        <div class="table-wrap">
          <table aria-label="任务实例列表">
            <thead>
              <tr>
                <th>任务 / 实例 ID</th>
                <th>阶段</th>
                <th>迭代索引</th>
                <th>父实例</th>
                <th>状态</th>
                <th aria-sort="ascending">开始时间</th>
                <th>结束时间</th>
                <th>实例耗时</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="task in sortedTasks" :key="task.id">
                <td>
                  <strong>{{ task.taskId }}</strong
                  ><small class="mono block">{{ task.id }}</small>
                </td>
                <td>{{ task.phase }}</td>
                <td>{{ task.iteration }}</td>
                <td>
                  <span class="mono small">{{ task.parentTaskRunId || '—' }}</span>
                </td>
                <td>
                  <span class="status" :data-state="task.state">{{ task.state }}</span>
                </td>
                <td>{{ time(task.startedAt) }}</td>
                <td>{{ time(task.endedAt) }}</td>
                <td>{{ duration(task.startedAt, task.endedAt) }}</td>
                <td><button @click="loadAttempts(task)">尝试详情</button></td>
              </tr>
            </tbody>
          </table>
          <p v-if="!tasks.length" class="empty">暂无任务实例</p>
        </div>
        <TaskRunDetail v-if="selectedTask" :task="selectedTask" :attempts="attempts" :error="attemptError" />
      </div>
      <section v-else-if="tab === 'logs'" class="log-panel">
        <header>
          <strong>执行日志</strong><span>已读取 {{ totalLogs }} 条 · 最多显示最近 1,000 条</span>
        </header>
        <div class="log-lines" aria-label="执行日志">
          <div v-for="entry in logs" :key="entry.id" class="log-entry">
            <time>{{ time(entry.at) }}</time
            ><span :class="['log-level', entry.level]">{{ entry.level }}</span
            ><span class="log-context">{{ entry.taskRunId }} / #{{ entry.attemptNo }}</span>
            <pre>{{ entry.message }}</pre>
          </div>
          <p v-if="!logs.length" class="muted">暂无日志</p>
        </div>
      </section>
      <ExecutionMetrics v-else-if="tab === 'metrics'" :api="api" :run="run" :tasks="tasks" />
      <div v-else>
        <section class="panel">
          <h2>主执行输出</h2>
          <pre class="output-code" data-testid="execution-outputs">{{ pretty(run.outputs) }}</pre>
        </section>
        <ExecutionArtifacts :api="api" :run="run" :tasks="tasks" />
      </div>
    </template>
    <div v-else-if="loading" class="empty">正在读取执行…</div>
    <footer class="refresh-note">
      {{ refreshed ? `最近更新 ${time(refreshed)}` : '尚未读取' }} ·
      {{ error ? '刷新已暂停' : done && !moreLogs ? '执行和后处理均已结束' : '每 2 秒刷新' }}
    </footer>
  </section>
</template>

<style scoped>
.execution-inspection {
  display: grid;
  gap: 16px;
  min-width: 0;
}
.execution-inspection.has-selection {
  grid-template-columns: minmax(0, 1fr) minmax(310px, 370px);
}
.execution-inspection :deep(.attempt-panel) {
  margin-top: 0;
  min-width: 0;
  max-height: 780px;
  overflow: auto;
}
.execution-inspection :deep(dd) {
  overflow-wrap: anywhere;
}
@media (max-width: 1100px) {
  .execution-inspection.has-selection {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
