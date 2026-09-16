# ING-01 HTTP Ingress 管理

范围：申报书 B04 的 Service/Ingress 入口管理补齐。平台管理标准 Kubernetes Ingress；不管理镜像生命周期、Flow 或调度。当前验证和部署结果见[验收](../verification/VER-ING-01-ingress.md)。

页面入口：运行资源 → Ingress。按集群与已授权 Kubernetes Namespace 查询，创建/编辑时选择现有 IngressClass、同 Namespace Service 的 TCP 端口，配置域名与 Exact/Prefix 路径。名称创建后不可改；编辑与删除使用读取到的 uid/resourceVersion，冲突需重新读取，不覆盖外部并发修改。外部资源可查看但不能编辑/删除。

创建规则不创建 Deployment、Service 或 Pod。删除规则只撤销该入口；Service 被任意同 Namespace Ingress 引用时，平台拒绝直接删除 Service。Namespace 原有级联删除语义保持，默认执行 Namespace 仍不能删除。权限按现有 READ/WRITE 和 Workspace/Namespace 所有权判断，不新增权限模型。

本批新增真实能力是管理 HTTP 域名/路径路由并用现有服务验证访问。没有 TLS/证书、路径重写、限流、鉴权中间件、Gateway API 或任意 TCP/UDP 代理管理。域名解析由 DNS/hosts 提供，保存 Ingress 不等于注册域名。入口“已保存”不等于后端就绪，必须实际请求验证。

Java 文件均为现有文件：KubernetesManagementController 增加6个HTTP操作，KubernetesManagementService增加路由校验/CRUD和4个公开record；KubernetesConnections、Executor、Worker、Placement、Runner不变，无新表、列、migration或SPI。前端新增KubernetesIngress.vue并接入KubernetesResourcesPage。

参考标准 Kubernetes Ingress v1 与 Traefik Kubernetes Ingress Provider，不涉及Kestra通用工作流能力，故不改变Kestra参考模型。技术协议及来源见[协议](../contracts/ingress.md)，基础设施取舍见[ADR-0030](../decisions/ADR-0030-http-ingress.md)。
