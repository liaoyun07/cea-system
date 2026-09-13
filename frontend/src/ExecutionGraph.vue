<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { errorText } from './api.js';
import { sections } from './no-code/document.js';
import { childGroups, dynamic, iterations, taskInstance, topology } from './execution-graph.js';

const props = defineProps({ api: Function, run: Object, tasks: Array, selectedId: String });
const emit = defineEmits(['select']);
const flow = ref(null),
  error = ref(''),
  loading = ref(false);
const section = ref('tasks'),
  frames = ref([]),
  zoom = ref(1),
  viewport = ref(null);
let alive = true;
async function load() {
  loading.value = true;
  error.value = '';
  try {
    // Execution owns its snapshot even when the editable Flow has been removed.
    const definition = await props.api(`/executions/${encodeURIComponent(props.run.id)}/definition`);
    if (alive) flow.value = definition;
  } catch (e) {
    if (alive) error.value = `无法读取执行修订 r${props.run.flowRevision} 的拓扑：${errorText(e)}`;
  } finally {
    if (alive) loading.value = false;
  }
}
const scope = computed(() => {
  let result = {
    tasks: flow.value?.[section.value] || [],
    mode: 'core.Sequential',
    parentId: null,
    iteration: 0,
  };
  for (const frame of frames.value) {
    const task = result.tasks.find((entry) => entry.id === frame.taskId);
    if (!task) break;
    const instance = taskInstance(props.tasks, task.id, result.parentId, result.iteration);
    const admitted = dynamic(task) && instance ? iterations(props.tasks, instance.id) : [];
    const iteration = admitted.includes(frame.iteration) ? frame.iteration : admitted[0];
    result = {
      tasks: task[frame.group] || [],
      mode: ['core.Dag', 'core.Parallel'].includes(task.type) ? task.type : 'core.Sequential',
      parentId: dynamic(task) ? instance?.id : result.parentId,
      iteration: dynamic(task) ? iteration : result.iteration,
      task,
      instance,
      admitted,
    };
  }
  return result;
});
const diagram = computed(() => {
  try {
    return topology(scope.value.tasks, scope.value.mode);
  } catch (e) {
    return { error: e.message };
  }
});
const itemValue = computed(() =>
  scope.value.task?.type === 'core.Loop'
    ? scope.value.instance?.outputs?._loopValues?.[scope.value.iteration - 1]
    : undefined,
);
function instance(task) {
  return taskInstance(props.tasks, task.id, scope.value.parentId, scope.value.iteration);
}
function reset() {
  frames.value = [];
  emit('select', null);
  zoom.value = 1;
}
function enter(task) {
  const run = instance(task);
  frames.value.push({
    taskId: task.id,
    type: task.type,
    group: childGroups(task)[0],
    iteration: dynamic(task) && run ? iterations(props.tasks, run.id)[0] : undefined,
  });
  emit('select', null);
  zoom.value = 1;
}
function back(index) {
  frames.value = frames.value.slice(0, index);
  emit('select', null);
}
function changeScope() {
  emit('select', null);
}
function fit() {
  if (!viewport.value || !diagram.value.width) return;
  zoom.value = Math.max(0.35, Math.min(1, (viewport.value.clientWidth - 20) / diagram.value.width));
}
onMounted(load);
onBeforeUnmount(() => {
  alive = false;
});
</script>

