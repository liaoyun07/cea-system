# 当前协议入口

- [UI-06 JSON输出读取](../features/UI-06-execution-metrics.md)：新增GET tasks/{taskRunId}/output-json?port，仅成功实例的声明产物，READ授权/精确地址/256KiB/单JSON对象。当前HTTP操作总数52，record/表不变；OpenAPI同步。

- [UI-01独立前端](ui-console.md)：通过现有API完成源编辑、固定修订执行、日志与结果；无新HTTP操作或旧DTO适配。

- [S6-02至04文件与生命周期](s6-files-lifecycle.md)：小型文本固定修订/真实容器消费、认证Webhook、统一Checks、maxDuration告警及原执行链终态后处理。

- [S6-01编辑与流程管理](s6-flow-editing.md)：统一结构Schema、无副作用校验/输入预览、原子导入、源导出和USER搜索；不等于完整No-code前端。

- [S5-04b终端卸载](s5-terminal-offloading.md)：显式offload、单步Q/规则、模型/观测API、终端FIFO及配置升级；不包含计量SDK。

- [S5-04a终端Docker](s5-terminal-docker.md)：同一Application的终端执行、可信来源、Docker context和文件/取消；不是完整卸载DQN。

- [S5-02b Loop、ITEM和集合文件](s5-loop.md)：复用同一Binding与执行链，有界动态实例、显式有序输出、动态candidateClusters。

当前为S3执行协议及S4资源/应用目录、镜像/部署、Job/产物和通用任务协议；S1文档保留历史语义，S2叶子与失败语义仍适用，但顺序游标/单Worker串行已由S3替代，远程取消须等待停止的增量语义以S4协议为准。

- [OpenAPI 3.1](openapi.json)：52个HTTP操作（S6增加编辑/文件/生命周期接口，UI-06增加1个JSON输出读取）；没有自动Flow Input派生或第二套绑定接口，字段以此为准。
- [S4-02a应用契约目录](s4-application-catalog.md)：版本、类型/默认值/choices、数据集允许范围；目录本身不派生Flow Inputs或启动任务，真实执行见下方S4-03协议。
- [S4-01资源目录](s4-resource-catalog.md)：集群/数据集版本/位置、权限、候选拒绝原因与当前边界。
- [S3控制流与调度](s3-protocol.md)：嵌套控制、DAG/If、准入FIFO、Schedule、字段消费者和锁顺序。
- [S2持久Worker与失败语义](s2-protocol.md)：当前状态、角色、租约、重试、取消、Errors/Finally、字段消费者。
- [S1历史协议](s1-protocol.md)：输入/Binding基础语义仍适用，事务内Log/单Attempt/checksum已被S2替代。
- [S1基本示例](../../examples/s1-log-flow.yaml) / [S2重试与清理示例](../../examples/s2-retry-cleanup.yaml)。
- [S3示例](../../examples/s3-control-flow.yaml) / [S3规格](../features/WF-009-011-s3.md) / [S3决策](../decisions/ADR-0005-s3-control-flow.md)。
- [S2规格](../features/WF-007-008-s2.md) / [决策](../decisions/ADR-0004-s2-worker-lifecycle.md)。

没有公开Worker HTTP API，当前Worker共享数据库及应用版本。S4远程依赖分别使用Registry认证、Kubernetes凭据/RBAC及S3/HTTP/SQL外置凭据；终端Docker连接配置由管理员提供，不能把本地Basic当作所有内部通信鉴权。数据库以V1–V17迁移为准；ContractTest检查路由、58个record字段映射、引用和示例，不是完整OpenAPI规范验证器。

S4-02b/c增加真实镜像复制及常驻Deployment链，与Execution主链分离，见[镜像/部署协议](s4-image-deployment.md)。本批真实Job/通用任务与部署验收状态见进度，不把镜像准备成功当作Flow运行成功。

- [S4-03 Job/显式文件协议](s4-job-execution.md)
- [S4-04 HTTP/SQL/隔离脚本](s4-common-tasks.md)
- [S4最小部署与故障处理](../operations/s4-minimal-deployment.md)
- [S5-01 Repeat轮次与反馈](s5-repeat.md)：新增Repeat配置和TaskRun轮次字段；没有新路由或Binding来源。
- [S5-02联邦学习文件契约与使用](../../algorithms/federated/README.md)：两个显式Flow、五个应用角色契约，复用上述API，没有新HTTP操作；后续Loop字段见下方。

## S5-03接入补充

[网关/终端与策略协议](s5-edge-access.md)：CONNECT身份、管理范围隔离、统一提交与正常结果查询；不包含离线恢复。完整路由与record继续维护在[OpenAPI](openapi.json)。
