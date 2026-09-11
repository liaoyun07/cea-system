import { parseDocument, isMap, isSeq, visit } from 'yaml';

export const sections = {
  tasks: '任务',
  errors: '错误处理',
  finally: '最终清理',
  afterExecution: '执行后处理',
};
export const taskLabels = {
  'core.Log': '日志',
  'core.Sleep': '等待',
  'core.Http': 'HTTP 请求',
  'core.Sql': 'SQL 查询',
  'platform.Application': '应用任务',
  'core.Sequential': '顺序',
  'core.Parallel': '并行',
  'core.Dag': '依赖图',
  'core.If': '条件分支',
  'core.Repeat': '轮次循环',
  'core.Loop': '集合循环',
};
export const at = (value, path) => path.reduce((v, key) => v?.[key], value);
export const pathKey = (path) => JSON.stringify(path);
const starts = (path, prefix) => prefix.every((part, i) => path[i] === part);

function safeValue(value) {
  if (
    typeof value === 'number' &&
    (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
  )
    throw new Error('数值超出浏览器安全精度，请使用源码编辑；原文未修改。');
  if (typeof value === 'bigint') {
    const number = Number(value);
    if (!Number.isSafeInteger(number))
      throw new Error('包含超出浏览器安全精度的整数，请使用源码编辑；原文未修改。');
    return number;
  }
  if (Array.isArray(value)) return value.map(safeValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, safeValue(v)]));
  return value;
}
export function parseJsonValue(raw) {
  return safeValue(JSON.parse(raw));
}
export function readDocument(source) {
  const doc = parseDocument(source, { intAsBigInt: true, uniqueKeys: true, stringKeys: true });
  if (doc.errors.length) throw new Error(doc.errors[0].message);
  if (doc.warnings.length) throw new Error(doc.warnings[0].message);
  if (!isMap(doc.contents)) throw new Error('流程必须是一个 YAML 对象；请先创建流程或修正源码。');
  visit(doc, {
    Alias() {
      throw new Error('此文档使用 YAML 别名，请使用源码编辑，避免表单修改共享节点。');
    },
  });
  const value = safeValue(doc.toJS({ maxAliasCount: 0 }));
  for (const field of ['inputs', 'variables']) {
    if (value[field] != null && (typeof value[field] !== 'object' || Array.isArray(value[field])))
      throw new Error(`${field} 必须为名称到定义的对象，请修正源码。`);
  }
  function checkGroup(tasks, depth = 0) {
    if (tasks == null) return;
    if (!Array.isArray(tasks) || depth > 16)
      throw new Error('tasks / then / else 必须为任务数组，嵌套不超过16层。请修正源码。');
    for (const task of tasks) {
      if (!task || typeof task !== 'object' || Array.isArray(task))
        throw new Error('每个任务必须为对象，请修正源码。');
      for (const list of [task.dependsOn, task.container?.outputFiles])
        if (list != null && (!Array.isArray(list) || list.some((item) => typeof item !== 'string')))
          throw new Error('dependsOn / outputFiles 必须为名称数组，请修正源码。');
      for (const field of ['tasks', 'then', 'else']) checkGroup(task[field], depth + 1);
    }
  }
  for (const section of Object.keys(sections)) checkGroup(value[section]);
  return { doc, value };
}
export function changeSource(source, path, value, remove = false) {
  const { doc } = readDocument(source);
  if (remove) doc.deleteIn(path);
  else doc.setIn(path, safeValue(value));
  return doc.toString({ lineWidth: 0 });
}
export function taskEntries(flow) {
  const result = [];
  function group(tasks, path, parent = null, depth = 0) {
    if (!Array.isArray(tasks) || depth > 16) return;
    tasks.forEach((task, i) => {
      if (!task || typeof task !== 'object') return;
      const entry = { task, path: [...path, i], parent, depth };
      result.push(entry);
      for (const field of ['tasks', 'then', 'else'])
        group(task[field], [...entry.path, field], entry, depth + 1);
    });
  }
  for (const section of Object.keys(sections)) group(flow[section], [section]);
  return result;
}
export function newTask(type, id) {
  const task = { id, type };
  if (['platform.Application', 'core.Http', 'core.Sql'].includes(type)) task.timeout = 'PT5M';
  if (type === 'core.Log') task.message = 'Hello';
  else if (type === 'core.Sleep') task.duration = 'PT1S';
  else if (type === 'platform.Application')
    task.container = {
      applicationId: '',
      version: '',
      candidateClusters: [],
      command: [],
      parameters: {},
      inputFiles: {},
      outputFiles: [],
    };
  else if (type === 'core.Http')
    task.http = { connection: '', method: 'GET', path: { source: 'LITERAL', value: '/' } };
  else if (type === 'core.Sql') task.sql = { connection: '', query: 'SELECT 1', parameters: [] };
  else if (type === 'core.If') Object.assign(task, { condition: 'true', then: [], else: [] });
  else {
    task.tasks = [];
    if (type === 'core.Repeat')
      task.repeat = { iterations: { source: 'LITERAL', value: 2 }, initial: {}, feedback: {} };
    if (type === 'core.Loop')
      task.loop = { values: { source: 'LITERAL', value: [] }, concurrency: 1, outputs: {} };
  }
  return task;
}
export function addTask(source, path, type, id) {
  const { doc, value } = readDocument(source);
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(id))
    throw new Error('任务 ID 需以字母开头，使用字母、数字、下划线或连字符（最多100字符）。');
  if (taskEntries(value).some((e) => e.task.id === id)) throw new Error(`任务 ID ${id} 已存在。`);
  if (!doc.hasIn(path) || doc.getIn(path) === null) doc.setIn(path, doc.createNode([]));
  if (!isSeq(doc.getIn(path, true))) throw new Error('目标不是任务组，请检查源码。');
  if (doc.getIn(path, true).items.length === 0) doc.getIn(path, true).flow = false;
  doc.addIn(path, newTask(type, id));
  return doc.toString({ lineWidth: 0 });
}
export function moveTask(source, path, target, index) {
  if (starts(target, path)) throw new Error('不能将任务移入自身。');
  const { doc } = readDocument(source);
  const node = doc.getIn(path, true);
  if (!doc.hasIn(target) || doc.getIn(target) === null) doc.setIn(target, doc.createNode([]));
  const destination = doc.getIn(target, true);
  if (!isSeq(destination)) throw new Error('目标不是任务组。');
  doc.deleteIn(path);
  // The node and destination remain the same AST objects even if a sibling index changed.
  destination.items.splice(index ?? destination.items.length, 0, node);
  return doc.toString({ lineWidth: 0 });
}
export function removeTask(source, path) {
  const { doc, value } = readDocument(source);
  const removedIds = new Set(
    taskEntries(value)
      .filter((e) => starts(e.path, path))
      .map((e) => e.task.id),
  );
  const references = [];
  function scan(node, p) {
    if (starts(p, path)) return;
    if (node && typeof node === 'object') {
      if (node.source === 'TASK_OUTPUT' && removedIds.has(node.taskId)) references.push(p.join('.'));
      if (Array.isArray(node.dependsOn) && node.dependsOn.some((id) => removedIds.has(id)))
        references.push([...p, 'dependsOn'].join('.'));
      Object.entries(node).forEach(([key, child]) =>
        scan(child, [...p, Array.isArray(node) ? Number(key) : key]),
      );
    } else if (
      typeof node === 'string' &&
      node.includes('{{') &&
      [...removedIds].some((id) => node.includes(id))
    )
      references.push(p.join('.'));
  }
  scan(value, []);
  if (references.length) throw new Error(`任务仍被引用，请先修改：${references.join('、')}`);
  doc.deleteIn(path);
  return doc.toString({ lineWidth: 0 });
}

