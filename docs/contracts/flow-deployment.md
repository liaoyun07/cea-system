# platform.Deployment

沿原 `/flows/{id}/revisions`、`/executions` 和任务查询接口；schemaVersion仍为1，新增任务类型与可选 `Task.deployment`。旧Application源码无需修改。

```yaml
id: deploy_cloud
type: platform.Deployment
timeout: PT5M
container:
  applicationId: hydraulic-resident
  version: service-v1
  candidateClusters: [cloud]
  parameters:
    ROLE: {source: LITERAL, value: cloud}
  resources:
    limits: {cpu: '2', memory: 1Gi}
deployment:
  name: hydraulic-cloud
  replicas: 1
  readiness: {path: /health, port: 8080}
  service:
    port: 8080
    targetPort: 8080
    nodePort: 31101
    endpoint: http://cloud-node:31101
```

- 共用 `container.applicationId/version/parameters/command/resources/candidateClusters`。候选字段保留原数组或 Binding 语法，本任务解析后必须恰好一个目标，不进行 Job 槽位调度。
- `deployment.name` 必填；`kubeNamespace` 默认现有集群连接的执行命名空间；`replicas` 默认1，可设0～100。
- `readiness` 可选，复用已有 HTTP path/port；Deployment 当前 generation 已被观察且 updated/available/ready/total副本数均满足才成功。
- `service` 可选，port/targetPort必填；有nodePort为NodePort，无则ClusterIP。仅TCP单端口；沿既有工作空间与命名空间权限校验创建/更新同名受管Service。
- `endpoint` 可选 HTTP(S) 地址，任务就绪后作为同名输出返回；缺失返回空字符串。绑定沿 `TASK_OUTPUT`，不增新表达式体系。
- 修改Service已有ClusterIP、自动分配的NodePort保留。移除可选Service配置不删除已经存在的Service；删除走已有资源管理操作。
- 资源limits映射为原DeploymentService的相同requests/limits，保持Kubernetes新容器仅limits时requests默认相同的行为。未设置资源时原部署模块默认行为不变。
- 超时/取消只结束等待；重试对同名对象更新。启动失败/非法配置会失败，不返回地址伪装成功；不自动销毁已经创建的资源。
