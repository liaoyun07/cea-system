# PRIO-01：任务优先级与资源准入

`Task.priority` 是可选整数，0..100，省略为 0，数值越大越先领取。只允许可执行叶子任务（Log/Sleep/Http/Sql/Application）；控制节点不支持。No-code 编辑同一字段，不引入第二套调度配置。

```yaml
tasks:
  - id: parallel
    type: core.Parallel
    tasks:
      - {id: normal, type: core.Log, priority: 10, message: normal}
      - {id: urgent, type: core.Log, priority: 90, message: urgent}
```

示例只有两个任务都已就绪且尚未领取时，urgent 才优先领取；不是按名称排序，也不等待未来的高优先级任务。若 urgent 依赖 normal，仍须先完成 normal。LOCK-01 后检查可以并行，领取顺序不等于检查完成、占槽或任务完成顺序。

## 调用链和职责

```text
原：Executor 判定依赖就绪 → 原 Worker 队列 → 占 Worker 执行名额
    → ApplicationTaskRunner 循环等 Placement 槽 → 镜像/文件准备 → Runner → 结果

现（LOCK-01）：Executor 判定依赖就绪 → 原 Worker 队列（priority 降序，同级入队序号升序）
    → WorkerPump 在原 concurrency 内并行调用 WorkerEngine.runOnce
    → admitNext → TaskRunner.admit → ApplicationTaskRunner → Placement 尝试预约
       ├─ 无槽：原记录回 READY，本次扫描继续其他任务；扫描结束归还 Worker 名额
       └─ 有槽：在同一个 Worker 名额内执行原镜像/文件准备 → 原 Runner
    → 原结果回收、资源释放、Executor 状态推进
```

- runtime 只认识准入是否成功，不认识集群、数据集、终端或 DQN。TaskRunner 默认准入放行，Application 实现资源适配。
- Placement 继续拥有合法位置选择和资源预约。这里的资源是现有平台 Job 槽，不新增 CPU/内存物理资源预算。
- WorkerPump 的名额覆盖检查和执行，避免无界并发外部查询。槽满后立即 defer，不持续等待槽位，等待者保留持久队列记录；一次扫描结束归还名额。
- 队列表短期 RUNNING 是领取租约，不等同于容器正在计算；无槽后恢复 READY。TaskRun 的原派发状态/开始时间不改，不新增 WAITING 状态，也不改变 SDK 算法计时。
- 准入阶段读取契约/Binding、数据本地性、健康及槽位；镜像复制、文件传输、容器运行在准入完成后。终端元数据检查及首次卸载决策仍在原适配器中。
- 不再使用全局数据库会话锁。领取通过短事务行锁和租约保护；槽位通过既有资源事务保护。外部查询不持这些锁；同一 Worker 也能同时检查多个任务。不再提供全局串行准入完成次序。

## 不改变的语义

1. 非抢占：已经准入的低优先级任务继续执行；不为未就绪任务保留资源。
2. 同级按 FIFO 优先领取：使用稳定入队序号，不使用可变租约时间；等待后再领取不会排到队尾。已被其他线程领取的行会跳过，并发检查可以先后颠倒；不同候选资源范围允许跳过满载任务。
3. 等待保留同一 Attempt、入队序号及 deadline。原 timeout 仍包含等待；不自动延长，不把资源不足算 retry。
4. 取消清理、失租恢复优先于新业务任务。未产生 Pod 的取消仍确认并释放预约；已有 prepared_json 的同 Attempt 恢复沿原计划执行。
5. 终端原预约队列保持 FIFO，DQN 仍每 Attempt 固定一次选层；本批不改 DQN 策略。
6. 不承诺无限高优先级流量下的防饥饿或强实时保证，不引入 aging、抢占、优先级继承。

## 持久化与兼容

V28 在原 `wf_worker_job` 增加 `priority`（领取排序消费者）和 `enqueue_order`（稳定 FIFO 消费者），不新增业务表/状态。旧 Flow 缺省 priority=0，无需改修订。发布先确认无活动执行并备份数据库，迁移拒绝活动执行；历史定义/结果不改。纯 `TaskRunner.run` 不负责等待资源，Worker 必须先调用 `admit` 或恢复既有 prepared 计划。

原设计见 [ADR-0029](../decisions/ADR-0029-priority-admission.md)，LOCK-01 简化见 [ADR-0030](../decisions/ADR-0030-bounded-parallel-admission.md)。
