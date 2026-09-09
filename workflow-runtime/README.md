# workflow-runtime

职责：通用工作流执行内核。

已实现统一定义/绑定、Executor控制树（Sequential/Parallel/Dag/If）推进、独立Worker的Log/Sleep、租约恢复、重试/超时/取消及Errors/Finally。拥有wf_execution、wf_task_run、wf_task_attempt、wf_message、wf_log、wf_worker_job、wf_flow_control、wf_schedule。Worker只操作工作/结果表，Executor才归并运行状态；见[S2叶子协议](../docs/contracts/s2-protocol.md)与[S3控制/调度协议](../docs/contracts/s3-protocol.md)。Flow并发准入/FIFO和单Flow Cron已实现；复用Spring CronExpression，不自写日期算法。无其他项目模块依赖；不依赖任何platform业务模型。

- [模块边界与 Java 文件索引](../docs/01-code-architecture.md)
- [功能索引](../docs/02-feature-index.md)
- [当前进度](../docs/04-progress.md)

依赖：无其他项目模块。实际调用及依赖约束以Java索引为准。
