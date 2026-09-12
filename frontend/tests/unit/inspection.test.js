import test from 'node:test';
import assert from 'node:assert/strict';
import { overviewCounts, overviewDays } from '../../src/overview.js';

test('overview sums every day and state without counting cancellations as failures', () => {
  const data = {
    from: '2026-09-10T00:00:00Z',
    to: '2026-09-12T01:00:00Z',
    days: [
      { date: '2026-09-10', state: 'SUCCESS', count: 120 },
      { date: '2026-09-10', state: 'FAILED', count: 2 },
      { date: '2026-09-12', state: 'SUCCESS', count: 3 },
      { date: '2026-09-12', state: 'KILLED', count: 1 },
    ],
  };
  assert.deepEqual(overviewCounts(data), { SUCCESS: 123, FAILED: 2, KILLED: 1 });
  assert.deepEqual(overviewDays(data), [
    { date: '2026-09-10', count: 122 },
    { date: '2026-09-11', count: 0 },
    { date: '2026-09-12', count: 4 },
  ]);
});