<template>
  <section class="execution-graph panel" aria-label="执行拓扑">
    <div class="graph-toolbar">
      <select v-model="section" aria-label="执行阶段" @change="reset">
        <option v-for="(label, key) in sections" :key="key" :value="key">{{ label }}</option>
      </select>
      <div class="actions">
        <button aria-label="缩小拓扑" :disabled="zoom <= 0.35" @click="zoom = Math.max(0.35, zoom - 0.15)">
          −
        </button>
        <span>{{ Math.round(zoom * 100) }}%</span>
        <button aria-label="放大拓扑" :disabled="zoom >= 1.75" @click="zoom = Math.min(1.75, zoom + 0.15)">
          ＋
        </button>
        <button :disabled="loading || !!error || !diagram.nodes?.length" @click="fit">适应宽度</button>
      </div>
    </div>
    <nav class="graph-breadcrumbs" aria-label="拓扑层级">
      <button @click="back(0)">{{ sections[section] }}</button>
      <template v-for="(frame, index) in frames" :key="index">
        <span>›</span
        ><button :aria-label="frame.taskId" @click="back(index + 1)">
          {{ frame.taskId
          }}<template v-if="frame.iteration">
            ·
            {{
              frame.type === 'core.Repeat' ? `第 ${frame.iteration} 轮` : `item ${frame.iteration}`
            }}</template
          >
        </button>
      </template>
    </nav>
    <div v-if="frames.length" class="graph-scope">
      <label v-if="scope.task?.type === 'core.If'"
        >分支
        <select v-model="frames[frames.length - 1].group" aria-label="条件分支" @change="changeScope">
          <option v-for="key in childGroups(scope.task)" :key="key" :value="key">
            {{ key === 'then' ? '成立' : '不成立' }}
          </option>
        </select>
      </label>
      <label v-if="scope.task && dynamic(scope.task)"
        >{{ scope.task.type === 'core.Repeat' ? '轮次' : 'item' }}
        <select
          :value="scope.iteration"
          aria-label="迭代实例"
          :disabled="!scope.admitted.length"
          @change="
            frames[frames.length - 1].iteration = Number($event.target.value);
            changeScope();
          "
        >
          <option v-if="!scope.admitted.length" :value="undefined">尚未创建实例</option>
          <option v-for="iteration in scope.admitted" :key="iteration" :value="iteration">
            {{
              scope.task.type === 'core.Repeat'
                ? `第 ${iteration} 轮`
                : `item ${iteration} · index ${iteration - 1}`
            }}
          </option>
        </select>
      </label>
      <pre v-if="itemValue !== undefined" class="graph-item" data-testid="graph-item">{{
        JSON.stringify(itemValue)
      }}</pre>
    </div>
    <div v-if="error" class="notice error" role="alert">{{ error }} <button @click="load">重试</button></div>
    <div v-else-if="loading" class="empty">正在读取拓扑…</div>
    <div v-else-if="diagram.error" class="notice error" role="alert">{{ diagram.error }}</div>
    <p v-else-if="!diagram.nodes.length" class="empty">此组暂无任务</p>
    <div v-else ref="viewport" class="graph-viewport">
      <div :style="{ width: `${diagram.width * zoom}px`, height: `${diagram.height * zoom}px` }">
        <div
          class="graph-canvas"
          :style="{ width: `${diagram.width}px`, height: `${diagram.height}px`, transform: `scale(${zoom})` }"
        >
          <svg :width="diagram.width" :height="diagram.height" class="graph-edges" aria-hidden="true">
            <defs>
              <marker
                id="execution-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
              </marker>
            </defs>
            <path
              v-for="edge in diagram.edges"
              :key="`${edge.from}-${edge.to}`"
              :data-edge="`${edge.from}->${edge.to}`"
              :d="edge.path"
              marker-end="url(#execution-arrow)"
            />
          </svg>
          <article
            v-for="node in diagram.nodes"
            :key="node.task.id"
            class="graph-node"
            :data-task="node.task.id"
            :data-state="instance(node.task)?.state || 'UNCREATED'"
            :class="{ selected: selectedId && instance(node.task)?.id === selectedId }"
            :style="{ left: `${node.x}px`, top: `${node.y}px` }"
          >
            <button
              class="graph-node-main"
              :disabled="!instance(node.task)"
              :aria-label="`查看 ${node.task.id} 实例`"
              @click="emit('select', instance(node.task))"
            >
              <strong>{{ node.task.id }}</strong>
              <small>{{ node.task.type }}</small>
              <span class="status" :data-state="instance(node.task)?.state">{{
                instance(node.task)?.state || '未创建'
              }}</span>
            </button>
            <button
              v-if="childGroups(node.task).length"
              class="graph-expand"
              :aria-label="`展开 ${node.task.id}`"
              @click="enter(node.task)"
            >
              展开 ›
            </button>
          </article>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.execution-graph {
  min-width: 0;
  padding: 18px;
}
.graph-toolbar,
.graph-scope,
.graph-breadcrumbs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}
.graph-toolbar {
  justify-content: space-between;
}
.graph-toolbar select {
  width: auto;
}
.graph-breadcrumbs button {
  padding: 5px 9px;
  font-size: 13px;
}
.graph-scope label {
  display: flex;
  align-items: center;
  gap: 12px;
  white-space: nowrap;
}
.graph-item {
  margin: 0;
  max-height: 100px;
  max-width: 100%;
  overflow: auto;
}
.graph-viewport {
  overflow: auto;
  min-height: 280px;
  max-height: 580px;
  background: radial-gradient(#dcd3ed 1px, transparent 1px) 0 0 / 18px 18px;
  border-radius: 8px;
  border: 1px solid #e7e0f1;
}
.graph-canvas {
  position: relative;
  transform-origin: top left;
}
.graph-edges {
  position: absolute;
  inset: 0;
  color: #aa9ac5;
}
.graph-edges > path {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
}
.graph-node {
  position: absolute;
  width: 230px;
  height: 130px;
  background: var(--panel, #fff);
  border: 1px solid #c8bedc;
  border-left: 4px solid #a99ebc;
  border-radius: 9px;
  overflow: hidden;
}
.graph-node[data-state='SUCCESS'] {
  border-left-color: #29a37a;
}
.graph-node[data-state='FAILED'] {
  border-left-color: #dd5060;
}
.graph-node[data-state='RUNNING'] {
  border-left-color: #7847d4;
}
.graph-node[data-state='KILLED'],
.graph-node[data-state='SKIPPED'] {
  border-left-color: #8a8791;
}
.graph-node.selected {
  outline: 2px solid #8154d7;
  outline-offset: 2px;
}
.graph-node-main {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  width: 100%;
  border: 0;
  border-radius: 0;
  padding: 12px;
  background: transparent;
  text-align: left;
}
.graph-node-main strong,
.graph-node-main small {
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  white-space: nowrap;
}
.graph-node-main small {
  font-size: 11px;
  color: #8b7d9e;
}
.graph-node-main:disabled {
  opacity: 1;
}
.graph-expand {
  position: absolute;
  right: 8px;
  bottom: 8px;
  font-size: 12px;
  padding: 3px 8px;
}
@media (max-width: 700px) {
  .execution-graph {
    padding: 10px;
  }
  .graph-toolbar .actions {
    flex-wrap: wrap;
  }
}
</style>
