import { parseJsonValue } from '../no-code/document.js';

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
    title: '集群资源',
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
    title: '数据集',
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
    title: '边缘网关',
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
    title: '终端设备',
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
    title: '边缘处理策略',
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
    title: '卸载观测',
    caption: 'OFFLOADING',
    path: '/offloading/samples',
    columns: [
      ['applicationId', '应用'],
      ['applicationVersion', '版本'],
      ['target', '执行目标'],
      ['strategy', '策略'],
      ['outcome', '结果'],
      ['createdAt', '决策时间'],
    ],
  },
};
export const entryId = (row) => row.id || row.applicationId || row.datasetId || row.key;
export const offloadingTarget = (target) => (target ? `${target.kind} / ${target.id ?? '未分配'}` : '—');
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
  const parameters = parseJsonValue(draft.parameters);
  const command = parseJsonValue(draft.command);
  if (!parameters || Array.isArray(parameters) || typeof parameters !== 'object')
    throw new Error('参数值必须是 JSON 对象。');
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
    ...(draft.resourceVersion ? { resourceVersion: draft.resourceVersion } : {}),
    ...(draft.readinessEnabled
      ? { readiness: { path: draft.readinessPath, port: draft.readinessPort } }
      : { readiness: null }),
  };
}
export function deploymentDraft(name, value) {
  return {
    name,
    application: `${value.applicationId}/${value.version}`,
    replicas: value.replicas,
    parameters: JSON.stringify(value.parameters, null, 2),
    command: JSON.stringify(value.command, null, 2),
    resourceVersion: value.resourceVersion,
    readinessEnabled: !!value.readiness,
    readinessPath: value.readiness?.path || '/',
    readinessPort: value.readiness?.port || 8080,
  };
}
