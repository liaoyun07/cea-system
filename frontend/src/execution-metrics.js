// Metrics are read from named artifacts, never guessed from logs or recomputed from task durations.
export function metricSources(flow) {
  const result = [];
  function visit(tasks = []) {
    for (const task of tasks) {
      const ports = (task.container?.outputFiles || []).filter((port) => port.endsWith('.json'));
      if (ports.length) result.push({ id: task.id, ports });
      visit(task.tasks);
      visit(task.then);
      visit(task.else);
    }
  }
  for (const group of ['tasks', 'errors', 'finally', 'afterExecution']) visit(flow?.[group]);
  return result;
}

export function instanceLabel(task, tasks) {
  const byId = new Map(tasks.map((entry) => [entry.id, entry]));
  const segments = [task.taskId],
    seen = new Set([task.id]);
  let child = task;
  while (child.parentTaskRunId) {
    const parent = byId.get(child.parentTaskRunId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    segments.unshift(`${parent.taskId}[${child.iteration}]`);
    child = parent;
  }
  return segments.join(' / ');
}

export function numericMetrics(object) {
  if (!object || Array.isArray(object) || typeof object !== 'object')
    throw new Error('指标文件不是 JSON 对象');
  const values = Object.entries(object).filter(([, value]) => typeof value === 'number');
  if (values.some(([, value]) => !Number.isFinite(value))) throw new Error('指标包含非有限数值');
  return new Map(values);
}

export function metricTags(object) {
  return Object.entries(object || {}).filter(
    ([, value]) => typeof value === 'string' || typeof value === 'boolean',
  );
}

export function chartScale(values) {
  const valid = values.filter(Number.isFinite);
  const min = Math.min(0, ...valid),
    max = Math.max(0, ...valid);
  // Normalize before subtraction to avoid overflow for very large opposite-signed values.
  const magnitude = Math.max(Math.abs(min), Math.abs(max)) || 1;
  const low = min / magnitude,
    high = max / magnitude || (min === 0 ? 1 : 0);
  const y = (value) => 220 - ((value / magnitude - low) / (high - low)) * 180;
  return { min, max: max || (min === 0 ? 1 : 0), y };
}
