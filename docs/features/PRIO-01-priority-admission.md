# PRIO-01：非抢占任务优先级

状态：2026-09-17 已实现、验证并部署 CEA 前后端。申报书对应 A04。

当前改动允许流程作者为叶子任务设置 priority；资源满时任务在原队列等待，不长期占 Worker 执行名额。资源可用时，已就绪候选中高优先级先准入、同级 FIFO。依赖、动态循环、重试、取消、计量和 Runner 职责不变。

不是物理 CPU/内存调度、抢占式调度、DQN 改造或防饥饿算法。没有新增 Executor/Worker/任务队列表。

验收：优先级与 FIFO、依赖先于优先级、跨 Worker 准入协调、满载不堵其他任务、原 Attempt/deadline 保持、等待取消/超时、同 Attempt 恢复；前端字段与 YAML 往返；真实容器及联邦两轮回归；CEA 前后端发布和既有历史保留。

实际结果：275 项 Java、54 项前端单测、60 项浏览器测试通过；CEA 页面编辑/YAML同步、V28迁移及原数据保留通过；FedAvg/FedProx各两轮、22个真实Job与独立数值核验通过。没有改已有Flow修订或算法镜像。

详见 [协议与前后调用链](../contracts/priority-admission.md)、[决策](../decisions/ADR-0029-priority-admission.md)、[验收记录](../verification/VER-PRIO-01-priority-admission.md)。
