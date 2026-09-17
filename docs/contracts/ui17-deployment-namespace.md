# UI-17 常驻部署显式 Namespace

部署 API 统一为 `/api/namespaces/{namespace}/clusters/{clusterId}/kubernetes/namespaces/{kubeNamespace}/deployments`。

- `namespace` 是平台工作空间；`kubeNamespace` 是目标 Kubernetes Namespace，必填。
- 集合 GET 列表；`/{name}` GET/PUT/DELETE；`/{name}/configuration`、`/runtime`、`/history` GET；`/{name}/scale` PATCH。
- 原 PUT/Scale body、resourceVersion 条件、参数契约和计时口径不变；DeploymentView 增加 kubeNamespace。
- 不保留省略目标 Namespace 的旧部署路由。前端和现有浏览器测试、部署基准调用同步升级；历史文档中的旧路径是当时版本，当前以本协议/OpenAPI 为准。
- Namespace 列表复用现有 `/kubernetes/namespaces`。允许默认 Namespace 或符合现有平台归属的托管 Namespace，未授权返回 403；名称格式无效 422。
- 历史记录按平台工作空间、集群、Kubernetes Namespace、部署名查询。Deployment 删除后，只要 Namespace 仍存在可管理，历史仍可查。删除 Namespace 不删除数据库中的历史记录。
- V29 增加可空 kube_namespace：仅旧记录可以暂为空，配置存在时启动回填；新请求始终显式保存。启动回填不能覆盖非空值。发布必须备份 DB，并保持原连接默认配置用于准确回填。

不改变普通 Flow 的接口和执行 Namespace；不把 Kubernetes Namespace 当成应用目录或账号工作空间。
