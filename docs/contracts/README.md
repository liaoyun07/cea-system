# 当前协议入口

- [S5-02b Loop、ITEM和集合文件](s5-loop.md)：复用同一Binding与执行链，有界动态实例、显式有序输出、动态candidateClusters。

当前为S3执行协议及S4资源/应用目录、镜像/部署、Job/产物和通用任务协议；S1文档保留历史语义，S2叶子与失败语义仍适用，但顺序游标/单Worker串行已由S3替代，远程取消须等待停止的增量语义以S4协议为准。

- [OpenAPI 3.1](openapi.json)：27个HTTP操作，含3个应用目录、1个镜像准备、4个常驻部署操作；没有自动派生/解析接口，字段以此为准。
- [S4-02a应用契约目录](s4-application-catalog.md)：版本、类型/默认值/choices、数据集允许范围；目录本身不派生Flow Inputs或启动任务，真实执行见下方S4-03协议。
- [S4-01资源目录](s4-resource-catalog.md)：集群/数据集版本/位置、权限、候选拒绝原因与当前边界。
- [S3控制流与调度](s3-protocol.md)：嵌套控制、DAG/If、准入FIFO、Schedule、字段消费者和锁顺序。
- [S2持久Worker与失败语义](s2-protocol.md)：当前状态、角色、租约、重试、取消、Errors/Finally、字段消费者。
- [S1历史协议](s1-protocol.md)：输入/Binding基础语义仍适用，事务内Log/单Attempt/checksum已被S2替代。
- [S1基本示例](../../examples/s1-log-flow.yaml) / [S2重试与清理示例](../../examples/s2-retry-cleanup.yaml)。
- [S3示例](../../examples/s3-control-flow.yaml) / [S3规格](../features/WF-009-011-s3.md) / [S3决策](../decisions/ADR-0005-s3-control-flow.md)。
- [S2规格](../features/WF-007-008-s2.md) / [决策](../decisions/ADR-0004-s2-worker-lifecycle.md)。

没有公开Worker HTTP API，当前Worker共享数据库及应用版本。S4远程依赖分别使用Registry认证、Kubernetes凭据/RBAC及S3/HTTP/SQL外置凭据，不能把本地Basic当作所有内部通信鉴权。数据库以V1–V11迁移为准；ContractTest检查路由、35个record字段映射、引用和示例，不是完整OpenAPI规范验证器。

S4-02b/c增加真实镜像复制及常驻Deployment链，与Execution主链分离，见[镜像/部署协议](s4-image-deployment.md)。本批真实Job/通用任务与部署验收状态见进度，不把镜像准备成功当作Flow运行成功。

- [S4-03 Job/显式文件协议](s4-job-execution.md)
- [S4-04 HTTP/SQL/隔离脚本](s4-common-tasks.md)
- [S4最小部署与故障处理](../operations/s4-minimal-deployment.md)
- [S5-01 Repeat轮次与反馈](s5-repeat.md)：新增Repeat配置和TaskRun轮次字段；没有新路由或Binding来源。
- [S5-02联邦学习文件契约与使用](../../algorithms/federated/README.md)：两个显式Flow、五个应用角色契约，复用上述API，没有新HTTP操作；后续Loop字段见下方。
