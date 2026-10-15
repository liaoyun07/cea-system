# DEP-WARM-01 中心云原生预热池组件验证

2026-10-16，中心云安装验证完成；本批不实现生产页面、业务扩容接入或性能验收。

采用 Kubernetes SIGs Agent Sandbox v1.0.2 的原始 core + extensions 控制器，而不是平台自行提前部署一批 Deployment 模拟池。增加一个控制器 Deployment、四类 CRD（Sandbox、SandboxTemplate、SandboxWarmPool、SandboxClaim）及上游配套 RBAC/Service。控制器单副本，资源请求 0.1 核/128Mi、上限 0.5 核/512Mi。

实际链路：管理员创建模板和池 → 上游控制器创建并维持就绪 Sandbox/Pod → 创建 Claim 领取池内 Sandbox → 给领取实例添加可用于业务 Service 选择的标签 → 自动补充空闲实例。无可用预热实例时可新建 Sandbox；本批 Claim 删除策略为 Delete，已领取实例由 Kubernetes 垃圾回收，而非复用脏状态。

实验使用公共非特权 Nginx 镜像和 HTTP readiness probe；HTTP 返回当前 Pod 名以验证真实路由。池内未领取 Pod 不在共享业务 Service 的 endpoints 中，领取后才加入。模板保留 Managed NetworkPolicy，仅允许专用探测 Pod 访问 8080；未给业务 Pod 挂载服务账号令牌。

## 与现有系统的边界

- 仅中心云安装，三个边缘集群不变；不增加 CEA 后端账号权限，不重启前后端或其他 CEA Docker 服务。
- 原生 Deployment/ReplicaSet/HPA 不消费 SandboxWarmPool，当前页面扩容不会自动提速。若接入生产服务，需明确选择 Sandbox 管理链路并接通 Service/副本管理，不能把它当作透明 Deployment 插件。
- 本批没有新增或删除 Java 类、数据库表、业务接口/字段，也不涉及 Flow/Worker/Kestra 执行语义。原系统主调用链不变，仅新增独立 Kubernetes 控制器能力。
- 测试资源已删除，安装组件保留；当前无常驻业务预热实例。池中的备用实例会占用额外内存，不能把这项代价忽略。
- 仅验证当前 K3s 1.30.6 环境上的基本闭环，不宣称官方兼容认证、所有应用均可热领取或弹性部署效率提升 20% 已达成。

[部署与脚本](../../deploy/agent-sandbox/README.md) · [实测结果](../verification/VER-DEP-WARM-01.md)

上游资料：[v1.0.2 发布](https://github.com/kubernetes-sigs/agent-sandbox/releases/tag/v1.0.2)、[项目说明](https://github.com/kubernetes-sigs/agent-sandbox)、[预热池示例](https://agent-sandbox.sigs.k8s.io/docs/use-cases/examples/warmpool-quickstart/)。
