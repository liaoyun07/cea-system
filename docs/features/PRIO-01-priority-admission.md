# PRIO-01：非抢占任务优先级

状态：2026-09-17 已实现、验证并部署 CEA 前后端。申报书对应 A04。

当前允许流程作者为叶子任务设置 priority；资源满时任务在原队列等待，不长期占 Worker 名额。LOCK-01 后已就绪候选按优先级/FIFO领取，准入检查与执行在同一有界并发额度中运行；检查/占槽完成顺序不再全局串行。依赖、动态循环、重试、取消、计量和 Runner 职责不变。

LOCK-01（2026-10-14）：移除全局会话锁与持锁网络调用，保留任务租约和资源登记短事务；验证/发布状态见 [记录](../verification/VER-LOCK-01.md)。下方 2026-09-17 及 PRIO-02 数值是旧实现的历史验证，不是新并发准入的性能结果。

不是物理 CPU/内存调度、抢占式调度、DQN 改造或防饥饿算法。没有新增 Executor/Worker/任务队列表。

验收：优先级与 FIFO、依赖先于优先级、跨 Worker 准入协调、满载不堵其他任务、原 Attempt/deadline 保持、等待取消/超时、同 Attempt 恢复；前端字段与 YAML 往返；真实容器及联邦两轮回归；CEA 前后端发布和既有历史保留。

实际结果：275 项 Java、54 项前端单测、60 项浏览器测试通过；CEA 页面编辑/YAML同步、V28迁移及原数据保留通过；FedAvg/FedProx各两轮、22个真实Job与独立数值核验通过。没有改已有Flow修订或算法镜像。

PRIO-02补充：CEA双流程/四Job实测中，low先入队、high先获释放槽位，运行中的B不被抢占；任务均成功且资源释放。[真实容器时间和验证](../verification/VER-PRIO-02-live-priority.md)。

详见 [协议与前后调用链](../contracts/priority-admission.md)、[决策](../decisions/ADR-0029-priority-admission.md)、[验收记录](../verification/VER-PRIO-01-priority-admission.md)。
