export const strategyName = (value) => ({ LOCAL: '全部终端执行', DQN: 'DQN 智能卸载' })[value] || value;
export const places = [
  { key: 'TERMINAL', label: '终端', color: '#8b91a5' },
  { key: 'EDGE', label: '边缘云', color: '#7954d8' },
  { key: 'CLOUD', label: '中心云', color: '#358bc6' },
];
export const stamp = (value) => (value ? Date.parse(value) : NaN);
export function usage(resource) {
  if (!resource) return { cpu: null, memory: null };
  return {
    cpu:
      resource.cpuSeconds == null
        ? null
        : (100 * resource.cpuSeconds) / resource.sampleSeconds / resource.cpuCores,
    memory: (100 * resource.memoryBytes) / resource.memoryLimitBytes,
  };
}
export function summarize(view, selected, from, to) {
  const data = view?.data;
  if (!data)
    return { points: [], total: 0, completed: 0, failed: 0, pending: 0, submitted: 0, destinations: [] };
  const members = new Set(selected);
  const rows = data.requests.filter((r) => members.has(r.terminalId));
  const within = (t) => stamp(t) >= from && stamp(t) <= to;
  const completed = rows.filter((r) => r.outcome === 'SUCCESS' && within(r.finishedAt));
  const phases = new Map(data.phases.map((p) => [p.number, p.strategy]));
  const requests = new Map(rows.filter((r) => r.executionId).map((r) => [r.executionId, r]));
  const destinations = ['LOCAL', 'DQN'].map((strategy) => {
    const counts = Object.fromEntries(places.map((p) => [p.key, 0]));
    const seen = new Set();
    for (const target of view.targets || []) {
      const row = requests.get(target.executionId);
      if (
        !row ||
        seen.has(target.executionId) ||
        phases.get(row.phase) !== strategy ||
        !within(target.startedAt)
      )
        continue;
      if (Object.hasOwn(counts, target.target.kind)) {
        counts[target.target.kind]++;
        seen.add(target.executionId);
      }
    }
    return { strategy, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
  });
  return {
    points: completed
      .map((r) => ({
        x: stamp(r.finishedAt),
        y: r.elapsedSeconds,
        label: `${r.terminalId} · ${r.elapsedSeconds.toFixed(3)} s`,
      }))
      .sort((a, b) => a.x - b.x),
    total: completed.reduce((sum, r) => sum + r.elapsedSeconds, 0),
    completed: completed.length,
    failed: rows.filter((r) => r.outcome && r.outcome !== 'SUCCESS' && within(r.finishedAt)).length,
    pending: rows.filter((r) => !r.finishedAt && stamp(r.acceptedAt) <= to).length,
    submitted: rows.filter((r) => within(r.acceptedAt)).length,
    destinations,
  };
}
export function resourceSeries(samples, selected, from, to) {
  const members = new Set(selected),
    current = new Map(),
    cpu = [],
    memory = [];
  for (const sample of samples) {
    if (!members.has(sample.terminalId)) continue;
    const t = stamp(sample.sampledAt);
    if (t < from || t > to) continue;
    current.set(sample.terminalId, sample);
    const values = [...current.values()].filter((s) => t - stamp(s.sampledAt) <= 5000);
    if (values.length !== members.size) {
      cpu.push({ x: t, y: null });
      memory.push({ x: t, y: null });
      continue;
    }
    const cores = values.reduce((sum, s) => sum + s.resource.cpuCores, 0);
    const capacity = values.reduce((sum, s) => sum + s.resource.memoryLimitBytes, 0);
    cpu.push({
      x: t,
      y: values.some((s) => s.resource.cpuSeconds == null)
        ? null
        : (100 * values.reduce((sum, s) => sum + s.resource.cpuSeconds / s.resource.sampleSeconds, 0)) /
          cores,
    });
    memory.push({ x: t, y: (100 * values.reduce((sum, s) => sum + s.resource.memoryBytes, 0)) / capacity });
  }
  return { cpu, memory };
}
