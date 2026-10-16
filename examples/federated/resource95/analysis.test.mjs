import test from 'node:test';
import assert from 'node:assert/strict';
import {summarize, compare} from './analysis.mjs';

const time = seconds => new Date(Date.UTC(2026, 9, 17, 0, 0, seconds)).toISOString();
function fixture(accuracies = [.94, .95, .96]) {
  const tasks = [{id: 'rounds', taskId: 'rounds', state: 'SUCCESS'}, {id: 'init', taskId: 'init', state: 'SUCCESS', endedAt: time(1)}];
  const evaluations = [];
  for (let round = 1; round <= accuracies.length; round++) {
    tasks.push({id: `clients-${round}`, taskId: 'clients', parentTaskRunId: 'rounds', iteration: round, state: 'SUCCESS'});
    for (let client = 1; client <= 3; client++) tasks.push({id: `train-${round}-${client}`, taskId: 'train', iteration: client, parentTaskRunId: `clients-${round}`, state: 'SUCCESS', endedAt: time(round * 10 - 3)});
    for (const role of ['aggregate', 'evaluate']) tasks.push({id: `${role}-${round}`, taskId: role, iteration: round, parentTaskRunId: 'rounds', state: 'SUCCESS', endedAt: time(round * 10)});
    evaluations.push({round, accuracy: accuracies[round - 1], samples: 10000, taskRunId: `evaluate-${round}`, endedAt: time(round * 10)});
  }
  const jobs = tasks.filter(t => ['init', 'train', 'aggregate', 'evaluate'].includes(t.taskId)).map(t => ({taskRunId: t.id, taskId: t.taskId, attemptNo: 1, state: 'SUCCESS', usage: {containers: ['files-in', 'task', 'files-out'].map(name => ({name, status: 'COMPLETE', cpuCoreSeconds: 1, memoryByteSeconds: 2 ** 30, durationSeconds: 5, peakMemoryBytes: 2 ** 29, samples: 51}))}}));
  return {algorithm: 'fedavg', execution: {state: 'SUCCESS', startedAt: time(0), endedAt: time(accuracies.length * 10), inputs: {rounds: accuracies.length}}, tasks, evaluations, usage: {status: 'COMPLETE', jobs}};
}

test('first threshold includes init and all jobs through that round, preserving full run', () => {
  const summary = summarize(fixture());
  assert.equal(summary.status, 'COMPLETE');
  assert.equal(summary.firstHitRound, 2);
  assert.equal(summary.toTarget.attempts, 11);
  assert.equal(summary.toTarget.cpuCoreSeconds, 33);
  assert.equal(summary.fullRun.cpuCoreSeconds, 48);
  assert.equal(summary.allSubsequentAbove95, true);
});

test('train round uses clients ancestor, not client iteration, and clusters are separate', () => {
  const summary = summarize(fixture([.95, .96, .97]));
  assert.equal(summary.toTarget.cpuCoreSeconds, 18);
  assert.equal(summary.toTarget.byRole.train.cpuCoreSeconds, 9);
  for (const cluster of ['edge-a', 'edge-b', 'edge-c']) assert.equal(summary.toTarget.byCluster[cluster].cpuCoreSeconds, 3);
  assert.equal(summary.toTarget.byCluster.cloud.cpuCoreSeconds, 9);
  const broken = fixture(); broken.tasks.find(t => t.id === 'train-1-1').parentTaskRunId = 'rounds';
  assert.equal(summarize(broken).toTarget.cpuCoreSeconds, null);
});

test('mean memory divides integral by wall window, not summed parallel lifetimes', () => {
  const result = summarize(fixture());
  assert.equal(result.toTarget.durationSeconds, 20);
  assert.equal(result.toTarget.memoryGiBSeconds, 33);
  assert.equal(result.toTarget.averageMemoryGiB, 33 / 20);
  assert.equal(result.toTarget.taskOnly.cpuCoreSeconds, 11);
  assert.equal(result.toTarget.helpers.cpuCoreSeconds, 22);
  assert.equal('peakMemoryBytes' in result.toTarget, false);
});

test('failed retry costs are retained in addition to one successful task', () => {
  const input = fixture(), failed = structuredClone(input.usage.jobs.find(j => j.taskRunId === 'train-1-1'));
  failed.state = 'FAILED'; failed.attemptNo = 1;
  input.usage.jobs.find(j => j.taskRunId === 'train-1-1').attemptNo = 2;
  input.usage.jobs.push(failed);
  const result = summarize(input);
  assert.equal(result.toTarget.status, 'COMPLETE');
  assert.equal(result.toTarget.successfulJobs, 11);
  assert.equal(result.toTarget.attempts, 12);
  assert.equal(result.toTarget.cpuCoreSeconds, 36);
});

test('missing container or missing successful Job never becomes zero or a full total', () => {
  const input = fixture(); input.usage.jobs[0].usage.containers[1] = {name: 'task', status: 'MISSING'};
  let result = summarize(input);
  assert.equal(result.status, 'INCOMPLETE');
  assert.equal(result.toTarget.cpuCoreSeconds, null);
  assert.equal(result.toTarget.observedCpuCoreSeconds, 32);
  input.usage.jobs.shift(); result = summarize(input);
  assert.equal(result.toTarget.cpuCoreSeconds, null);
  assert(result.toTarget.issues.some(issue => issue.includes('successful Attempt: init')));
});

test('never reaches target: null target costs, no comparable reductions, full cost retained', () => {
  const result = summarize(fixture([.9, .94, .9499]));
  assert.equal(result.status, 'NOT_REACHED');
  assert.equal(result.toTarget, null);
  assert.equal(result.firstHitRound, null);
  assert.equal(result.fullRun.cpuCoreSeconds, 48);
  assert.equal(compare(summarize(fixture()), result).reductionPercent.cpuCoreSeconds, null);
});

test('later accuracy regression is reported and invalid evaluation prevents full claims', () => {
  const input = fixture([.95, .96, .94]);
  assert.equal(summarize(input).allSubsequentAbove95, false);
  input.evaluations[0].samples = 5000;
  assert.equal(summarize(input).status, 'INCOMPLETE');
  assert.equal(summarize(input).toTarget.cpuCoreSeconds, null);
});

test('comparison reports reductions, including negative values, using first-hit windows', () => {
  const a = summarize(fixture()), input = fixture([.95, .96, .97]); input.algorithm = 'fedcads';
  const comparison = compare(a, summarize(input));
  assert.equal(comparison.status, 'COMPLETE');
  assert.equal(comparison.reductionPercent.cpuCoreSeconds, 100 * (1 - 18 / 33));
  assert.equal(comparison.reductionPercent.durationSeconds, 50);
  assert(comparison.reductionPercent.averageMemoryGiB < 0);
});
