export function durationText(milliseconds) {
  return typeof milliseconds === 'number' && milliseconds >= 0
    ? `${(milliseconds / 1000).toFixed(2)} s`
    : '—';
}
export function deploymentTarget(record) {
  if (
    !record ||
    !['CREATE', 'UPDATE'].includes(record.operation) ||
    record.state !== 'SUCCEEDED' ||
    record.durationMs == null
  )
    return '—';
  return record.durationMs <= 30000 ? '≤ 30 s' : '> 30 s';
}
export const operationName = (value) => ({ CREATE: '创建', UPDATE: '更新', SCALE: '扩缩容' })[value] || value;
export const stateName = (value) =>
  ({
    PREPARING: '准备镜像',
    OBSERVING: '等待就绪',
    RUNNING: '进行中',
    SUCCEEDED: '成功',
    FAILED: '失败',
    UNKNOWN: '结果未确认',
    SUPERSEDED: '已被替代',
  })[value] ||
  value ||
  '—';
export const percentText = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}%` : '—';
export const coresText = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(3)} 核` : '—';
export const memoryText = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? `${(value / 1048576).toFixed(1)} MiB` : '—';
export const usageState = (value) =>
  ({ AVAILABLE: '可用', STALE: '已过期', INVALID: '无效', MISSING: '无数据' })[value] || '不可用';
