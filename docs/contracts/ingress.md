# ING-01 HTTP Ingress 协议

字段事实源：[OpenAPI](openapi.json)。前缀 `/api/namespaces/{namespace}/clusters/{cluster}/kubernetes`。

| 操作 | 路径 | 权限 |
| --- | --- | --- |
| GET | `/ingress-classes` | READ；返回实际class和管理员配置的HTTP入口 |
| GET / POST | `/namespaces/{kubeNamespace}/ingresses` | READ / WRITE |
| GET / PUT / DELETE | `/namespaces/{kubeNamespace}/ingresses/{name}` | READ / WRITE / WRITE |

PUT/DELETE必须传query `uid`、`resourceVersion`，复用原CAS语义，403/404/409/422走现有异常映射。原Namespace/Service路径不变，只整理Controller公共路径。GET只读Kubernetes，不缓存到MySQL。

请求：`name`、`ingressClassName`、`routes`。1..32条规则，每条包含`host`（可空；支持小写DNS或`*.domain`）、`path`、`pathType`（Exact/Prefix）、`service`、`port`（数字Service端口，不是容器targetPort或NodePort）。同组host/path/match不可重复；class、Service及TCP端口须实际存在；不跨Namespace找Service。外部命名端口规则只读展示为“命名端口”，第一版不提供其编辑转换。编辑保留非本表单管理的metadata和spec字段，不整对象重建。

后端只编辑平台拥有的Ingress，read权限不带写权限。Kubernetes RBAC无法按所有权标签限制创建，平台执行Workspace/Namespace检查；后台凭据不是硬租户隔离。Service删除增加当前引用检查，不和Ingress创建组成分布式事务，外部管理员并发操作仍可破坏引用。

IngressClass可由部署管理员设置`cea-system/http-entrypoint`，表示浏览器可用的HTTP origin（CEA为四个本机端口）；真正消费者是前端入口地址和访问链接，不参与Runner或路由匹配。前端仅接受无凭据、无路径/查询的http origin，禁止javascript等协议；具体域名规则替换链接hostname，通配域名不生成猜测链接。控制器的status地址独立展示，未上报不填假IP、不冒充Ready。入口端口变动由部署脚本同步class注解。

## 部署与调用链

管理：浏览器 → 原身份鉴权 → KubernetesManagementController → KubernetesManagementService → 现有KubernetesConnections → Kubernetes API。

访问：Windows本机18090/18091/18092/18093 → CEA `ingress-access` HTTP端口桥 → 对应集群NodePort30080 → 集群内Traefik → Ingress指定Service → 实际Pod。桥只选择集群并保留Host/path，不保存业务路由；是Docker内K3s对宿主不可直接访问时的环境适配，与管理前端独立。正式独立节点可直接暴露控制器，不需要该桥。

四集群新增`cea-ingress` Namespace、Traefik ServiceAccount/ClusterRole/Binding、Deployment、NodePort Service及`cea-traefik` IngressClass。Traefik v3.7.13只启用标准Ingress provider，过滤平台owner标签及显式class；不启用CRD、Dashboard或TLS自动证书。沿用原K3s禁用内置Traefik配置，无需重启集群。Controller按官方provider依赖读取Service、EndpointSlice、Secret和节点等；不授予工作负载写权限。后端新增Ingress CRUD及IngressClass读取RBAC。此基础设施变化需要单独授权。

控制器显式启用`strictPrefixMatching=true`，使`/api`匹配`/api`和`/api/child`，不匹配`/api-other`；不能依赖Traefik默认的字符前缀行为冒充Kubernetes路径段匹配。该边界由真实HTTP回归验证。

参考：[Kubernetes Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/)、[Traefik Provider](https://doc.traefik.io/traefik/reference/install-configuration/providers/kubernetes/kubernetes-ingress/)。本项目刻意限制为现有需求的HTTP规则，不复制完整网关产品。
