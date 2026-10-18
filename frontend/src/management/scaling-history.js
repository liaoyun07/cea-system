export function scalingSummary(events) {
  const ups = events.filter((e) => e.toReplicas > e.fromReplicas);
  const done = ups.filter((e) => e.state === 'SUCCEEDED' && e.durationMs != null);
  return {
    total: ups.length,
    completed: done.length,
    mean: done.length ? done.reduce((sum, e) => sum + e.durationMs, 0) / done.length : null,
  };
}
export function replicaChart(samples) {
  if (!samples.length) return { paths: [], ticks: [], labels: [] };
  const start = Date.parse(samples[0].at),
    end = Math.max(start + 1000, Date.parse(samples.at(-1).at));
  const max = Math.max(1, ...samples.flatMap((s) => [s.desired, s.ready, s.standby]));
  const x = (at) => 42 + ((Date.parse(at) - start) / (end - start)) * 894;
  const y = (n) => 170 - (n / max) * 145;
  const paths = ['desired', 'ready', 'standby'].map((key) =>
    samples
      .map((s, i) => `${i ? 'H' : 'M'}${x(s.at).toFixed(2)}${i ? 'V' : ','}${y(s[key]).toFixed(2)}`)
      .join(' '),
  );
  return {
    paths,
    ticks: [...new Set([0, Math.round(max / 2), max])].map((value) => ({ value, y: y(value) })),
    labels: [start, (start + end) / 2, end].map((at, i) => ({
      x: 42 + 447 * i,
      label: new Date(at).toLocaleTimeString('zh-CN', { hour12: false }),
    })),
  };
}
