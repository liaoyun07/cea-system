# UI-18 Service 选择目标部署

## 当前范围

Service 创建页面不再提供 Pod Selector 键值编辑，而是选择当前集群、当前 Kubernetes Namespace 中已有的平台托管部署。名称、类型、端口仍独立填写；可为同一部署创建多个 Service，不将镜像或应用版本当成 Service 的唯一身份。

从部署详情“配置访问入口”进入，预选该集群、Namespace、部署，并以部署名预填 Service 名称（可以修改）。直接创建 Service 时必须主动选择目标部署；切换集群或 Namespace 清空原选择。没有部署时提示先创建部署并禁止提交，不伪造可用对象。

提交时读取所选部署 runtime 的真实 selector，原样作为 ServiceRequest.selector 提交。不会根据名称自行拼标签，不依赖跳转时保存的标签快照；读取失败或部署已不存在时停止提交。底层工作空间、owner、deployment 等条件均保留，只是不展示为普通编辑项。部署为零副本也可配置 Service，当前无就绪 Pod 不等于部署不存在。

## 调用链与边界

前端读取同 Namespace 的 deployments 列表 → 选择目标 → GET deployments/{name}/runtime → POST services（真实 selector＋端口）。后端 Service 创建仍按现有 KubernetesManagementService 写 Kubernetes；原部署标签、Service API、权限、删除规则和已有资源不变。

仅修改 KubernetesManagement.vue 与 DeploymentsPage.vue 的前端交互。无新增生产 Java 类、API、数据库字段/表、权限、后端服务或持久化绑定；选择目标部署是生成 Kubernetes Service selector 的便捷入口，不是新的绑定状态。不影响普通 Flow，亦不涉及 Kestra 工作流语义。

本次不增加自定义 Pod 标签管理、任意 Selector 高级编辑、跨多个部署的选择器配置或自动修改已有 Service。既有 API 消费者仍可按原协议提交 selector。

## 验收

默认入口与部署详情预填、隐藏 Selector、Namespace 同名部署与列表范围、切换后清空、多个 Service 指向同一部署、真实 Pod 关联、空列表不能创建、读取失败与目标删除后不提交、错误恢复及桌面/窄屏。见 [验证记录](../verification/VER-UI-018-service-target.md)。
