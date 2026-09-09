# ADR-0004 S2 Worker与失败语义

2026-09-09。ACCEPTED：S2已实现，验证记录见文末。关联WF-007、WF-008。

参考本地Kestra提交0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4：core的WorkerTaskResult、TaskRunAttempt、AbstractRetry/Constant，worker的WorkerJobExecutor，executor的DefaultExecutor。官方[组件](https://kestra.io/docs/architecture/server-components)、[重试](https://kestra.io/docs/workflow-components/retries)、[恢复](https://kestra.io/docs/administrator-guide/server-lifecycle)、[错误处理](https://kestra.io/docs/workflow-components/errors)，2026-09-09核对。本地提交不自动等于当前发行版。

Executor拥有状态推进，Worker执行Runnable并回报结果；中断恢复不等于业务重试。S1事务内Log切为持久派发→事务外Worker→持久结果→Executor事务归并。S2有意简化为共享MySQL，新增一张WorkerJob表，不复制Kafka/WorkerGroup/SPI。

Job由TaskRun+Attempt定位，epoch只用于租约隔离；接管增加epoch不新增Attempt。Worker只修改Job/结果，不修改执行状态表；归并日志、状态、续消息同事务。数据库时间负责租约和延时，避免JVM时钟差。

只实现Log与Sleep；Sleep为真实延时任务及长任务取消验证。Constant maxAttempts包含首次。timeout按每Attempt派发开始（含排队）计算，不是算法时间。没有Flow重跑、Replay、指数重试、容器或跨站点Worker API。

MAIN→失败时ERRORS→FINALLY。失败不因处理器成功而变成功；Finally逐个尝试，主错误和清理错误分开。取消不重试MAIN/ERRORS、不跑剩余Errors，但仍跑Finally，清理保留自身重试/超时策略，这是明确的本项目策略，不声称等同Kestra全部取消路径。

S1升级须排空活动执行，迁移检查拒绝未排空；不引入S1执行兼容分支。删除FlowRevision只存取无判断的checksum，保留真实幂等request_hash。独立新后端库操作，不触及旧系统。

验收：真实MySQL的重复/过期结果、接管、持久重试、超时/取消、Errors/Finally；Worker JVM强杀后稳定Attempt恢复；S1回归与协议/Java索引同步。


## 实际参考位置及差异

本地源码根D:/Project/Kestra/kestra，上述提交中核对：

- core/src/main/java/io/kestra/core/runners/WorkerTaskResult.java：Worker结果载荷，不由Worker推进整个Execution。
- core/src/main/java/io/kestra/core/models/executions/TaskRunAttempt.java：TaskRun与尝试的生命周期分开。
- core/src/main/java/io/kestra/core/models/tasks/retrys/AbstractRetry.java、Constant.java：任务重试策略。
- core/src/main/java/io/kestra/core/models/flows/Flow.java：errors/finally为Flow定义能力。
- core/src/main/java/io/kestra/plugin/core/flow/Sleep.java：真实可中断RunnableTask延时，无业务输出。
- worker/src/main/java/io/kestra/worker/WorkerJobExecutor.java：任务执行与关闭处理，中断不简单作为业务失败。
- executor/src/main/java/io/kestra/executor/DefaultExecutor.java：结果驱动状态与失败处理。

本项目沿用职责与尝试语义，不声称字段/配置/所有取消路径兼容Kestra。下列差异都是当前阶段的有意简化，不是课题独有需求：

- 同库Job行负责租约与结果，没有Broker或WorkerGroup；支持分别启动的本地进程，不是远程Worker API。
- 只有顺序Log/Sleep与constant重试，maxAttempts明确包含首次，不直接照搬上游配置名或限制。
- timeout含Worker等待；这保证无人领取时也会结束，语义不同于只从代码运行开始计时。
- 取消保留清理与清理自身策略；主成功但清理失败单独标识，不覆盖原始错误。
- ExecutionReducer只抽出当前需要的纯决策，没有创建平行状态模型、通用插件接口或空Coordinator。

实现后主链已变为持久派发/事务外执行/归并，不再保留S1事务内Log分支。新增字段与真实消费者见[S2协议](../contracts/s2-protocol.md)，实际故障与回归结果见[验收](../verification/VER-S2-001-worker-lifecycle.md)。没有通用外部副作用exactly-once或生产容灾承诺。
