# ADR-0030：有界并行准入与短事务

2026-10-14，LOCK-01。用户要求简化锁，不为当前单后端运行环境维持昂贵的全局准入串行化。替代 ADR-0029 中的数据库会话锁与严格准入完成顺序，不删除任务所有权和槽位正确性保护。

## 选择

1. WorkerPump 用原有 concurrency 限制准入加执行的在途工作数量；在虚拟线程中调用 WorkerEngine.runOnce。无资源任务仍退回 READY，扫描其它就绪任务，不在槽满处等待；本轮扫描结束释放 Worker 名额。
2. 删除 JdbcWorkerStore 的 GET_LOCK/RELEASE_LOCK 以及独立占用连接。任务领取沿用短事务 FOR UPDATE SKIP LOCKED 和租约，资源预约沿用既有短事务。
3. WorkloadLedger 分开 snapshot（无锁采样）与 accept（仅数据库登记）。网关调用及推理在两者之间完成，不占资源行锁或事务连接。accept 仍按固定顺序短暂锁资源行，使决策记录、s→s' 链和工作量登记一起提交；不引入锁表或新的分布式协调组件。
4. 并发决策可能看到相同或略滞后的已提交负载，状态是采样而不是严格串行的预约前状态；最终槽位预约仍原子检查。样本后继保持同类决策登记顺序，不等同任务完成顺序。
5. priority/FIFO 是领取优先级，不保证外部检查完成、获得资源或任务结束的全局次序。依赖、非抢占、Attempt/deadline、终端资源边界 FIFO、已有执行恢复均保留。

## 参考与边界

已阅读本地 Kestra 0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4：`worker-controller/.../WorkerJobDispatcher.java`（可用 permits 与派发职责）、`core/.../QueueSubscription.java`（容量归属）、`worker/.../AbstractWorker.java`（有界在途工作）。不声称与其完整实现相同。本项目有意沿用现有 JDBC 队列与 Worker，不移植 Controller、Worker Groups、缓冲队列或多实例高可用机制。

无新增生产类、配置、数据库字段/表或 HTTP API。Resource 仍拥有资源状态，Offloading 仍拥有决策样本；runtime 不依赖业务模块。测试与发布结果见 [LOCK-01](../verification/VER-LOCK-01.md)。
