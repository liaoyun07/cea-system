# S3控制流、并发与定时协议

范围WF-009–011；S3新增内容在此说明，[S2协议](s2-protocol.md)中的Worker租约/结果隔离、叶子重试/超时与主失败/清理失败分离仍适用。S2的顺序游标与单Worker串行限制已被下述逻辑替代。HTTP仍是[OpenAPI](openapi.json)的12个操作，没有新增Worker API。

## 控制节点与输入输出

根tasks顺序执行，errors/finally仍只定义在根。任务可嵌套，但总数最多100（含控制节点、全部分支及处理器），最大嵌套深度16，ID在整个Flow内唯一。

| 类型 | 字段与实际行为 |
|---|---|
| core.Sequential | tasks按声明顺序执行 |
| core.Parallel | tasks中的就绪兄弟可同时派发；实际运行数量还受Worker并发限制 |
| core.Dag | tasks中的子任务用dependsOn列出同组兄弟ID；依赖全部SUCCESS才派发，与声明先后无关 |
| core.If | condition用现有Pebble表达式渲染后仅接受true/false；then必填非空，else可省略；所选分支内部顺序执行，可再嵌套控制节点 |
| core.Log / core.Sleep | 保留S2叶子行为；只有叶子创建WorkerJob和Attempt |

缺失依赖、自依赖、重复依赖、环、跨组dependsOn在保存时拒绝。控制节点不接受retry/timeout/message/duration；本阶段不实现控制节点整体重试或嵌套errors/finally，避免重新执行已完成兄弟。

If选定结果由Executor同事务写入该TaskRun.outputs.evaluationResult。恢复从持久结果读，不重新求值；未选分支及所有后代SKIPPED，不创建Attempt。控制节点有TaskRun和起止时间，但不是一个需要Worker执行的任务。

Log输出message，If输出evaluationResult。根outputs可绑定主任务树中的这两类输出；TaskOutputRef.port据此校验。表达式引用运行时仍严格求值。若根输出引用了未选择分支，Execution失败并进入Errors/Finally，不伪造空结果。没有隐式跨分支fallback。

并行/Dag某任务重试耗尽后，停止启动该组未开始节点，已启动兄弟及其既定重试完成后才结束控制节点和进入根清理。失败不通过删除尚在运行的兄弟来伪装组完成。取消则终止MAIN/ERRORS的活动Job和重试、跳过未开始节点，清理保持S2语义。

## Flow并发准入与FIFO

```yaml
concurrency: {limit: 2, behavior: QUEUE}
```

limit为1..1000；behavior省略为QUEUE，仅支持QUEUE/FAIL。未配置concurrency表示无Flow级数量限制，不代表无限Worker资源。并发域为namespace+flowId，跨所有版本共用**最新保存定义**的配置；显式执行旧版本仍遵守当前额度。

- CREATED/RUNNING/KILLING占额度，直到Finally结束才释放。降低limit不取消已准入执行；提高或移除limit可以立即提升旧队列。
- QUEUE超限持久化为QUEUED，输入/变量/版本快照已经固定，TaskRun仍CREATED但无Attempt和Executor消息。
- 提升顺序按wf_execution.sequence_no递增，保证准入FIFO，不保证并行任务完成顺序。新请求不能插队挤掉旧队列。
- FAIL超限返回一个已持久FAILED的Execution，error为flow concurrency limit exceeded，全部TaskRun为SKIPPED，没有Attempt、Errors或Finally。提交仍202，可通过执行查询看到失败。
- QUEUED取消直接KILLED，全部任务跳过，不执行Finally；已准入执行沿用取消后清理。
- 成功、失败、取消及清理失败终结时，同事务释放并提升队列。等待状态跨进程重启保留，无内存排队副本。

Flow额度与单Worker处理能力不是同一个数：前者约束同Flow活跃Execution数量，后者约束一个进程实际执行的叶子任务数量。

## 单Flow Schedule

```yaml
schedule:
  cron: '0 */5 * * * *'
  timezone: Asia/Shanghai
  disabled: false
  inputs: {publish: true}
```

复用Spring CronExpression解析器，六字段为秒、分、时、日、月、星期；不是Kestra五字段原样兼容，不接收宏。timezone默认UTC；disabled默认false；inputs为普通静态运行输入，用同一个BindingResolver校验类型、默认值和必填项（禁用时也检查定义完整性）。时间点计算见[Spring官方接口](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/scheduling/support/CronExpression.html)。

