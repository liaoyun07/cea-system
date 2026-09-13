# FILE-01 Pod 文件传输

状态：代码和测试完成，CEA新增基础设施授权待确认，尚未发布。依赖 S4 Job/Application、S5 FedAvg/FedProx、UI-06/07 产物读取。实际结果见[验证](../verification/VER-FILE-001-pod-artifacts.md)。

范围和架构决策见 [ADR-0023](../decisions/ADR-0023-pod-artifact-transfer.md)。

验收以真实 Job 输入、执行、输出完整闭环为准：边缘输出驻留边缘存储；下游 Pod 按 URI 直接读取；算法容器不包含 S3 密钥或文件计划；任一文件阶段失败不会产生成功 TaskRun；取消和 Worker 恢复不创建第二个算法 Job；历史中心产物仍可读取。不要求数据集迁移或中心网络中断时脱离 Executor 独立运行。

本批不改变界面、Flow、Binding、调度决策、算法 SDK、终端 Docker 文件搬运；不新增数据库表/列。
