// Offline accounting only: measurements come from persisted Job container summaries.
const GiB = 2 ** 30;
const roles = ['init', 'train', 'aggregate', 'evaluate'];
const containerNames = ['files-in', 'task', 'files-out'];
const finiteNonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function position(task, byId) {
  if (task.taskId === 'init') return {round: 0, cluster: 'cloud'};
  const parent = byId.get(task.parentTaskRunId);
  if (task.taskId === 'train') {
    if (parent?.taskId !== 'clients' || byId.get(parent.parentTaskRunId)?.taskId !== 'rounds') return null;
    const cluster = ['edge-a', 'edge-b', 'edge-c'][task.iteration - 1];
    return cluster && Number.isInteger(parent.iteration) && parent.iteration > 0 ? {round: parent.iteration, cluster} : null;
  }
  return parent?.taskId === 'rounds' && Number.isInteger(task.iteration) && task.iteration > 0
    ? {round: task.iteration, cluster: 'cloud'} : null;
}

function complete(container) {
  return container?.status === 'COMPLETE' && finiteNonnegative(container.cpuCoreSeconds)
    && finiteNonnegative(container.memoryByteSeconds) && finiteNonnegative(container.durationSeconds)
    && container.durationSeconds > 0 && finiteNonnegative(container.peakMemoryBytes)
    && Number.isInteger(container.samples) && container.samples >= 2;
}

function totals(containers, durationSeconds, valid = true) {
  const measured = containers.filter(complete);
  const full = valid && measured.length === containers.length;
  const cpu = measured.length ? measured.reduce((sum, c) => sum + c.cpuCoreSeconds, 0) : null;
  const memory = measured.length ? measured.reduce((sum, c) => sum + c.memoryByteSeconds / GiB, 0) : null;
  return {containers: containers.length, completeContainers: measured.length,
    cpuCoreSeconds: full ? cpu : null, memoryGiBSeconds: full ? memory : null,
    averageMemoryGiB: full && memory !== null && durationSeconds > 0 ? memory / durationSeconds : null,
    observedCpuCoreSeconds: cpu, observedMemoryGiBSeconds: memory};
}

function windowUsage(result, lastRound, endedAt, evaluationIssues, fullRun = false) {
  const byId = new Map(result.tasks.map(task => [task.id, task]));
  const mapped = result.tasks.filter(task => roles.includes(task.taskId)).map(task => ({task, ...position(task, byId)}));
  const issues = [...evaluationIssues];
  for (const item of mapped) if (item.round === undefined) issues.push(`Unresolved round: ${item.task.id}`);
  const selected = mapped.filter(item => item.round >= 0 && item.round <= lastRound);
  const selectedIds = new Set(selected.map(item => item.task.id));
  const jobs = (result.usage.jobs ?? []).filter(job => selectedIds.has(job.taskRunId));
  const successful = selected.filter(item => item.task.state === 'SUCCESS');
  const expectedSuccessfulJobs = 1 + 5 * lastRound;
  if (successful.length !== expectedSuccessfulJobs) issues.push(`Expected ${expectedSuccessfulJobs} successful Job tasks, found ${successful.length}`);
  for (let round = 0; round <= lastRound; round++) {
    for (const role of round === 0 ? ['init'] : ['train', 'aggregate', 'evaluate']) {
      const tasks = selected.filter(item => item.round === round && item.task.taskId === role);
      const expected = role === 'train' ? 3 : 1;
      if (tasks.length !== expected || tasks.some(item => item.task.state !== 'SUCCESS')) issues.push(`Round ${round} ${role}: expected ${expected} successful tasks`);
      if (role === 'train' && new Set(tasks.map(item => item.cluster)).size !== 3) issues.push(`Round ${round}: missing or duplicate client`);
    }
  }
  const attemptKeys = new Set();
  for (const job of jobs) {
    const key = `${job.taskRunId}:${job.attemptNo}`;
    if (attemptKeys.has(key)) issues.push(`Duplicate Attempt: ${key}`);
    attemptKeys.add(key);
    if (!['SUCCESS', 'FAILED', 'KILLED'].includes(job.state)) issues.push(`Nonterminal Attempt: ${key}`);
  }
  for (const {task} of selected) {
    if (jobs.filter(job => job.taskRunId === task.id && job.state === 'SUCCESS').length !== 1) issues.push(`Missing or duplicate successful Attempt: ${task.id}`);
  }
  const containers = [], byRole = {}, byCluster = {};
  let completeJobs = 0;
  for (const job of jobs) {
    const item = selected.find(item => item.task.id === job.taskRunId);
    const reports = job.usage?.containers ?? [];
    const valid = reports.length === 3 && containerNames.every(name => reports.filter(c => c.name === name).length === 1);
    const list = containerNames.map(name => reports.find(c => c.name === name) ?? {name, status: 'MISSING'});
    if (valid && list.every(complete)) completeJobs++;
    else issues.push(`Incomplete containers: ${job.taskRunId}:${job.attemptNo}`);
    containers.push(...list);
    (byRole[item.task.taskId] ??= []).push(...list);
    (byCluster[item.cluster] ??= []).push(...list);
  }
  const durationSeconds = (Date.parse(endedAt) - Date.parse(result.execution.startedAt)) / 1000;
  if (!(durationSeconds > 0)) issues.push('Missing or invalid wall-clock window');
  if (fullRun && (result.execution.state !== 'SUCCESS' || result.usage.status !== 'COMPLETE')) issues.push('Full execution or resource report is not complete');
  const valid = issues.length === 0;
  return {status: valid ? 'COMPLETE' : 'INCOMPLETE', throughRound: lastRound, endedAt,
    expectedSuccessfulJobs, successfulJobs: successful.length, attempts: jobs.length, completeJobs,
    durationSeconds: durationSeconds > 0 ? durationSeconds : null,
    ...totals(containers, durationSeconds, valid),
    taskOnly: totals(containers.filter(c => c.name === 'task'), durationSeconds, valid),
    helpers: totals(containers.filter(c => c.name !== 'task'), durationSeconds, valid),
    byRole: Object.fromEntries(Object.entries(byRole).map(([key, value]) => [key, totals(value, durationSeconds, valid)])),
    byCluster: Object.fromEntries(Object.entries(byCluster).map(([key, value]) => [key, totals(value, durationSeconds, valid)])),
    issues};
}

