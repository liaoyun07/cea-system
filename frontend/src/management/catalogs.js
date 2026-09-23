import { parseJsonValue } from '../no-code/document.js';
import { makeFields, inputValues } from '../model.js';

export const applicationParameterTypes = [
  'STRING',
  'INTEGER',
  'NUMBER',
  'BOOLEAN',
  'OBJECT',
  'ARRAY',
  'SELECT',
];

export const catalogs = {
  applications: {
    title: '应用与镜像',
    caption: 'APPLICATIONS',
    path: '/applications',
    create: '注册应用版本',
    columns: [
      ['applicationId', '应用 ID'],
      ['version', '版本'],
      ['image', '镜像'],
    ],
  },
  clusters: {
    title: '集群管理',
    caption: 'CLUSTERS',
    path: '/resources/clusters',
    create: '登记集群',
    columns: [
      ['id', '集群 ID'],
      ['kind', '计算层'],
      ['enabled', '目录准入'],
    ],
  },
  datasets: {
    title: '数据集管理',
    caption: 'DATASETS',
    path: '/resources/datasets',
    create: '登记数据集版本',
    columns: [
      ['datasetId', '数据集 ID'],
      ['version', '版本'],
      ['format', '格式'],
      ['locations', '数据位置'],
    ],
  },
  gateways: {
    title: '边缘网关管理',
    caption: 'GATEWAYS',
    path: '/edge/gateways',
    create: '登记网关',
    columns: [
      ['id', '网关 ID'],
      ['clusterId', '所属边缘集群'],
      ['principal', '接入账号'],
      ['enabled', '接入开关'],
      ['lastSeenAt', '最近活动'],
    ],
  },
  terminals: {
    title: '终端设备接入',
    caption: 'TERMINALS',
    path: '/edge/terminals',
    create: '登记终端',
    columns: [
      ['id', '终端 ID'],
      ['gatewayId', '所属网关'],
      ['enabled', '接入开关'],
      ['lastSeenAt', '最近活动'],
    ],
  },
  policies: {
    title: '边缘数据处理策略',
    caption: 'EDGE POLICIES',
    path: '/edge/policies',
    create: '新建策略',
    columns: [
      ['id', '策略 ID'],
      ['clusterId', '事件来源集群'],
      ['eventType', '事件类型'],
      ['enabled', '事件触发'],
    ],
  },
  observations: {
    title: '任务卸载决策记录',
    caption: 'OFFLOADING',
    path: '/offloading/samples',
    columns: [
      ['applicationId', '应用'],
      ['applicationVersion', '版本'],
      ['target', '执行目标'],
      ['strategy', '策略'],
      ['outcome', '结果'],
      ['inferenceMs', '决策时延'],
      ['createdAt', '决策时间'],
      ['measurement', '样本状态'],
    ],
  },
};
export const entryId = (row) => row.id || row.applicationId || row.datasetId || row.key;
export const offloadingTarget = (target) => (target ? `${target.kind} / ${target.id ?? '未分配'}` : '—');
export const inferenceLatency = (row) =>
  row.strategy !== 'DQN' ? '不适用' : row.inferenceMs == null ? '未采集' : `${row.inferenceMs.toFixed(3)} ms`;
