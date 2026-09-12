// A read-only projection of the saved definition. Runtime states belong to TaskRun.
export const dynamic = (task) => ['core.Repeat', 'core.Loop'].includes(task.type);
export const childGroups = (task) =>
  task.type === 'core.If'
    ? ['then', 'else'].filter((key) => task[key]?.length)
    : task.tasks?.length
      ? ['tasks']
      : [];

export function taskInstance(runs, taskId, parentId = null, iteration = 0) {
  return runs.find(
    (run) =>
      run.taskId === taskId && (run.parentTaskRunId ?? null) === parentId && run.iteration === iteration,
  );
}

export function iterations(runs, parentId) {
  return [
    ...new Set(runs.filter((run) => run.parentTaskRunId === parentId).map((run) => run.iteration)),
  ].sort((a, b) => a - b);
}

export function duration(start, end) {
  if (!start || !end) return '—';
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) && ms >= 0 ? `${(ms / 1000).toFixed(2)} s` : '—';
}

export function topology(tasks, mode = 'core.Sequential') {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  if (byId.size !== tasks.length) throw new Error('任务 ID 重复，无法显示拓扑');
  const edges = [];
  tasks.forEach((task, index) => {
    const predecessors =
      mode === 'core.Sequential'
        ? index
          ? [tasks[index - 1].id]
          : []
        : mode === 'core.Dag'
          ? task.dependsOn || []
          : [];
    for (const from of new Set(predecessors)) {
      if (!byId.has(from)) throw new Error(`依赖 ${from} 不在当前任务组内`);
      edges.push({ from, to: task.id });
    }
  });
  const incoming = new Map(tasks.map((task) => [task.id, 0]));
  const successors = new Map(tasks.map((task) => [task.id, []]));
  for (const edge of edges) {
    incoming.set(edge.to, incoming.get(edge.to) + 1);
    successors.get(edge.from).push(edge.to);
  }
  const ranks = new Map(tasks.map((task) => [task.id, 0]));
  const queue = tasks.filter((task) => !incoming.get(task.id)).map((task) => task.id);
  for (let i = 0; i < queue.length; i++) {
    for (const next of successors.get(queue[i])) {
      ranks.set(next, Math.max(ranks.get(next), ranks.get(queue[i]) + 1));
      incoming.set(next, incoming.get(next) - 1);
      if (!incoming.get(next)) queue.push(next);
    }
  }
  if (queue.length !== tasks.length) throw new Error('任务依赖有环，无法显示拓扑');
  const rows = new Map();
  const nodes = tasks.map((task) => {
    const rank = ranks.get(task.id),
      row = rows.get(rank) || 0;
    rows.set(rank, row + 1);
    return { task, x: 24 + rank * 290, y: 24 + row * 162 };
  });
  const positions = new Map(nodes.map((node) => [node.task.id, node]));
  return {
    nodes,
    edges: edges.map((edge) => {
      const from = positions.get(edge.from),
        to = positions.get(edge.to);
      const x1 = from.x + 230,
        y1 = from.y + 62,
        x2 = to.x,
        y2 = to.y + 62;
      return { ...edge, path: `M ${x1} ${y1} C ${x1 + 30} ${y1}, ${x2 - 30} ${y2}, ${x2} ${y2}` };
    }),
    width: Math.max(350, ...nodes.map((node) => node.x + 254)),
    height: Math.max(250, ...nodes.map((node) => node.y + 150)),
  };
}
