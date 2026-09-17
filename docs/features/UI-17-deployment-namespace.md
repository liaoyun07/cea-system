# UI-17 常驻部署 Namespace 选择

## 范围

- 常驻部署先选集群，再选已创建且当前平台工作空间可管理的 Kubernetes Namespace；原连接配置仅作默认预选。
- 创建、列表、详情、配置、扩缩容、删除、实例和历史使用相同的显式 Namespace。不同 Namespace 的同名 Deployment 独立。
- 已有部署不搬迁；编辑期间集群和 Namespace 固定。跨 Namespace 部署应另建资源。
- Namespace 管理移入“模块化边缘服务部署 / 服务资源管理”，与 Service、Ingress 同页；集群运行资源只保留节点。
- 配置访问入口沿用当前部署的真实 Namespace。镜像/应用引用检查已覆盖可管理 Namespace，不另建关联体系。

## 调用与持久化

DeploymentController → DeploymentService → 复用 KubernetesManagementService.allowed 范围检查 → Fabric8 inNamespace → Kubernetes。平台工作空间鉴权仍先执行；KubernetesConnections 的默认行为、普通 Flow / Job / Placement 均不修改。

V29 给 dep_deployment_record 增加 kube_namespace 并更新历史索引。开始操作即保存显式 Namespace；观察器按该范围及原 UID/generation 判断就绪，计时定义不变。启动时在 Flyway 完成后，仅给历史 NULL 记录填入对应连接的原默认 Namespace；不覆盖已记录值。未配置连接的旧记录不猜测 Namespace，保留原数据，未结束记录继续适用原超时规则。

不新增生产 Java 文件、表、服务或资源状态机。CEA 后端账号在现有管理 ClusterRole 中仅补 Deployment create/update/delete；StatefulSet、DaemonSet 等仍只读，不授予 cluster-admin。该角色既有集群级绑定；工作空间资源范围由平台校验，不声称新增了 Kubernetes 层的逐 Namespace 租户 RBAC 隔离。

## 验收

两个新 Namespace 同名部署的真实创建/就绪/计时、编辑、扩缩容、实例和历史隔离；单独删除不影响另一个。默认 Namespace 回归、越权 Namespace 拒绝、旧记录回填不覆盖新记录、Service 入口预填、桌面/窄屏验证。实测结果见 [验证记录](../verification/VER-UI-017-deployment-namespace.md)。