export function shape(schema, root, value) {
  if (schema?.$ref) return shape(root.$defs[schema.$ref.split('/').at(-1)], root, value);
  if (schema?.anyOf) {
    const choices = schema.anyOf.filter((s) => s.type !== 'null');
    return shape(choices.find((s) => s.type === 'array' && Array.isArray(value)) || choices[0], root, value);
  }
  return schema || {};
}
export function initialValue(schema, root) {
  const s = shape(schema, root);
  if ('const' in s) return s.const;
  if (s.oneOf) return { source: 'LITERAL', value: '' };
  if (s.enum) return s.enum[0];
  return { object: {}, array: [], boolean: false, integer: 0, number: 0, string: '' }[s.type] ?? '';
}
export function outputPorts(task) {
  if (task.container) return task.container.outputFiles || [];
  if (task.loop) return Object.keys(task.loop.outputs || {});
  if (task.repeat) return [...Object.keys(task.repeat.initial || {}), 'iterations', 'iterationCount'];
  return (
    {
      'core.Log': ['message'],
      'core.If': ['evaluationResult'],
      'core.Http': ['statusCode', 'body'],
      'core.Sql': ['rows', 'size'],
    }[task.type] || []
  );
}
// Suggestions mirror structural visibility only. The server is the authority for all bindings.
export function bindingScope(flow, path) {
  const entries = taskEntries(flow);
  const entry = entries.filter((e) => starts(path, e.path)).at(-1);
  const visible = new Set();
  const complete = (task) => {
    visible.add(task.id);
    if (!task.repeat && !task.loop) (task.tasks || []).forEach(complete);
  };
  function before(current) {
    if (!current) return;
    before(current.parent);
    if (!current.parent) {
      const phases = Object.keys(sections);
      for (const phase of phases.slice(0, phases.indexOf(current.path[0])))
        (flow[phase] || []).forEach(complete);
    }
    if (current.parent?.task.repeat) visible.add(current.parent.task.id);
    const group = at(flow, current.path.slice(0, -1)) || [];
    const mode = current.parent?.task.type || 'core.Sequential';
    if (mode === 'core.Dag') {
      const seen = new Set();
      const ancestors = (task) =>
        (task.dependsOn || []).forEach((id) => {
          if (seen.has(id)) return;
          seen.add(id);
          const next = group.find((t) => t.id === id);
          if (next) {
            ancestors(next);
            complete(next);
          }
        });
      ancestors(current.task);
    } else if (mode !== 'core.Parallel') group.slice(0, current.path.at(-1)).forEach(complete);
  }
  if (entry) {
    before(entry);
    const relative = path.slice(entry.path.length);
    if (
      (relative[0] === 'repeat' && relative[1] === 'feedback') ||
      (relative[0] === 'loop' && relative[1] === 'outputs')
    ) {
      (entry.task.tasks || []).forEach(complete);
      if (entry.task.repeat) visible.add(entry.task.id);
    }
  } else if (path[0] === 'outputs') {
    // FlowValidator permits main-tree outputs, but not dynamic descendants.
    const main = (task) => {
      visible.add(task.id);
      if (!task.loop && !task.repeat)
        for (const group of ['tasks', 'then', 'else']) (task[group] || []).forEach(main);
    };
    (flow.tasks || []).forEach(main);
  }
  const item =
    !!entry &&
    ((path[entry.path.length] === 'loop' && path[entry.path.length + 1] === 'outputs') ||
      (() => {
        let parent = entry.parent;
        while (parent) {
          if (parent.task.loop) return true;
          parent = parent.parent;
        }
        return false;
      })());
  return { entries: entries.filter((e) => visible.has(e.task.id)), item };
}
export async function readCatalog(api, path) {
  const all = [];
  for (let offset = 0; ; offset += 100) {
    const page = await api(`${path}?limit=100&offset=${offset}`);
    all.push(...page);
    if (page.length < 100) return all;
  }
}
