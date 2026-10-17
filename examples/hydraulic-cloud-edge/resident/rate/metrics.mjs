// Pure accounting shared by k6 and Node tests. Signal bytes are counted once;
// NPZ/HTTP wire bytes and forwarded intermediate features are not added to them.
export function buildRatePlan(manifest, rate, duration) {
  const match = /^(\d+)s$/.exec(duration);
  if (!match || Number(match[1]) <= 0 || !Number.isInteger(rate) || rate <= 0 || !manifest.length)
    throw Error('Positive integer RATE and DURATION in seconds are required');
  const durationSeconds = Number(match[1]);
  const cycleSignalBytes = manifest.reduce((sum, item) => sum + item.expected.inputBytes, 0);
  const plannedBatches = rate * durationSeconds;
  const plannedSignalBytes = Math.floor(plannedBatches / manifest.length) * cycleSignalBytes +
    manifest.slice(0, plannedBatches % manifest.length).reduce((sum, item) => sum + item.expected.inputBytes, 0);
  return {rate, duration, durationSeconds, plannedBatches, plannedSignalBytes,
    meanBatchSignalBytes: cycleSignalBytes / manifest.length,
    targetGBps: rate * cycleSignalBytes / manifest.length / 1e9,
    plannedGBps: plannedSignalBytes / durationSeconds / 1e9};
}

// k6 1.3 uses an integer-nanosecond arrival interval and starts at t=0.
// For 273/s this is 3,663,003 ns, allowing one extra slot just before the
// window boundary. It does not justify arbitrary oversending or missing slots.
export function arrivalBoundaryAllowance(plan) {
  const intervalNs = Math.floor(1e9 / plan.rate);
  if (!(intervalNs > 0)) return 0;
  const extra = Math.ceil(plan.durationSeconds * 1e9 / intervalNs) - plan.plannedBatches;
  return extra === 1 ? 1 : 0;
}

export function summarizeRate(data, plan, context) {
  const metrics = data.metrics || {};
  const count = name => metrics[name]?.values?.count || 0;
  const value = (name, stat) => metrics[name]?.values?.[stat];
  const firstSendMs = value('batch_started_epoch_ms', 'min');
  const lastSendMs = value('batch_started_epoch_ms', 'max');
  const lastFinishedMs = value('batch_finished_epoch_ms', 'max');
  const scenarioStartMs = value('scenario_started_epoch_ms', 'min');
  const lastAttemptFinishedMs = value('attempt_finished_epoch_ms', 'max');
  const seconds = Number.isFinite(firstSendMs) && Number.isFinite(lastFinishedMs) ?
    (lastFinishedMs - firstSendMs) / 1000 : null;
  const scenarioEndMs = Number.isFinite(scenarioStartMs) ? scenarioStartMs + plan.durationSeconds * 1000 : null;
  const report = {...context, ...plan, seconds,
    signalBytes: count('completed_signal_bytes'), batches: count('completed_batches'),
    started: count('started_batches'), failed: count('failed_batches'),
    uploadStarted: count('upload_started_batches'), initiatedSignalBytes: count('initiated_signal_bytes'),
    initiatedWithinWindowBytes: count('initiated_within_window_bytes'),
    droppedIterations: count('dropped_iterations'), lateUploadStarts: count('late_upload_starts'),
    completedWithinWindowBytes: count('completed_within_window_bytes'),
    firstSendMs: firstSendMs ?? null, lastSendMs: lastSendMs ?? null,
    lastFinishedMs: lastFinishedMs ?? null, scenarioStartMs: scenarioStartMs ?? null, scenarioEndMs,
    drainSeconds: Number.isFinite(lastAttemptFinishedMs) && scenarioEndMs !== null ?
      Math.max(0, lastAttemptFinishedMs - scenarioEndMs) / 1000 : null,
    batchLatencyMs: metrics.batch_latency_ms?.values || null,
    httpFailed: metrics.http_req_failed?.values || null,
    receivedBytes: count('data_received'), sentBytes: count('data_sent')};
  report.GBps = seconds > 0 ? report.signalBytes / seconds / 1e9 : null;
  report.initiatedWithinWindowGBps = report.initiatedWithinWindowBytes / plan.durationSeconds / 1e9;
  report.completedWithinWindowGBps = report.completedWithinWindowBytes / plan.durationSeconds / 1e9;
  report.completionFractionOfPlan = report.batches / plan.plannedBatches;
  report.observedArrivalSlots = report.started + report.droppedIterations;
  report.arrivalBoundaryDelta = report.observedArrivalSlots - plan.plannedBatches;
  report.offeredLoadAchieved = report.droppedIterations === 0 && report.lateUploadStarts === 0 &&
    report.arrivalBoundaryDelta >= 0 && report.arrivalBoundaryDelta <= arrivalBoundaryAllowance(plan) &&
    report.uploadStarted === report.started && report.initiatedSignalBytes >= plan.plannedSignalBytes &&
    report.initiatedWithinWindowBytes >= plan.plannedSignalBytes;
  // Drops mean the requested arrival schedule was not fulfilled. They do not
  // erase valid accounting for the smaller set that actually ran to completion.
  report.valid = seconds > 0 && report.started > 0 && report.failed === 0 &&
    report.started === report.uploadStarted && report.batches === report.started &&
    report.signalBytes === report.initiatedSignalBytes && (report.httpFailed?.rate || 0) === 0;
  return report;
}