每Flow仅一个Schedule，不单独增加Trigger领域对象或HTTP接口。定义保存及回滚成新版本时同步运行配置：

| 操作 | 游标与执行行为 |
|---|---|
| 首次启用、修改Schedule、重新启用 | 从当前数据库时间计算下一点 |
| 只改任务、Schedule字段不变 | 保留next_fire，替换未来触发使用的版本/载荷 |
| disabled=true | next_fire=NULL，不触发；已有执行不取消 |
| 从定义移除schedule | 删除该Flow的Schedule行；已有执行不取消 |
| Scheduler停机后恢复 | 已持久的到期点执行一次，之后从当前时间计算下一点；不补发全部漏过时刻 |

没有未来匹配时间时next_fire为NULL。夏令时按指定ZoneId计算；不存在的本地时刻不会凭空触发。

启用Schedule的保存者必须同时拥有namespace WRITE与EXECUTE，定时执行submittedBy记录该授权主体。当前账号是本地静态配置，未实现动态IAM授权撤销/触发身份生命周期；不能声称已完成生产权限系统。

Scheduler调用同一个ExecutionService.submit，使用同样的准入、输入快照及幂等逻辑。内部请求键为schedule:flowId:到期毫秒，普通手动提交拒绝schedule:前缀。下一游标、Execution、TaskRun及消息同事务提交；两个Scheduler通过数据库锁竞争，不依赖单机内存标记。已错过时刻合并，不等于任意外部副作用exactly-once。

## 数据字段、消费者与锁边界

| 新增/删除 | 直接消费者与必要行为 |
|---|---|
| Flow.Task的tasks/dependsOn/condition/then/else | Validator和FlowExecutor判断拓扑、就绪和分支 |
| Flow.concurrency、schedule | 保存时同步并发门控和Schedule游标 |
| ExecutionState.QUEUED | 准入排队、取消和释放提升；TaskRun/Attempt不使用该状态 |
| wf_execution.sequence_no | promote按数据库递增值选择队首；无对外revision含义 |
| wf_flow_control的namespace/flow_id、concurrency_limit、behavior | 稳定Flow锁及当前限流规则；活跃数直接查询原Execution状态，不再维护计数器 |
| wf_schedule的namespace/flow_id、payload_json、next_fire | 未来触发定位、冻结最新Flow/修订/授权主体，以及双Scheduler锁内推进 |
| 删除wf_execution.next_task和SequentialExecutor | 由同一FlowExecutor递归推进整棵任务树，不保留顺序引擎兼容分支 |

表共10张业务表。dataflow仍仅拥有两张定义表；其FlowService通过runtime公开服务组合保存事务，不直接操作运行表。Scheduler/Executor/Worker各有明确职责，不增加Broker/WorkerGroup/SPI。

同一个TransactionTemplate使用READ_COMMITTED。写事务顺序为Flow锁→Schedule或Message→Execution；不在持有Execution后反向获取Flow。Worker仅锁工作传输行。保存定义的外层事务包含修订、并发规则/队列提升、Schedule；任一写失败整体回滚。Executor结束运行与提升队列同事务。读取候选后拿锁必须重读，避免过期状态做准入判断。

## 运行与升级

SchedulerPump默认启用，每250ms有限批次检查；platform.scheduler.enabled=false可关闭。Executor和Worker角色开关保留；WorkerPump默认每进程4个并发叶子任务（platform.worker.concurrency，1..100），用有界许可限制虚拟线程派发，不提前无限领取Job。Worker长任务仍由现有租约/心跳保护。

Flyway V5对新后端执行停机升级：停止接收提交、停Scheduler、等待CREATED/RUNNING/KILLING排空，再停全部S2进程，备份并启动S3。guard遇活动执行拒绝迁移。保留已完成历史和真实幂等request_hash；无在线S2/S3混跑、自动repair或降级兼容。不涉及旧web-platform库。

[可执行定义示例](../../examples/s3-control-flow.yaml)默认disabled=true，避免导入示例就自动周期执行。真正任务仍只有Log/Sleep，容器、跨云选址、Repeat、算法镜像和计量均未在S3实现。
