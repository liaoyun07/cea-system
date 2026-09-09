# S1定义与持久执行协议（历史）

此文记录S1阶段；当前执行链、重试/清理/取消、版本返回字段以[S2协议](s2-protocol.md)和当前OpenAPI为准。S2不再使用事务内Log、单次Attempt限制或版本checksum。

关联：WF-001、WF-002、WF-003、WF-004、WF-005、WF-006、SEC-001基础。schemaVersion=1；[OpenAPI](openapi.json)记录字段，下面记录语义。

## 定义与表达式

JSON/YAML进入同一个FlowDefinition，拒绝未知字段、重复YAML键、不支持任务类型。source非空，最多262144字符；tasks按列表顺序执行，1–100项，标识为字母开头、总长1–100，后续允许字母数字和点/下划线/短横线。namespace/id必须和保存路径一致。没有隐式图、旧PARALLEL_GROUP、兼容模式。

Inputs支持STRING、INTEGER、NUMBER、BOOLEAN、OBJECT、ARRAY。对象和数组只校验顶层类型，S1没有嵌套Schema。required省略或null按false；输入未提供取defaultValue，显式null不回退默认。required输入最终为null则422；数字字符串不当成数字；未声明输入拒绝。Labels为元数据，不参与执行。

Variables及最终Outputs使用显式Binding：

| source | 字段 | 语义 |
|---|---|---|
| LITERAL | value | JSON字面量，保留原类型 |
| INPUT | name | 读取本次输入 |
| VARIABLE | name | 读取变量；变量间引用必须无环，定义顺序不影响 |
| TASK_OUTPUT | taskId、port | 成功任务的命名输出；S1只有message |

Variables在提交时解析，只能用前三类；最终Outputs在全部任务成功后求值，支持四类。模板版本、输入和变量被序列化到Execution，后续编辑模板不影响已经提交的执行。输入可选null和显式绑定输出原类型保留。

唯一任务类型core.Log：message使用严格Pebble表达式，例如 `{{ inputs.name }}`、`{{ vars.greeting }}`、`{{ outputs.first.message }}`、`{{ execution.id }}`。不允许`{%`模板语句；限制消息及渲染长度65536字符；不是Shell/Python。静态校验显式Binding与模板语法；**模板里的未知/未来任务引用在运行时严格报错**，不会自动变为空串。前序成功任务的message可供后续引用。表达式由成熟模板引擎求值，不声称已提供面向不可信公网上传的完整资源隔离沙箱。

## 修订与回滚

首次expectedRevision=0，后续必须等于最新版本。dataflow在同一事务锁稳定head、比较版本、追加不可变revision、更新head。并发只有一个写者成功，其他409。
回滚是复制历史source并再校验、产生新revision；不删除或覆盖旧修订。不存在修订404；不存在流程的history返回空数组。版本包含source、编译模型、checksum、createdBy、createdAt；源字符串的格式变化可以产生新revision。

定义来源由用户保存到数据库；示例YAML不是启动时自动种子，不内置FedAvg或站点名。

## 提交与身份

HTTP Basic完成身份认证，application facade再校验namespace和READ/WRITE/EXECUTE；不信任X-User。配置凭据只作为S1本地开发方式，服务默认回环地址，不能当作已经完成生产TLS、完整RBAC或Worker鉴权。

POST executions需要Idempotency-Key（1–128个非空字符）。唯一域：namespace + authenticated actor + key。
相同请求返回同executionId；不同请求409。摘要为规范化JSON/map键排序SHA256，包含flowId、revision、inputs。省略revision在第一次接受时取latest，但重投先查原请求摘要，不会因latest改变而重新执行。revision省略与显式revision属于不同请求，inputs缺失/null与空对象也不保证等价，客户端重试应保持原请求。
不允许用请求体指定submittedBy；也不能通过换namespace路径读取他人范围的日志/TaskRun。

提交先固定定义和有效输入，然后在一次runtime事务内创建Execution、全部TaskRun、第一条消息，提交成功后返回202。
收到网络超时不能凭空换键；沿用原键查询/重试。202不是任务已经成功。

## 状态、事务与恢复

Execution：CREATED → RUNNING → SUCCESS/FAILED。TaskRun：CREATED → RUNNING → SUCCESS/FAILED；上游失败时尚未启动任务标SKIPPED。Attempt在TaskRun开始时创建，S1只有attemptNo=1，未开始或被跳过任务没有Attempt。业务执行错误持久保存并停止后续任务，基础设施异常整步回滚并保留消息。

一次持久消息推进一个阶段：

1. CREATED执行变RUNNING并留下续消息。
2. 当前TaskRun变RUNNING，创建Attempt，留下续消息。
3. 渲染Log；**写日志、TaskRun/Attempt成功、nextTask递增、续消息**一起提交。
4. 全部任务完成后解析最终Outputs，Execution进入SUCCESS，不再续消息。

消息领取使用MySQL8的FOR UPDATE SKIP LOCKED；每个execution最多一条待处理消息。消费确认是事务内删除，回滚则删除也撤销。Executor中的任何外部副作用都不在S1范围；日志是数据库记录，不依赖控制台采集。并发消费者仍由数据库行锁和唯一约束串行推进同一次执行。
重启后扫描已有消息，不重建执行或重置TaskRun。S1测试覆盖接受后强杀JVM、RUNNING步骤上下文重启、事务故障回滚；**不声称外部任务exactly-once或跨机容灾已完成**。

## 存储与查询

- [runtime V1](../../workflow-runtime/src/main/resources/db/migration/runtime/V1__runtime.sql)：5张运行表。
- [dataflow V2](../../platform-dataflow/src/main/resources/db/migration/dataflow/V2__flow_revisions.sql)：2张定义表。
- Flyway维护独立历史表；没有H2或内存运行时回退；不执行旧数据库迁移。
- 时间来自后端UTC Clock，保存MySQL微秒精度；JDBC连接使用connectionTimeZone=UTC，返回ISO时间。不是算法性能计量。
- list默认limit20、offset0；limit1–100、offset0–1000000。日志默认limit50、afterId0，按递增id游标，不等同实时订阅。
- 版本查询返回完整定义；执行查询返回真实输入、变量、最终输出、状态和时间。S1无Secret类型，不要把密码作为Flow普通输入或Log内容。
