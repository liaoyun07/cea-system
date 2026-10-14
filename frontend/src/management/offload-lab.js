export const destinationNames = { TERMINAL: '终端', EDGE: '边缘云', CLOUD: '中心云' };
export const strategyNames = { LOCAL: '全终端执行', RANDOM: '随机卸载' };

export function taskWindow(tasks, from, to) {
  const completed = tasks.filter((t) => t.state === 'SUCCESS' && t.finishedAt >= from && t.finishedAt <= to);
  const points = completed
    .map((t) => ({
      x: t.finishedAt * 1000,
      y: t.finishedAt - t.requestedAt,
      label: `${t.terminal} · ${destinationNames[t.destination]} · ${(t.finishedAt - t.requestedAt).toFixed(2)} s`,
    }))
    .sort((a, b) => a.x - b.x);
  return { points, total: points.reduce((sum, p) => sum + p.y, 0), count: points.length };
}

export function resourceWindow(samples, from, to) {
  const bins = new Map();
  for (const s of samples.filter((s) => s.sampledAt >= from && s.sampledAt <= to)) {
    const key = Math.floor(s.sampledAt / 4) * 4;
    if (!bins.has(key)) bins.set(key, new Map());
    bins.get(key).set(s.terminal, s);
  }
  const result = { cpu: [], memory: [] };
  for (const [key, members] of [...bins.entries()].sort((a, b) => a[0] - b[0])) {
    const items = [...members.values()];
    const cpu = items.filter((s) => s.cpuSeconds != null && s.sampleSeconds > 0);
    result.cpu.push({
      x: key * 1000,
      y: cpu.length
        ? (100 * cpu.reduce((sum, s) => sum + s.cpuSeconds / s.sampleSeconds, 0)) /
          cpu.reduce((sum, s) => sum + s.cpuCores, 0)
        : null,
    });
    result.memory.push({
      x: key * 1000,
      y:
        (100 * items.reduce((sum, s) => sum + s.memoryBytes, 0)) /
        items.reduce((sum, s) => sum + s.memoryLimitBytes, 0),
    });
  }
  for (const points of Object.values(result))
    for (const p of points) {
      p.x = Math.max(p.x, from * 1000);
      if (p.y != null) p.label = `${p.y.toFixed(1)}%`;
    }
  return result;
}
