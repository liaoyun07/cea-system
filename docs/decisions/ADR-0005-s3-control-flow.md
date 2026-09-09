# ADR-0005 S3控制流、并发准入与定时触发

2026-09-09，ACCEPTED，已按本决策实施并验收，见[验证记录](../verification/VER-S3-001-control-scheduling.md)。用户授权范围WF-009/010/011，不启动S4或生产保障扩展。

## 来源与取舍

核对本地Kestra提交0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4，仓库D:/Project/Kestra/kestra，重点来源：

- core/src/main/java/io/kestra/plugin/core/flow/{Dag,Parallel,If,Sequential}.java：同组依赖、控制任务解释和If选择保存。
- core/src/main/java/io/kestra/core/models/flows/Concurrency.java：Flow并发及QUEUE/FAIL概念。
- core/src/main/java/io/kestra/plugin/core/trigger/Schedule.java：Cron/时区、漏触发的显式策略。
- executor/src/main/java/io/kestra/executor/ConcurrencySlotReleaseProcessor.java：执行结束后的额度释放职责；本阶段不复制其消息处理器拆分。

不是声称本地checkout是上游最新。Cron解析复用[Spring官方CronExpression](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/scheduling/support/CronExpression.html)，依赖由既有Boot BOM管理。

沿用Flowable控制节点由Executor解释、Runnable由Worker执行、If选择只求值一次、Flow并发QUEUE/FAIL与定时生成普通Execution的职责。不是复制上游代码/配置协议。当前有意简化：只有根errors/finally、任务级固定重试、单Flow并发域、每Flow一个Schedule，不支持控制节点重试/超时、动态子流程或嵌套错误处理。

## 执行语义

- 根tasks顺序执行；core.Sequential/Parallel/Dag/If可嵌套。Dag子任务通过dependsOn引用同组兄弟，不依赖定义顺序；环、缺失/跨组引用保存时拒绝。所有任务ID全Flow唯一。
- 控制节点有TaskRun但不创建WorkerJob或Attempt；If的布尔evaluationResult写TaskRun输出后才启动分支，未选分支SKIPPED。条件仅接受true/false文本，避免隐式真值误选。
- 并行/Dag某子任务失败耗尽后，停止启动该组未开始任务，允许正在运行的兄弟及其既定重试完成，再进入根Errors/Finally。Finally根列表逐项尝试，保留原始error和首个cleanupError。
- 所有运行状态仍由同一个Executor事务更新。取消清除MAIN/ERRORS活跃Job、终止重试、跳过未开始节点；FINALLY不重新执行，仍有其自己的策略。
- 移除只适用于顺序列表的next_task游标，不保留S2执行器兼容分支。S3停机升级前必须排空活动执行，保留历史。

## 并发与队列

同namespace/flowId跨版本共用准入锁和最新保存的limit；未配置表示不限制。CREATED/RUNNING/KILLING占槽，直到Finally结束；QUEUED不占槽。以数据库递增sequence_no FIFO准入，限制降低不杀活跃任务，后续等待释放。QUEUE持久排队；FAIL立即生成可查询的失败Execution且不启动任务/清理。排队期间取消直接KILLED，无Attempt或清理。已有提交幂等逻辑保留。

新增runtime所有的wf_flow_control稳定锁/并发配置行与wf_schedule定时游标行。数据库锁顺序统一为Flow锁→Schedule或Message→Execution，防止释放/取消/触发交错死锁。用已有运行状态计算占槽，不再维护一份计数器。

## Schedule

保存定义与同步runtime并发/Schedule配置同一事务，跨模块只通过公开应用服务。启用Schedule的保存者须拥有EXECUTE；定时执行记录该授权主体，不能由请求伪造身份。Schedule使用Spring CronExpression的六字段含秒语法、显式时区（默认UTC）、静态inputs、disabled。不是Kestra五字段协议兼容。

游标next_fire与Execution/消息在同一MySQL事务提交，双Scheduler竞争不能创建两次。重启将已持久的到期点执行一次，之后从当前数据库时间计算下一点，不逐次补发全部错过时刻。编辑不变的Schedule不重置游标；修改/重新启用从当前时间起算，disabled或删除停触发，既有执行不撤销。此阶段不提供backfill。

上述字段均服务当前准入/触发判断；不增加无消费者hash、通用SPI、Broker、WorkerGroup或第二份状态机。P10后置不取消这些核心队列能力。验收以实际测试和协议为准，不以类名或本ADR代替证据。
