# FILE-01 Pod 文件传输

FLPAR-11（2026-09-16，DONE/PASS，已部署）：修复先创建 Pod、后准备文件 Secret 的挂载竞争；沿原 Runner 实现挂起 Job → owned Secret → 解除挂起。新增真实 K3s 测试验证授权失败不启动 Pod、同 UID 恢复、准备中取消不启动且清理授权；不改变文件助手或终端路径。CEA 四个 Docker 化 K3s 另按节点隔离 cgroup-root，避免 kubelet 清理外集群 Pod。264项Java回归、156 Job/SDK和80模型核验通过，四次启动Warning为0；18客户端正式约51～53秒、主容器峰11～14，算法峰5～7，未达18路同时计算。[记录](../verification/VER-FLPAR-11-startup.md)。

状态：DONE，2026-09-13已按授权发布CEA并通过现场验收。依赖 S4 Job/Application、S5 FedAvg/FedProx、UI-06/07 产物读取。现场两算法各两轮/11个Job、边缘模型驻留与跨存储聚合、独立数值及历史读取均PASS，实际结果见[验证](../verification/VER-FILE-001-pod-artifacts.md)。

范围和架构决策见 [ADR-0023](../decisions/ADR-0023-pod-artifact-transfer.md)。

验收以真实 Job 输入、执行、输出完整闭环为准：边缘输出驻留边缘存储；下游 Pod 按 URI 直接读取；算法容器不包含 S3 密钥或文件计划；任一文件阶段失败不会产生成功 TaskRun；取消和 Worker 恢复不创建第二个算法 Job；历史中心产物仍可读取。不要求数据集迁移或中心网络中断时脱离 Executor 独立运行。

本批不改变界面、Flow、Binding、调度决策、算法 SDK、终端 Docker 文件搬运；不新增数据库表/列。
