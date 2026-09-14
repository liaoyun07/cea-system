// Metrics are read from named artifacts, never guessed from logs or recomputed from task durations.
export function metricSources(declarations) {
  return declarations
    .map((entry) => ({
      ...entry,
      ports: entry.ports.filter((port) => port.endsWith('.json') && port !== 'cea-measurement.json'),
    }))
    .filter((entry) => entry.ports.length);
}

export function processingRate(measurement) {
  const value = measurement?.bytesPerSecond;
  if (measurement?.status !== 'AVAILABLE' || !Number.isFinite(value) || value < 0) return '—';
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s'];
  const index = value < 1000 ? 0 : Math.min(units.length - 1, Math.floor(Math.log10(value) / 3));
  return `${(value / 1000 ** index).toFixed(2)} ${units[index]}`;
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

export function chartLine(points, y) {
  let connected = false;
  return points
    .map(({ x, value }) => {
      if (!Number.isFinite(value)) {
        connected = false;
        return '';
      }
      const segment = `${connected ? 'L' : 'M'} ${x} ${y(value)}`;
      connected = true;
      return segment;
    })
    .filter(Boolean)
    .join(' ');
}