export function measurementStatus(value) {
  if (!value) return '未采集六维状态';
  if (value.unavailable === 'transfer calibration incomplete') return '待传输标定';
  if (value.unavailable) return '工作负载不可比';
  if (value.feedbackOutcome === 'CANCELLED') return '已取消，不用于训练';
  if (value.feedbackOutcome === 'UNMEASURED') return '缺少原始计时';
  if (!value.feedbackOutcome) return '待终端反馈';
  if (value.nextKey && !value.nextState) return '下一状态不完整';
  if (!value.nextState) return '待下一决策';
  return value.trainable ? '样本完整' : '待执行确认';
}
export const enc = encodeURIComponent;
export function itemPath(kind, value) {
  const base = catalogs[kind].path;
  if (kind === 'applications') return `${base}/${enc(value.applicationId)}/versions/${enc(value.version)}`;
  if (kind === 'datasets') return `${base}/${enc(value.datasetId)}/versions/${enc(value.version)}`;
  return `${base}/${enc(value.id)}`;
}
export function newDraft(kind, namespace) {
  switch (kind) {
    case 'applications':
      return { applicationId: '', version: '', image: '', parameterRows: [] };
    case 'datasets':
      return { datasetId: '', version: '', format: '', locations: [] };
    case 'clusters':
      return { id: '', kind: 'EDGE', enabled: true };
    case 'gateways':
      return { id: '', clusterId: '', principal: '', enabled: true };
    case 'terminals':
      return { id: '', gatewayId: '', enabled: true };
    case 'policies':
      return { id: '', clusterId: '', eventType: '', enabled: false, expectedRevision: 0, source: '' };
  }
}
export function applicationDraft(app) {
  return {
    applicationId: app.applicationId,
    version: app.version,
    image: app.image,
    parameterRows: Object.entries(app.parameters).map(([name, p]) => ({
      name,
      type: p.type,
      required: p.required,
      defaultJson: p.defaultValue == null ? '' : JSON.stringify(p.defaultValue),
      choicesJson: p.choices?.length ? JSON.stringify(p.choices) : '',
      dataset: !!p.dataset,
      format: p.dataset?.format || '',
      allowed: p.dataset?.allowed.map((d) => `${d.datasetId}/${d.version}`) || [],
    })),
  };
}
export function parameterContract(rows) {
  const parameters = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (!name || Object.hasOwn(parameters, name)) throw new Error('参数名称不能为空或重复。');
    const value = { type: row.type, required: !!row.required };
    if (row.defaultJson.trim()) value.defaultValue = parseJsonValue(row.defaultJson);
    if (row.dataset) {
      if (row.type !== 'STRING') throw new Error(`${name} 的数据集参数类型必须为 STRING。`);
      value.dataset = {
        format: row.format,
        allowed: row.allowed.map((s) => {
          const [datasetId, version] = s.split('/');
          return { datasetId, version };
        }),
      };
    } else if (row.choicesJson.trim()) {
      value.choices = parseJsonValue(row.choicesJson);
      if (!Array.isArray(value.choices)) throw new Error(`${name} 的允许值必须是 JSON 数组。`);
    }
    const matches = (v) => {
      switch (row.type) {
        case 'STRING':
        case 'SELECT':
          return typeof v === 'string';
        case 'INTEGER':
          return Number.isSafeInteger(v);
        case 'NUMBER':
          return typeof v === 'number' && Number.isFinite(v);
        case 'BOOLEAN':
          return typeof v === 'boolean';
        case 'OBJECT':
          return v !== null && typeof v === 'object' && !Array.isArray(v);
        case 'ARRAY':
          return Array.isArray(v);
        default:
          return false;
      }
    };
    if (
      (value.defaultValue != null && !matches(value.defaultValue)) ||
      value.choices?.some((v) => !matches(v))
    )
      throw new Error(`${name} 的默认值和允许值必须符合 ${row.type} 类型。`);
    if (row.type === 'SELECT') {
      const choices = value.choices || [];
      if (!choices.length || choices.some((v) => !v.trim()) || new Set(choices).size !== choices.length)
        throw new Error(`${name} 的 SELECT 允许值必须是非空、无重复的字符串数组。`);
      if (value.defaultValue != null && !choices.includes(value.defaultValue))
        throw new Error(`${name} 的默认值必须在 SELECT 允许值中。`);
    }
    Object.defineProperty(parameters, name, { value, enumerable: true });
  }
  return parameters;
}
export function requestBody(kind, draft) {
  switch (kind) {
    case 'applications':
      return {
        applicationId: draft.applicationId,
        version: draft.version,
        image: draft.image,
        parameters: parameterContract(draft.parameterRows),
      };
    case 'gateways':
      return { clusterId: draft.clusterId, principal: draft.principal, enabled: draft.enabled };
    case 'terminals':
      return { gatewayId: draft.gatewayId, enabled: draft.enabled };
    case 'policies':
      return {
        clusterId: draft.clusterId,
        eventType: draft.eventType,
        enabled: draft.enabled,
        expectedRevision: draft.expectedRevision,
        source: draft.source,
      };
    default:
      return JSON.parse(JSON.stringify(draft));
  }
}
export function deploymentBody(draft) {
  for (const field of draft.parameters) {
    if (field.required && !field.provided) throw new Error(`${field.name}：必填参数`);
  }
  const parameters = inputValues(draft.parameters);
  const command = draft.customCommand ? parseJsonValue(draft.command) : [];
  if (!Array.isArray(command) || command.some((v) => typeof v !== 'string'))
    throw new Error('启动命令必须是字符串 JSON 数组。');
  const [applicationId, version] = draft.application.split('/');
  if (!applicationId || !version) throw new Error('请选择应用版本。');
  return {
    applicationId,
    version,
    replicas: draft.replicas,
    parameters,
    command,
    ...(draft.resources ? { resources: draft.resources } : {}),
    ...(draft.resourceVersion ? { resourceVersion: draft.resourceVersion } : {}),
    ...(draft.readinessEnabled
      ? { readiness: { path: draft.readinessPath, port: draft.readinessPort } }
      : { readiness: null }),
  };
}
export function deploymentFields(contract = {}, values = {}) {
  return makeFields(
    Object.fromEntries(
      Object.entries(contract).map(([name, field]) => [
        name,
        {
          ...field,
          values: field.choices,
          defaultValue: Object.hasOwn(values, name) ? values[name] : field.defaultValue,
        },
      ]),
    ),
  ).map((field) => ({
    ...field,
    provided: field.required || field.provided,
    value: field.type === 'BOOLEAN' && field.value === '' ? 'false' : field.value,
  }));
}
export function deploymentDraft(name, value, contract = {}) {
  return {
    name,
    application: `${value.applicationId}/${value.version}`,
    replicas: value.replicas,
    parameters: deploymentFields(contract, value.parameters),
    command: JSON.stringify(value.command, null, 2),
    customCommand: !!value.command?.length,
    resources: value.resources || { cpuRequest: '', memoryRequest: '', cpuLimit: '', memoryLimit: '' },
    resourceVersion: value.resourceVersion,
    readinessEnabled: !!value.readiness,
    readinessPath: value.readiness?.path || '/',
    readinessPort: value.readiness?.port || 8080,
  };
}
