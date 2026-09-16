# ADR-0030：HTTP Ingress 管理与 CEA 入口

状态：已决定并实施，ING-01 验证/部署状态以[验收记录](../verification/VER-ING-01-ingress.md)为准。用户已单独允许新增四集群入口组件与管理权限。

应用部署负责 Pod，Service 负责稳定后端，Ingress 负责 HTTP 域名/路径到 Service 的路由。三者不和镜像版本一一绑定，也不由 Flow Executor 维护。沿用 platform-resource 的 KubernetesManagementService、现有权限与连接，Kubernetes 是唯一规则事实源；不新增路由数据库、调度器或业务状态机。

选择标准 Kubernetes Ingress v1 与 Traefik 的标准 Ingress Provider，限制为现有 Service 数字 TCP 端口、Exact/Prefix、可选域名。没有 TLS 证书、重写、中间件或 Gateway API。Kestra 的通用工作流模型不涉及此资源管理能力，不强行引入工作流插件。

CEA 四个 K3s 均在 Docker 网络中，内置 Traefik 原本禁用。显式部署独立 Traefik，可避免重启 K3s；新增 nginx 端口桥把本机四个端口分别接到对应集群 NodePort。端口桥仅做环境接入，不拥有域名/路径业务规则，不经过管理前端。生产独立节点可以直接暴露控制器，不必复制此本机适配。

IngressClass 的 HTTP 入口注解由管理员配置，前端真实消费它来展示可访问地址；控制器 status 地址仍独立显示。规则保存成功不等于服务健康，验收必须包含真实 HTTP 请求。删除 Ingress 不删除 Service 或工作负载，Service 删除检查当前 Ingress 引用，但不承诺与外部 Kubernetes 操作形成分布式事务。

代价：新增四个小型控制器与一个本机端口桥；HTTP 仅绑定回环地址，公网 DNS/TLS 不在本批范围。接口与官方来源见[协议](../contracts/ingress.md)。
