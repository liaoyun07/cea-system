# DEP-WARM-04：在现有服务部署中接入预热模式

状态：已实施并发布（2026-10-18）。用户批准中心云 cea-lab 与独立测试命名空间新增 adapter、配置和命名空间权限；不改其他集群和旧部署。

## 实现边界

现有应用契约、参数、资源、HTTP 就绪检查、Service/Ingress 和部署 API 共用。创建增加 `warmPool` 与 `autoscaling`；创建后不切换类型。普通模式为 Deployment，预热模式为 WarmService + SandboxTemplate/Pool。原生 HPA 写目标 `/scale`；adapter 协调 Claim、业务标签与预算，Agent Sandbox 创建/领取实例。更新预热应用更换模板/池引用及 Claim，不把 Sandbox Pod 接入 ReplicaSet。

`platform.Deployment` 仍是有限的配置/等待任务，复用同一入口与字段。不复制 Job 文件助手、不改变执行状态所有权。参考 Kestra Kubernetes Apply 的有限资源应用任务，有意仅支持当前应用部署所需字段。

## 历史数据的消费者

副本采样、扩缩容事件仅供现有详情页画轨迹与列出每次耗时，不拥有期望副本。扩容从观察到目标增加开始，到新增业务 Pod Ready 且加入已有 Service 端点结束；无 Service 时以 Ready 结束。保留超时、替代、采集中断。命中通过之前已就绪的备用 Pod UID 与 containerID 复用确认，不由请求耗时或预设命中率推算。

## 页面

原创建表单增加 HPA 配置和预热开关；详情显示资源、副本轨迹、伸缩记录并复用原管理操作。预算在命名空间统一设置。不暴露评分参数、不新增实验对比面板。

## 参考

- https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/
- https://github.com/kubernetes-sigs/agent-sandbox/tree/v1.0.2/extensions
- https://kestra.io/plugins/plugin-kubernetes/kubernetes-api-kubectl/io.kestra.plugin.kubernetes.kubectl.apply
