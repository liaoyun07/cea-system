export function overviewCounts(overview) {
  const counts = {};
  for (const row of overview.days) counts[row.state] = (counts[row.state] || 0) + row.count;
  return counts;
}
export function overviewDays(overview) {
  const totals = new Map();
  for (const row of overview.days) totals.set(row.date, (totals.get(row.date) || 0) + row.count);
  const rows = [],
    end = overview.to.slice(0, 10);
  for (
    let day = new Date(overview.from);
    day.toISOString().slice(0, 10) <= end;
    day.setUTCDate(day.getUTCDate() + 1)
  ) {
    const date = day.toISOString().slice(0, 10);
    rows.push({ date, count: totals.get(date) || 0 });
  }
  return rows;
}
