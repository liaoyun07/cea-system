# UI-16 部署配置与运行实例

沿用 `/api/namespaces/{namespace}/clusters/{clusterId}/deployments/{name}`。

## 写入与配置回读

PUT 与 GET `/configuration` 的原字段不变，新增 `resources`：

```json
{
  "cpuRequest": "100m",
  "memoryRequest": "64Mi",
  "cpuLimit": "1",
  "memoryLimit": "256Mi"
}
```

数量采用 Kubernetes Quantity。必需校验：可解析、正值、同时填写时 request 不大于 limit；其它准入规则由 Kubernetes 执行。PUT 省略整个 resources 或传 null 保持原资源；对象中省略/null/空白字段删除对应 CPU/内存显式配置，保留其它资源。配置 GET 读取 Kubernetes 当前值，空值为 null，不返回假设默认值。若只填 limit，Kubernetes 可能自动补 request；回读以实际值为准。

参数仍是 `parameters` 对象，环境变量转换使用应用契约的现有逻辑；UI 不再要求整体手填 JSON。`command: []` 使用镜像默认启动配置；自定义命令仍用原数组，不另加启动模型。readiness 为原 HTTP 路径/数字端口；null 表示不配置。更新继续要求当前 resourceVersion，扩缩容接口不改变参数、探针和资源配置。

## 运行实例（新增只读接口）

GET `/runtime`：沿用 namespace READ、集群连接与平台所属 Deployment 校验。

```json
{
  "namespace": "cea-lab",
  "selector": {"cea-system/deployment": "example"},
  "labels": {"cea-system/deployment": "example"},
  "pods": [{
    "name": "example-abc-def", "phase": "Running", "ready": true,
    "node": "cea-edge-a", "restarts": 0, "reasons": []
  }]
}
```

示例 labels 已简化；实际返回完整 Selector/模板标签。Pod 必须由该 Deployment UID 的 ReplicaSet 控制，包括滚动更新旧副本，不只凭标签认领。删除中的 Pod 展示 Terminating；ready 来自 Pod Ready=True；reasons 汇集 Pod/condition、init/普通容器 waiting 与非零退出状态，重启次数求和。不存在实例返回空数组，查询失败返回错误，前端不把失败伪装为零实例。

Service/Ingress 不并入新后端业务模型。前端读取同集群同 Namespace 的原 API，以非空 Service selector 匹配模板 labels，再关联其 Ingress 后端。入口跳转是未提交的表单预填，不创建资源；沿用原 Service/Ingress 的权限和写入协议。无数据库变更、缓存或持久化 Pod 历史。

OpenAPI：`DeploymentResources`、`DeploymentRuntime`、`DeploymentPod`；见 [openapi.json](openapi.json)。