export function summarize(result, target = .95) {
  const rounds = result.execution.inputs?.rounds ?? 40;
  const evaluations = [...result.evaluations].sort((a, b) => a.round - b.round);
  const byId = new Map(result.tasks.map(task => [task.id, task]));
  const evaluationIssues = lastRound => {
    const issues = [];
    for (let round = 1; round <= lastRound; round++) {
      const matches = evaluations.filter(e => e.round === round), e = matches[0], task = byId.get(e?.taskRunId);
      if (matches.length !== 1 || !e || e.samples !== 10000 || !finiteNonnegative(e.accuracy) || e.accuracy > 1
        || task?.taskId !== 'evaluate' || task.state !== 'SUCCESS' || task.iteration !== round || e.endedAt !== task.endedAt) {
        issues.push(`Invalid or missing evaluation: round ${round}`);
      }
    }
    return issues;
  };
  const hit = evaluations.find(e => e.accuracy >= target && e.round >= 1 && e.round <= rounds);
  const fullIssues = evaluationIssues(rounds);
  const toTarget = hit ? windowUsage(result, hit.round, hit.endedAt, evaluationIssues(hit.round)) : null;
  return {algorithm: result.algorithm, targetAccuracy: target,
    status: hit ? toTarget.status : 'NOT_REACHED',
    firstHitRound: hit?.round ?? null, firstHitAccuracy: hit?.accuracy ?? null,
    evaluatedRounds: evaluations.length, configuredRounds: rounds,
    allSubsequentAbove95: hit && fullIssues.length === 0 ? evaluations.filter(e => e.round >= hit.round).every(e => e.accuracy >= target) : null,
    toTarget, fullRun: windowUsage(result, rounds, result.execution.endedAt, fullIssues, true), evaluations};
}

export function compare(baseline, candidate) {
  const comparable = baseline.status === 'COMPLETE' && candidate.status === 'COMPLETE';
  return {status: comparable ? 'COMPLETE' : 'NOT_COMPARABLE', baseline: baseline.algorithm, candidate: candidate.algorithm,
    reductionPercent: Object.fromEntries(['cpuCoreSeconds', 'memoryGiBSeconds', 'averageMemoryGiB', 'durationSeconds'].map(key => {
      const a = baseline.toTarget?.[key], b = candidate.toTarget?.[key];
      return [key, comparable && a > 0 && finiteNonnegative(b) ? 100 * (1 - b / a) : null];
    }))};
}
