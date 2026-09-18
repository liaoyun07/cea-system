# DEV-01 IDEA 本地连接 CEA

用户授权新增本机转发与Linux工具两个辅助容器，并允许切换时停止原Docker后端、调整网关地址。目标是Windows IDEA运行现有前后端，复用原CEA真实数据与运行环境。

不修改业务执行链：本地前端→本地Java→原MySQL/Registry/Kubernetes/MinIO；执行仍由原Executor/Worker/Placement/文件助手完成。网关回连地址随local/docker模式切换。普通工作流、终端卸载和应用契约没有新增语义。

配置复用原Registry `api-url` 和存储 `endpoint/transfer-endpoint` 区分，不修改镜像身份和Pod网络地址；只替换本地API连接和凭据路径。镜像操作通过已有可配置command调用Docker内skopeo/buildctl。新增的是运维脚本及两份生成式IDEA启动配置，无Java类、数据库字段/表、HTTP接口或权限新增。

切换前检查现有活动执行；测试阶段先禁用第二实例的Executor/Worker/Scheduler做只读连接检查，随后停止原实例再启用本地执行角色。恢复前要求停止本地后端。文件和密码保存在忽略目录，不纳入Git；不自动迁移、重置或删除现有资源。

[操作说明](../../deploy/cea/idea/README.md)、[实际验证](../verification/VER-DEV-001-idea-local.md)。本批为启动配置，不改变通用工作流语义，不涉及Kestra执行设计变更。

DEV-01a：追加IDEA原生Compound“一键启动”，只组合已有前后端；后端Make之后用RunConfigurationTask调用有限时长的npm prepare:local，准备失败不启动Java。恢复Docker也提供独立npm按钮。不是将持续运行的前端作为阻塞前置任务；未新增基础设施、常驻启动器或业务逻辑。
