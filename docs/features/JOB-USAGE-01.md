# JOB-USAGE-01：普通 Job 资源记账

## 范围与口径

统一执行器注入静态采集程序，不改算法镜像，不要求业务代码上报。每次 Attempt 的 Kubernetes Job 保存 files-in、task、files-out 三个容器的摘要；失败重试分别记账，流程汇总包含失败尝试及后处理。

- CPU：当前容器 cgroup v2 `cpu.stat/usage_usec` 的最后累计值，换算核秒。包括采集程序自身，截止最终读取，不包含其最后写报告/退出的极短尾部。
- 内存：`max(0, memory.current - memory.stat.inactive_file)` 工作集，每100毫秒及首尾采样，梯形积分得到字节秒。峰值为采样峰值，不是内核 lifetime peak；不把各容器峰值相加当系统峰值。
- 流程内存成本：三个容器、所有 Job/重试的积分之和，单位 GiB·s。
- 流程平均内存：总积分除以流程开始至所有任务（含 afterExecution）结束的墙钟窗口。并行任务时间重合不重复计算分母。

这是该流程 Job 容器的消耗，不是整台机器或整个协作系统的消耗；不包括共享数据库、对象存储、K3s控制面等。历史执行不能补采；cgroup不可读、强杀/OOM丢报告、旧助手镜像等情况下明确显示缺失，不填0。不能用此功能本身证明两种算法降低资源25%，还需相同数据/准确率目标的对照实验。

## 调用链

KubernetesJobRunner创建Job → files-in复制公共助手镜像内的静态二进制到既有emptyDir → 三容器由采集程序运行原命令 → 子进程结束写termination message → Worker读取Pod.status → WorkerJob.Result → Executor原结果事务 → wf_task_attempt.resource_usage_json → 查询时汇总。

采样不调用Kubernetes API、不访问数据库、不落逐点文件；只在结束时新增约数百字节报告和一次Attempt更新。沿用原Pod查询权限，无特权采集/节点挂载/新服务。助手镜像通过多阶段Go构建；算法镜像只须满足原有Linux `/bin/sh` 执行约定，当前部署为linux/amd64、cgroup v2。

## 设计依据与边界

参考本地Kestra提交 `0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4`：`core/src/main/java/io/kestra/core/models/executions/MetricEntry.java` 将指标关联Execution/TaskRun，`core/src/main/java/io/kestra/core/runners/DefaultRunContext.java` 的metric入口负责运行时收集。本次有意简化为固定资源摘要随现有Worker结果返回，不引入通用指标消息总线；执行状态仍由Executor拥有。

Pod termination message默认路径/dev/termination-log，使用Kubernetes原生状态接口读取。files-in原有transfers字段保持；每容器摘要限制在3500字节内。失去整个容器或节点时不能保证最终报告，与独立节点监控不等价。部署前已有Job不改模板，旧助手继续运行但无采集报告。

依据：[Kubernetes termination message](https://kubernetes.io/docs/tasks/debug/debug-application/determine-reason-pod-failure/)、[Linux cgroup v2](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html)。

接口与数据见[协议](../contracts/job-resource-usage.md)，实际状态见[验证](../verification/VER-JOB-USAGE-01.md)。本批不改前端、不重跑联邦/DQN对照。
