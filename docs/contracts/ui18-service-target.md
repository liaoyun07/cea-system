# UI-18 Service 目标选择交互

公共 HTTP API、ServiceRequest、DeploymentRuntime 和数据库结构均不变，不新增“应用与服务绑定表”。

- 目标列表：GET `/api/namespaces/{workspace}/clusters/{cluster}/kubernetes/namespaces/{kubeNamespace}/deployments`。
- 提交前读取：GET 同路径 `/{deployment}/runtime`，取 `selector`。
- 创建：POST 同级 `/services`，请求仍为 `name/type/selector/ports`。后端原有校验和权限继续生效。
- 前端 access 跳转上下文仅带 `cluster/namespace/name`；不再携带 selector 快照。目标名称必须存在于所选作用域的最新列表，切换作用域清空选择；直接创建不自动选择第一个部署。
- 不在标签为空或读取失败时回退到手拼条件。runtime 请求失败则不发送创建请求，保留表单允许重试；底层正常的完整 selector 原样保留。

这是前端交互简化，不改变原 API 的通用 selector 能力，也不新增 Deployment 与 Service 的所有权/级联删除关系。
