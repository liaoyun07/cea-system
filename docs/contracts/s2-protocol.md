# S2执行与Worker协议

关联WF-007、WF-008，保留S2验收时的语义记录。Worker/租约/叶子失败策略仍适用；其中顺序游标、单Worker串行限制及“不支持DAG/Cron”已被[S3协议](s3-protocol.md)替代。HTTP当前字段见[OpenAPI](openapi.json)。容器和跨站点Worker API仍未实现。

## 定义与运行链

schemaVersion仍为1，新增可选errors、finally任务列表，未改变原输入/Binding语义。tasks不能为空，三段合计最多100项，ID跨三段唯一。core.Log要求message且禁止duration；core.Sleep要求duration且禁止message，输出为空对象。Duration为ISO-8601，范围1ms–24h。显式Flow输出仅引用成功MAIN的Log.message，不引用Sleep或清理任务。模板运行时可读前序成功输出及taskrun.attemptsCount（首轮1）。

Task增加可选retry与timeout：

```yaml
retry:
  type: constant
  maxAttempts: 3
  interval: PT1S
timeout: PT10S
```

maxAttempts包含首次，范围1–100。只有失败/超时耗用新Attempt；间隔从前次失败被归并时算起，等待时间持久保存。timeout从每Attempt派发开始算，**包含等待Worker时间**，不是算法时间，也不同于只计任务代码时间。Worker接管不能重置deadline。

真实调用链：API权限/提交 → Executor事务派发Job → Worker短事务领取 → 事务外Log/Sleep并心跳 → 持久结果 → Executor事务归并状态/日志/续消息。

## 谁拥有状态

Executor唯一修改Execution、TaskRun、Attempt，Worker不能直接写这些表。Worker只领取、续租并写Job结果。ExecutionReducer只做下一阶段与固定重试时间决策，没有数据库访问，也不是第二份状态机。

MAIN成功跳过ERRORS再FINALLY；MAIN最终失败跳过剩余MAIN，运行ERRORS再FINALLY。ERRORS失败跳过剩余ERRORS，不递归进入错误处理。FINALLY逐项执行，失败继续下一项。每段任务仍适用自己的retry/timeout。

Execution在处理错误/清理期间仍RUNNING，取消后为KILLING。主结果记录mainState：

- 主成功且清理成功：SUCCESS。
- 主成功但清理失败：最终FAILED，mainState=SUCCESS、error为空、cleanupError非空；主结果Outputs保留。
- 主失败：最终FAILED，error保留原始失败；Errors失败见对应TaskRun，清理失败另记cleanupError。
- 取消：最终KILLED，mainState=KILLED；已有error不覆盖，未失败时error为cancelled；仍记录清理失败。

cleanupError只保留首个清理错误，其他错误可按FINALLY TaskRun查询。未开始的跳过任务没有Attempt；RETRYING TaskRun保留已失败Attempt，再次开始才新建下一次。最终状态不可由晚到结果回退。

## Job领取、心跳、结果

内部Java载荷见WorkerJob/Lease/Result，生产者和消费者必须使用同版应用和数据库结构；没有为未来协议预加version/hash。

Job键(task_run_id,attempt_no)稳定。READY可领取；RUNNING且lease_until过期可重新领取。领取用FOR UPDATE SKIP LOCKED，在短事务内写owner、epoch+1、lease_until；不修改Attempt。相同Job重复运行只适用于当前无不可逆副作用的Log/Sleep，不自动推广到容器或网络调用。

心跳与finish都要求：相同任务/Attempt、相同owner/epoch、状态RUNNING、租约仍有效、deadline尚未到。旧epoch、过期或已删除Job的回报返回false，不更新执行；重复RESULT回报同样不再写入。false表示结果不再由该持有者接受，不是新的业务失败。

finish把结果写成RESULT后，Executor稍后归并。只有归并事务才写Log日志、TaskRun/Attempt终态、删除Job和续消息；失败整个事务回滚，包括结果消费和日志。已经在deadline之前持久接受的结果，不因Executor晚归并而被判超时。
队列available_at控制Executor唤醒，等待Worker时按100ms重新安排消息；不是在数据库事务内sleep。Worker不跨表回写通知，Executor读取持久结果。

