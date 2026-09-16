# ADR-0029：非抢占优先级与 Worker 资源准入

状态：已实施并部署（PRIO-01，2026-09-17）。

用户授权：可执行子任务 priority 0..100（省略为 0），同级 FIFO；无资源留在原队列，不长期占 Worker 执行名额。依赖、Attempt、超时、容器执行及算法计量不改。

参考 Kestra 本地 0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4 的 `worker-controller/.../WorkerJobDispatcher.java`（容量预约后派发）与 `core/.../QueueSubscription.java`。本项目有意用现有 JDBC 队列加排序，不复制企业版 Worker Groups/容量分组；集群平台槽位是本项目业务资源，不等同 Kestra Worker permits。

WorkerEngine 在 TaskRunner.admit 中短租约检查资源，不占执行并发名额；返回 null 仅表示未获资源，原记录回到 READY，保留 Attempt、deadline 和入队序号。本次扫描跳过已检查且无资源的任务，继续其他候选。准入成功后的 continuation 才由 WorkerPump 占执行名额并运行，镜像/文件准备不在准入中。

多个 Worker 进程使用 MySQL 会话级命名锁串行协调短准入阶段（独立连接、非长数据库事务）；锁名包含当前数据库。既有 Worker 行租约保护任务所有权，既有 Resource 事务保护槽位。锁不覆盖镜像、传输、运行。进程中断后会话锁释放，任务租约过期后接管同 Attempt、复用已预约位置。取消及过期租约恢复先于新业务优先级，避免清理/恢复被低优先级饿死。普通 READY 任务同级 FIFO，持续高优先级到来不承诺低优先级最大等待时间。

新增 wf_worker_job.priority、enqueue_order，分别由候选排序和同级 FIFO 消费；不新增任务表/执行状态机。TaskRunner 增加默认准入方法，非资源任务直接放行；ApplicationTaskRunner 分出资源准入，终端沿用已有 FIFO、卸载沿用每 Attempt 的固定决策。新增 priority 仅允许 runnable，不允许控制节点。

取消、超时仍走原结果确认；资源不足不是业务失败，不能消耗 retry。发布需排空活动执行、备份 DB，只升级 CEA 前后端，保留其余服务、业务定义及历史。
