# UI-16：常驻服务部署核心操作

## 范围与职责

本批只改善常驻 Deployment 的三个日常操作环节，不改普通 Flow、Worker、Placement、文件助手或卸载链。

1. 选择已登记应用版本，直接按该版本的参数契约生成表单。STRING/INTEGER/NUMBER 用输入框，BOOLEAN 用开关，SELECT/允许值用下拉，OBJECT/ARRAY 保留 JSON 编辑。默认值包含 false、0、空串，选填字段可以省略；切换版本重建参数，避免遗留上一个应用的字段。
2. 默认沿用镜像启动配置，自定义启动命令仍是现有字符串数组，放入“高级配置”。CPU/内存申请量、上限是每个副本主容器的 Kubernetes resources；沿用 HTTP readiness 的路径/端口，不引入第二套健康状态。
3. 详情补当前 Pod 的阶段、就绪、节点、重启与异常/最近退出原因；读取属于本 Deployment UID 的 ReplicaSet，再按 owner UID 过滤 Pod，不把相同标签的流程 Job 当作服务实例。关联入口读取现有 Service/Ingress API；“配置访问入口”跳转现有管理页面并预填集群、Namespace、部署名和完整 Selector，不自动创建或公开服务。

## 调用链

创建/编辑：表单 → 原 Deployment PUT → 应用契约校验/镜像准备 → 更新主容器参数、命令、readiness、CPU/内存 → Kubernetes Deployment → 原部署操作观测。

详情：Deployment GET + 原操作历史 GET + 新 runtime GET → Kubernetes Deployment/ReplicaSet/Pod；前端用模板 labels 匹配 Service selector，再用 Service 名称匹配 Ingress 路由。

配置入口：详情的上下文 → 原 Service 创建表单 → 用户确认端口并提交原 Service API。Ingress 仍由原独立页面配置。

## 兼容边界

- 无数据库表/迁移、新基础设施、权限扩展或新生产 Java 文件；只扩展现有服务/控制器 DTO 和读接口。
- 保留原鉴权、资源版本校验、扩缩容、滚动更新和部署时间统计。资源为空不会为已有部署自动加限制；修改资源会触发 Kubernetes 正常滚动更新。
- resources 整体省略/null 保留原配置；提供对象时只替换 CPU/内存四项，空白清除该显式字段，其它资源和容器字段保留。Kubernetes 自身的默认值/准入规则仍生效，单填 limit 可能被默认到 request。
- 不新增 liveness/startup、密钥/存储管理、自动扩缩容、日志采集、事件历史或自动公网入口。Pod 异常原因不是容器 stdout/stderr，也不承诺保留已删除 Pod。
- 关联 Service 是配置关系，不等于接口一定能访问；需结合 Pod 就绪和实际 HTTP 请求验证。只展示现有 Ingress API 支持的路由。
- 选择的仍是应用版本，不新增“服务应用”分类；用户需选择能持续运行的镜像/命令，短任务仍应使用 Flow。

## 依据与验收

这是 Kubernetes 常驻工作负载管理，不涉及 Kestra 通用工作流语义。参考 [Deployment](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)、[资源 requests/limits](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)、[健康探针](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)，保留 [Rancher 部署工作负载](https://ranchermanager.docs.rancher.com/how-to-guides/new-user-guides/kubernetes-resources-setup/workloads-and-pods/deploy-workloads) 的镜像/配置/资源/健康/访问职责区分，只取当前必需功能。

验收覆盖七类型及默认值、资源真实写入/编辑/清除和其它字段保留、原扩缩容、同标签异主 Pod 排除、失败退出原因、权限、真实 Service/Ingress 关联和跳转、窄屏、完整回归与 CEA 发布后只读核验。结果见 [验证记录](../verification/VER-UI-016-deployment-core.md)。