Worker JVM断开/关闭不伪装任务失败；租约到期重领同一次Attempt。任务真正FAILED或超时后，Executor才按策略新建下一次。关闭/失去租约时中断本地任务；这对当前Sleep有效，但不构成未来任意外部任务强杀保证。

## 取消与竞态

POST /api/namespaces/{namespace}/executions/{id}/cancel 要求EXECUTE；返回202回执，重复幂等，终态不改变。Executor处理取消时取消当前MAIN/ERRORS任务、删除对应Job以使旧回报失效、跳过剩余MAIN/ERRORS，再执行FINALLY。取消不重试MAIN/ERRORS；FINALLY属于必须继续的清理段，仍按其自身retry/timeout配置执行。

取消落在FINALLY时不再次运行或中断正在清理的任务；没有重新进入MAIN或ERRORS。TaskRun曾经失败并等待重试时，取消只终止后续重试，不把已失败Attempt改成KILLED。

尚未归并的成功结果遇到先持久接受的取消时被丢弃；如果SUCCESS已经提交，后续取消无效。终态决策按数据库锁顺序串行，不靠客户端时间判断。Worker的物理停止是协作式，结果隔离是数据库条件保证。

## 新增持久字段的明确消费者

| 表/字段 | 当前消费者与判断 | 删除会破坏的验收 |
|---|---|---|
| wf_worker_job：键task_run_id/attempt_no | 领取和归并定位同一次Attempt，FK约束 | 接管不新增Attempt、旧Attempt结果拒绝 |
| state | claim仅领READY/过期RUNNING；Executor仅取RESULT | 重复领取/结果发布隔离 |
| epoch、owner | heartbeat/finish条件匹配持有者 | 旧Worker晚到结果拒绝 |
| lease_until | 领取是否允许接管；续租/回报是否有效 | 心跳存活、断开接管 |
| deadline | claim/heartbeat/finish拒绝超时任务 | 超时不被接管重置、不接受迟到成功 |
| payload_json | Worker执行实际Task和冻结上下文 | 独立进程执行、重启恢复 |
| result_json | Executor归并实际结果 | 结果先持久后重启、归并事务回滚 |
| wf_message.available_at及索引 | 只消费到期唤醒 | 重试间隔持久化，不提前启动 |
| wf_task_run.phase | Executor区分MAIN/ERRORS/FINALLY及API呈现 | 错误/清理路径与诊断 |
| wf_task_run.retry_at | 重复唤醒时仍检查是否到重试时间 | 早到唤醒不能绕过等待 |
| wf_execution.main_state | 清理后选择最终结果、保留主成功/失败 | 清理失败不篡改主失败 |
| wf_execution.cleanup_error | 清理失败后最终FAILED判断与错误呈现 | 主成功但清理失败不能伪装成功 |

新增5个生产Java文件：ExecutionReducer、JdbcWorkerStore、WorkerJob、WorkerEngine、WorkerPump；没有新增项目模块或模块依赖。
删除FlowRevision/Summary的checksum及表列，没有当前业务判断消费者；版本CAS仍使用revision，提交幂等仍使用原request_hash，源文件验证清单仍作为审计证据，不是业务对象字段。

## 升级与运行边界

V3先拒绝仍CREATED/RUNNING的S1执行，再扩展运行表；V4删除版本checksum。已完成S1历史保留并填充main_state。不热升级、不混跑S1/S2，不加入旧版本执行器分支。
升级前必须停止新提交、排空、备份专用库并停S1；错误迁移不自动repair。测试在独立临时schema故意触发拒绝、排空、repair后重试，不能照搬到未知生产库。降级需要与备份匹配的代码/数据库，不承诺直接运行旧二进制。

默认standalone有2条调度线程，Executor与Worker不互相阻塞。通过platform.executor.enabled与platform.worker.enabled关闭对应推进角色，可分别运行不同JVM；仍共享同一新后端MySQL。worker.lease-ms默认3000，范围300–60000，心跳等待周期为其1/3；不是跨云公网认证。所有租约/截止/唤醒判定使用数据库时间。

未实现：多集群调度、DQN、容器执行、Worker HTTP鉴权、S3全局FIFO/并发额度、任意外部副作用exactly-once、数据库灾难恢复/生产容量；完整OpenAPI实例验证也不在当前防漂移测试范围。
