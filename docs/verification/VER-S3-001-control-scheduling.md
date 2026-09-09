# VER-S3-001 控制流、准入与Schedule验收

2026-09-09，PASS。关联WF-009/010/011、S3-01至S3-04，以及全部S1/S2回归；不包含S4及生产保障扩展。

## 环境与输入快照

- Windows11、PowerShell；统一脚本使用Windows PowerShell5.1。JDK21.0.7位于D:/IDE/IntelliJ IDEA 2025.1.3/jbr，Maven3.8.8位于D:/developevn/maven。没有修改全局Java8或旧工程环境。
- Spring Boot4.1.1、Jackson3、Pebble3.2.4、Flyway、ArchUnit1.4.1、Testcontainers1.21.4。S3在runtime增加spring-context直接依赖，只为复用CronExpression，版本沿用Boot BOM；没有新增项目模块或消息代理。
- Docker Desktop29.5.3，Testcontainers MySQL8.0.46，缓存mysql:8.0的digest为sha256:7dcddc01f13bab2f15cde676d44d01f61fc9f99fe7785e86196dfc07d358ae2b。
- 每轮创建独立backend_s1_test库；s2_upgrade_test、s3_upgrade_test只位于本轮一次性容器，用于故意失败的升级检查。没有连接旧gateway业务数据库。
- backend独立Git仓库尚无提交号，未暂存/提交/推送；[70份构建输入SHA256快照](S3-source-sha256.md)定位本次验收源码。文档哈希不加入业务模型。Kestra参考提交及来源见[ADR-0005](../decisions/ADR-0005-s3-control-flow.md)。

## 最终实际结果

统一scripts/verify.ps1于2026-09-09 16:26:40 +08:00退出0，Maven总耗时约79秒；父工程和8模块均SUCCESS，Boot可执行JAR打包成功。Surefire XML逐项核对：

| 测试类 | 数量 | 结果 |
|---|---:|---|
| DefinitionTest | 10 | PASS |
| LifecycleTest | 3 | PASS |
| ControlFlowTest | 6 | PASS |
| DurableWorkflowTest | 52 | PASS，72.483秒，真实MySQL |
| ContractTest | 3 | PASS |
| ArchitectureTest | 1 | PASS |
| 合计 | 75 | 0失败、0错误、0跳过 |

结构检查：8模块、无依赖环、43个生产Java索引、30功能编号；文档收尾后复验136个本地链接和70份源码SHA256，均通过。测试结束后检查没有本次Testcontainers容器或测试BackendApplication子JVM残留。仅结束测试启动的子进程，没有停止用户IDEA服务。

## S3专项覆盖

