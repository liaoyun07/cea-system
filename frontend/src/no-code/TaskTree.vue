<script setup>
import { ref } from 'vue';
import { pathKey, taskLabels } from './document.js';
defineProps({ tasks: Array, path: Array, selected: Array, label: String, disabled: Boolean });
const emit = defineEmits(['select', 'add', 'move', 'remove']);
const collapsed = ref(new Set());
function toggle(id) {
  const next = new Set(collapsed.value);
  next.has(id) ? next.delete(id) : next.add(id);
  collapsed.value = next;
}
</script>
<template>
  <section class="task-group">
    <header class="group-heading">
      <span
        >{{ label }} <small>{{ tasks?.length || 0 }}</small></span
      ><button :disabled="disabled" :aria-label="`添加到 ${label}`" @click="emit('add', path)">
        ＋ 添加任务
      </button>
    </header>
    <p v-if="!tasks?.length" class="group-empty">此组暂无任务</p>
    <article
      v-for="(task, i) in tasks || []"
      :key="pathKey([...path, i])"
      class="task-card"
      :class="{ selected: pathKey(selected) === pathKey([...path, i]) }"
      :data-task="task.id"
    >
      <div class="task-card-header">
        <button
          v-if="task.tasks || task.then || task.else"
          class="collapse-task"
          :aria-label="`折叠或展开 ${task.id}`"
          @click="toggle(task.id)"
        >
          {{ collapsed.has(task.id) ? '▸' : '▾' }}
        </button>
        <button class="task-select" :disabled="disabled" @click="emit('select', [...path, i])">
          <span class="task-symbol">{{
            task.type === 'platform.Application'
              ? '▣'
              : task.type === 'core.Loop' || task.type === 'core.Repeat'
                ? '↻'
                : '◇'
          }}</span
          ><span
            ><strong>{{ task.id || '未命名任务' }}</strong
            ><small>{{ taskLabels[task.type] || task.type }} · {{ task.type }}</small></span
          >
        </button>
        <div class="task-tools">
          <button
            :disabled="disabled || i === 0"
            :aria-label="`上移 ${task.id}`"
            @click="emit('move', { path: [...path, i], target: path, index: i - 1 })"
          >
            ↑</button
          ><button
            :disabled="disabled || i === tasks.length - 1"
            :aria-label="`下移 ${task.id}`"
            @click="emit('move', { path: [...path, i], target: path, index: i + 1 })"
          >
            ↓</button
          ><button
            :disabled="disabled"
            :aria-label="`删除任务 ${task.id}`"
            @click="emit('remove', [...path, i])"
          >
            ×
          </button>
        </div>
      </div>
      <div v-if="task.dependsOn?.length" class="dependency-line">依赖：{{ task.dependsOn.join(' → ') }}</div>
      <div v-if="!collapsed.has(task.id)" class="child-groups">
        <TaskTree
          v-for="field in task.type === 'core.If' ? ['then', 'else'] : task.tasks ? ['tasks'] : []"
          :key="field"
          :tasks="task[field]"
          :path="[...path, i, field]"
          :selected="selected"
          :label="`${task.id} / ${field === 'then' ? '满足条件' : field === 'else' ? '不满足条件' : '内部任务'}`"
          :disabled="disabled"
          @select="emit('select', $event)"
          @add="emit('add', $event)"
          @move="emit('move', $event)"
          @remove="emit('remove', $event)"
        />
      </div>
    </article>
  </section>
</template>
