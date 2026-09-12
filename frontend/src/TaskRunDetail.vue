<script setup>
import { pretty, time } from './model.js';
import { duration } from './execution-graph.js';
defineProps({ task: Object, attempts: Array, error: String });
</script>

<template>
  <section class="panel attempt-panel" aria-label="任务实例详情">
    <h2>
      {{ task.taskId }} <span class="status" :data-state="task.state">{{ task.state }}</span>
    </h2>
    <dl>
      <dt>实例 ID</dt>
      <dd class="mono">{{ task.id }}</dd>
      <dt>父实例</dt>
      <dd class="mono">{{ task.parentTaskRunId || '—' }}</dd>
      <dt>阶段</dt>
      <dd>{{ task.phase }}</dd>
      <dt>迭代索引</dt>
      <dd>{{ task.iteration }}</dd>
      <dt>开始时间</dt>
      <dd>{{ time(task.startedAt) }}</dd>
      <dt>结束时间</dt>
      <dd>{{ time(task.endedAt) }}</dd>
      <dt>实例耗时</dt>
      <dd data-testid="task-duration">{{ duration(task.startedAt, task.endedAt) }}</dd>
    </dl>
    <pre v-if="task.error" class="notice error">{{ task.error }}</pre>
    <h3>输出</h3>
    <pre class="output-code" data-testid="task-outputs">{{ pretty(task.outputs) }}</pre>
    <h3>执行尝试</h3>
    <div v-if="error" class="notice error" role="alert">{{ error }}</div>
    <p v-if="!attempts.length && !error" class="muted">暂无 Worker 尝试</p>
    <div v-for="attempt in attempts" :key="attempt.attemptNo" class="attempt">
      <strong>#{{ attempt.attemptNo }}</strong>
      <span class="status" :data-state="attempt.state">{{ attempt.state }}</span>
      <span>{{ time(attempt.startedAt) }} → {{ time(attempt.endedAt) }}</span>
      <span>{{ duration(attempt.startedAt, attempt.endedAt) }}</span>
      <pre v-if="attempt.error">{{ attempt.error }}</pre>
    </div>
  </section>
</template>