| 范围 | 真实验收行为与测试入口 |
|---|---|
| 定义校验 | ControlFlowTest：乱序DAG接受；依赖缺失/自环/重复/环/非同组拒绝；分支全局ID、控制任务字段/空组/缺类型校验；并发额度、Cron六字段/时区/静态输入及变量环 |
| DAG运行 | reversedDagDispatchesBothBranchesBeforeJoin：join在源定义最前，seed先执行，left/right均RUNNING后join仍CREATED，最终得到L+R；控制TaskRun无Attempt |
| 嵌套完整示例 | checkedInS3ExampleExecutesBothChoicesThroughAllControlTypes：实际保存并运行示例的true/false输入，覆盖Dag、If、Parallel、Sequential、Sleep、Log及清理；输出与跳过分支正确 |
| 真并行 | parallelJobsReallyOverlapInWorkers验证并发Worker领取；workerPumpRunsParallelLeavesInOneRealJvm另启真实Worker JVM，两条Sleep同时处于RUNNING，非仅通过总耗时猜测 |
| 分支恢复 | ifChoiceSurvivesRestartAndUnselectedBranchNeverRuns：写入false后关闭/重建应用上下文，选择和开始时间保持；未选任务无Attempt；badConditionAndUnselectedOutputFailWithoutStuckExecution验证非布尔及缺失分支输出进入Errors/Finally |
| 并行失败/取消 | parallelFailureWaitsForRunningSiblingBeforeCleanup：失败结果已归并但兄弟未结束，清理不开始；cancellationFencesAllParallelJobsAndRunsOneCleanup验证取消全部活动Job及拒绝两份迟到结果 |
| Flow并发/FIFO | concurrentSubmissionsRespectFlowLimitAndPersistentFifo：10个并发提交、limit2，确实2个CREATED/8个QUEUED；重启后按DB sequence_no提升，全部完成 |
| 准入行为 | failAdmissionAndQueuedCancellationCreateNoAttemptsOrCleanup验证FAIL与排队取消无Attempt/清理；slotIsHeldUntilFinallyEndsAndReleasedOnCleanupFailure验证清理占槽与失败释放；latestConcurrencyPolicyAppliesAcrossVersionsWithoutKillingActiveRuns验证当前额度跨版本生效及降低不杀任务 |
| 取消竞态 | cancelDuringParallelRetryRacesWithAdmissionWithoutDeadlock：并行叶子RETRYING时，同时取消活跃、取消队列、再提交；无死锁/悬挂，旧失败Attempt未重写，无多余重试 |
| 双Scheduler | twoSchedulersCreateOneDurableFiringAndAdvanceCursor：两个线程同时调用持久引擎，只有一次创建/游标推进；不是依靠内存布尔锁 |
| Schedule原子性 | schedulerCursorAndSubmissionRollbackTogether：注入消息INSERT失败，执行数量仍0、到期游标不变，解除故障并重启后完成；scheduleSaveFailureRollsBackRevisionAndConcurrencyTogether：配置INSERT失败后修订、额度和队列提升/消息全部回滚 |
| 编辑/禁用/恢复 | scheduleEditDisableAndReenableHaveExplicitCursorSemantics：Schedule不变只更新未来执行版本，禁用清空游标，重启用从现在计算，删除停止触发；missedScheduleCoalescesAndUsesTheNormalAdmissionQueue：错过5天只合并一次，仍遵守普通准入队列 |
| 权限 | scheduleNeedsExecutePermissionAndRejectsReservedManualKeys：WRITE-only不能保存启用的Schedule；普通提交不能占用schedule:内部键前缀 |
| 独立Scheduler | separateSchedulerJvmCreatesExecutionsWithoutWorkersOrExecutor：关闭Executor/Worker，另启Scheduler JVM按真实秒级Cron产生持久执行；未开始任务；停该测试进程后由正常Executor/Worker完成 |
| 时区/DST | cronUsesTimezoneAndSkipsNonexistentDstTime：Shanghai本地8点转UTC、NewYork春季不存在的02:30跳过，不自写日期算法 |
| 停机升级 | s3MigrationRejectsActiveS2AndPreservesCompletedHistory：V4有KILLING时V5拒绝；仅测试库改成已结束并repair后迁移成功；历史main_state/request_hash保留、next_task删除、sequence_no生成 |
| 原S1/S2回归 | 原31项集成与定义/生命周期测试继续通过：版本/CAS、同键并发、HTTP授权、队列回滚、强杀Executor/Worker、心跳接管、旧/重复结果、重试/超时/取消/Errors/Finally与S1升级 |
| 协议/架构 | 12路由、16类record字段和引用防漂移；3份示例真实解析；核心模型不依赖Spring/JDBC、Controller不访问运行表、Worker不依赖ExecutionStore、跨模块无环 |

## 过程记录

- 初版S3执行器先通过原48项S1/S2回归。
- clean verify移除旧SequentialExecutor.class后，新增权限测试因未导入AccessPolicy外部类编译失败，改为已有Forbidden异常的全限定名；没有跳过该测试或改变生产授权行为。
- 随后69项、73项分批通过；加入完整示例的两分支真实执行和独立Scheduler JVM后，统一脚本75项通过。
- V3/V5迁移测试日志中的Flyway ERROR为assertThrows的预期证据。只对一次性测试schema排空并repair；生产代码无自动repair或吞错兼容。

## 变更与边界

生产Java新增FlowExecutor、JdbcScheduleStore、ScheduleCalculator、SchedulerEngine、SchedulerPump，删除SequentialExecutor；净增4份，现43份。模型增加控制树、Concurrency/Schedule和QUEUED；删除顺序nextTask字段。新增V5两张表和FIFO顺序号，没有新增通用SPI/Manager/Coordinator或冗余hash。修改已有提交/保存/Worker装配与协议，详细消费者见[S3协议](../contracts/s3-protocol.md)，逐Java文件见[代码索引](../01-code-architecture.md)。

主链仍是唯一Execution/TaskRun/Attempt模型；Scheduler只生成普通Execution，Executor解释控制树，Worker只执行叶子。参考Kestra成熟职责边界，当前有意简化为单Schedule、根Errors/Finally、QUEUE/FAIL及六字段Cron，不复制全部插件/服务结构。

没有验证生产高负载吞吐、跨主机网络分区、数据库灾备、多云K8s或任意外部副作用exactly-once。叶子仍只Log/Sleep；容器/HTTP/SQL任务、资源/数据集、算法、Repeat、计量及前端未实现。新后端V5采用排空停机升级，不支持S2/S3混跑。旧模板/旧系统数据没有迁移。

## 复现

在backend目录且Docker运行时：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify.ps1 -JavaHome 'D:\IDE\IntelliJ IDEA 2025.1.3\jbr' -MavenCommand 'D:\developevn\maven\bin\mvn.cmd'
```

JUnit报告位于各模块target/surefire-reports；子进程日志在platform-server/target/restart-evidence，其中s3-parallel-worker.log与s3-scheduler.log对应实际角色进程。所有测试容器由AfterAll/Testcontainers清理，子进程由finally结束。
