# 当前协议入口

当前为S3执行协议、S4-01资源目录及S4-02a应用契约/参数绑定；S1文档保留历史语义，S2叶子与失败语义仍适用，但顺序游标/单Worker串行已由S3替代。

- [OpenAPI 3.1](openapi.json)：24个HTTP操作，S4-02a新增3个应用目录及2个参数绑定操作；字段以此为准。
- [S4-02a应用契约/绑定](s4-application-binding.md)：数据集允许范围、显式别名、固定值、默认值冲突和类型/允许值约束；尚未部署执行。
- [S4-01资源目录](s4-resource-catalog.md)：集群/数据集版本/位置、权限、候选拒绝原因与当前边界。
- [S3控制流与调度](s3-protocol.md)：嵌套控制、DAG/If、准入FIFO、Schedule、字段消费者和锁顺序。
- [S2持久Worker与失败语义](s2-protocol.md)：当前状态、角色、租约、重试、取消、Errors/Finally、字段消费者。
- [S1历史协议](s1-protocol.md)：输入/Binding基础语义仍适用，事务内Log/单Attempt/checksum已被S2替代。
- [S1基本示例](../../examples/s1-log-flow.yaml) / [S2重试与清理示例](../../examples/s2-retry-cleanup.yaml)。
- [S3示例](../../examples/s3-control-flow.yaml) / [S3规格](../features/WF-009-011-s3.md) / [S3决策](../decisions/ADR-0005-s3-control-flow.md)。
- [S2规格](../features/WF-007-008-s2.md) / [决策](../decisions/ADR-0004-s2-worker-lifecycle.md)。

没有公开Worker HTTP API，当前Worker共享数据库及应用版本。不能把本地Basic当作S4内部通信鉴权。数据库以V1–V7迁移为准；ContractTest检查路由、33个record字段映射、引用和示例，不是完整OpenAPI规范验证器。
