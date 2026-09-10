export const terminal = (state) => ['SUCCESS', 'FAILED', 'KILLED', 'SKIPPED'].includes(state);
export const pretty = (value) => JSON.stringify(value, null, 2);
export const time = (value) => (value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—');

export function makeFields(inputs = {}) {
  return Object.entries(inputs).map(([name, input]) => ({
    name,
    ...input,
    provided: input.defaultValue !== null && input.defaultValue !== undefined,
    value:
      input.defaultValue === null || input.defaultValue === undefined
        ? ''
        : ['ARRAY', 'OBJECT'].includes(input.type)
          ? pretty(input.defaultValue)
          : String(input.defaultValue),
  }));
}

export function inputValues(fields) {
  return Object.fromEntries(
    fields
      .filter((f) => f.provided)
      .map((f) => {
        let value = f.value;
        if (f.type !== 'STRING') {
          if (!value.trim()) throw new Error(`${f.name}：请填写 ${f.type} 值，或取消“提供”以省略字段`);
          try {
            value = JSON.parse(value);
          } catch {
            throw new Error(`${f.name}：不是有效的 ${f.type} 值`);
          }
          const valid = {
            INTEGER: Number.isSafeInteger(value),
            NUMBER: typeof value === 'number' && Number.isFinite(value),
            BOOLEAN: typeof value === 'boolean',
            OBJECT: value !== null && typeof value === 'object' && !Array.isArray(value),
            ARRAY: Array.isArray(value),
          }[f.type];
          if (!valid) throw new Error(`${f.name}：值与 ${f.type} 类型不符`);
        }
        return [f.name, value];
      }),
  );
}

// A pending submission owns an immutable request + key, never a second execution model.
export function submission(flow, fields) {
  return {
    key: crypto.randomUUID(),
    body: { flowId: flow.flowId, revision: flow.revision, inputs: inputValues(fields) },
  };
}

export function mergeLogs(current, incoming, cap = 1000) {
  const byId = new Map(current.map((row) => [row.id, row]));
  for (const row of incoming) byId.set(row.id, row);
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-cap);
}

export function sample(namespace, id) {
  return `schemaVersion: 1\nnamespace: ${JSON.stringify(namespace)}\nid: ${JSON.stringify(id)}\ndescription: 第一个工作流\ninputs:\n  name:\n    type: STRING\n    defaultValue: World\ntasks:\n  - id: greet\n    type: core.Log\n    message: "Hello {{ inputs.name }}"\noutputs:\n  greeting:\n    source: TASK_OUTPUT\n    taskId: greet\n    port: message\n`;
}
