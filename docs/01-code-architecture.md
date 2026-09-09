# 项目结构与 Java 文件索引

这是当前代码结构的权威索引。状态与计划见[实施计划](03-implementation-plan.md)和[进度](04-progress.md)。包根为 `com.project.platform`，不沿用旧 DTO/包依赖。

## 工程结构

根 `pom.xml` 是独立父工程，聚合八个模块。server 是 Spring Boot 可执行 JAR，其余模块为普通 JAR。生产Java共48份（含8份包声明），测试类另列。

## 模块依赖白名单

依赖指向被使用方。跨模块只调用公开接口；POM白名单由结构脚本检查；ArchUnit检查包环、runtime方向、model不依赖Spring/JDBC及Controller不访问持久化。

| 模块 | 允许的项目依赖 |
|---|---|
| workflow-runtime | 无 |
| platform-foundation | 无 |
| platform-resource | platform-foundation |
| platform-deployment | platform-resource, platform-foundation |
| platform-offloading | workflow-runtime, platform-resource, platform-foundation |
| platform-edge | workflow-runtime, platform-resource, platform-foundation |
| platform-dataflow | workflow-runtime, platform-deployment, platform-resource, platform-foundation |
| platform-server | workflow-runtime, platform-foundation, platform-resource, platform-deployment, platform-offloading, platform-edge, platform-dataflow |

runtime 与 foundation 是两个底层边界；runtime 不能通过 foundation 间接依赖业务。业务模块不能互相读取表。选址/镜像准备/外部执行等接口放在其真正使用方的 API/SPI，由 server 注入实现，避免 runtime → 业务模块的反向依赖。未来必要依赖先修改 ADR/白名单，再改代码。

## 当前全部生产 Java 文件

所有路径相对backend。生产文件逐一登记；测试别名：D=DefinitionTest，I=DurableWorkflowTest，C=ContractTest，A=ArchitectureTest，L=LifecycleTest，T=ControlFlowTest（路径见下文）。实现范围为S1–S3与S4-01资源目录/候选检查，不含实际外部任务。

| Java 文件路径（相对 backend） | 职责 | 关键接口 | 状态/事务 | 功能 | 验证入口 |
|---|---|---|---|---|---|
| `workflow-runtime/src/main/java/com/project/platform/runtime/model/FlowDefinition.java` | 统一DSL、嵌套Task/Concurrency/Schedule与显式Binding记录 | record构造与immutable | 只读定义；嵌套值提交后序列化冻结 | WF-001、WF-002 | D/C |
| `workflow-runtime/src/main/java/com/project/platform/runtime/model/ExecutionState.java` | 执行/任务状态 | terminal | Execution无RETRYING/SKIPPED；TaskRun可RETRYING/SKIPPED；QUEUED仅Execution | WF-004 | I |
| `workflow-runtime/src/main/java/com/project/platform/runtime/model/ExecutionRecord.java` | 运行、TaskRun、Attempt、日志、幂等回执记录 | record访问器 | 承载持久状态；区分mainState/cleanupError和TaskRun的phase/retryAt | WF-004、WF-006 | I/C |
| `workflow-runtime/src/main/java/com/project/platform/runtime/model/WorkflowException.java` | 领域校验/冲突/未找到异常 | invalid/missing/conflict | 不暴露SQL或模板上下文 | WF-001 | D/I |
| `workflow-runtime/src/main/java/com/project/platform/runtime/definition/JsonCodec.java` | 统一JSON序列化与请求规范摘要 | write/read/map/flow/hash | map键排序SHA256 | WF-001、WF-005 | D/I |
| `workflow-runtime/src/main/java/com/project/platform/runtime/definition/FlowParser.java` | JSON/YAML入口与未知字段拒绝 | parse | 无写入；限源文本长度 | WF-001 | D/C |
| `workflow-runtime/src/main/java/com/project/platform/runtime/definition/FlowValidator.java` | 叶子/控制树、DAG环、Cron/输入、跨阶段ID与Binding校验 | validate/identifier | 保存前校验；表达式引用运行时检查 | WF-001、WF-002 | D/I |
| `workflow-runtime/src/main/java/com/project/platform/runtime/definition/BindingResolver.java` | 类型检查、默认输入、变量与最终输出 | prepare/resolve/outputs | 创建执行前固定inputs/variables | WF-002 | D/I |
| `workflow-runtime/src/main/java/com/project/platform/runtime/definition/TemplateRenderer.java` | 严格Pebble表达式 | validate/render | 无模板语句；限制渲染长度 | WF-002 | D/I |
| `workflow-runtime/src/main/java/com/project/platform/runtime/persistence/JdbcExecutionStore.java` | 运行状态、消息、日志及Flow准入锁 | transaction/create/nextMessage/admission/promote/controlState/requestCancel | 状态、日志、消息同一JDBC事务；数据库时间与消费行锁 | WF-004、WF-005、WF-008 | I |
| `workflow-runtime/src/main/java/com/project/platform/runtime/execution/ExecutionService.java` | runtime公开提交/查询入口 | submit/configureConcurrency/transaction及查询取消 | 准入/提交事务+唯一幂等键；不自己验证HTTP身份 | WF-004、WF-005、WF-006 | I |
| `workflow-runtime/src/main/java/com/project/platform/runtime/executor/FlowExecutor.java` | 唯一状态推进者：控制树解释、叶子派发归并、三段处理 | processNext | 短事务；分支持久化、并行失败收敛、清理及额度释放；不执行叶子代码 | WF-005、WF-008、WF-009、WF-010 | I |
| `workflow-runtime/src/main/java/com/project/platform/runtime/executor/ExecutionReducer.java` | 同组节点就绪与固定重试时间的纯决策 | ready/retryAt | 无I/O；供Executor使用 | WF-008 | L/I |
| `workflow-runtime/src/main/java/com/project/platform/runtime/persistence/JdbcWorkerStore.java` | Worker传输表与结果持久化 | dispatch/result/remove/claim/heartbeat/finish | 领取短事务；owner/epoch/租约/deadline隔离；不写运行状态表 | WF-007 | I/A |
| `workflow-runtime/src/main/java/com/project/platform/runtime/worker/WorkerJob.java` | 派发载荷及Lease/Result记录 | record访问器、Result.success/failed | 冻结Task/上下文；TaskRun+Attempt定位，epoch隔离持有者 | WF-007 | I |
| `workflow-runtime/src/main/java/com/project/platform/runtime/worker/WorkerEngine.java` | 事务外执行Log/Sleep，心跳和协作中断 | runOnce/close | 不拥有Execution状态；关闭/失租不报告业务失败 | WF-007、WF-008 | I/A |
| `platform-server/src/main/java/com/project/platform/server/configuration/WorkerPump.java` | 可关闭的Worker轮询角色 | poll | 默认每进程最多4个叶子任务；许可限制并行派发，不阻塞调度线程 | WF-007 | I |
| `platform-foundation/src/main/java/com/project/platform/foundation/identity/AccessPolicy.java` | Actor与命名空间/action授权 | require | 无存储；拒绝越权 | SEC-001 | I |
| `platform-dataflow/src/main/java/com/project/platform/dataflow/definition/FlowRevision.java` | 版本内容和列表摘要 | record访问器 | 不可变版本与来源；删除无业务消费者checksum | WF-003 | I/C |
| `platform-dataflow/src/main/java/com/project/platform/dataflow/definition/JdbcFlowRepository.java` | 仅定义头/版本表持久化 | save/get/history/list | 锁稳定head，CAS保存；只追加版本 | WF-003 | I |
| `platform-dataflow/src/main/java/com/project/platform/dataflow/definition/FlowService.java` | 定义管理应用门面 | save/get/history/list/rollback | WRITE/READ授权；启用Schedule另需EXECUTE；修订/并发配置/Schedule同事务 | WF-003、SEC-001 | I |
| `platform-dataflow/src/main/java/com/project/platform/dataflow/execution/FlowExecutionService.java` | 提交、取消与运行查询门面 | submit/get/list/tasks/attempts/logs/cancel | 授权；原始请求hash优先查幂等，解析版本后委托runtime | WF-004、WF-006、SEC-001 | I |
| `platform-server/src/main/java/com/project/platform/server/BackendApplication.java` | Boot standalone启动 | main | 无业务状态 | FND-001 | I |
| `platform-server/src/main/java/com/project/platform/server/configuration/RuntimeConfiguration.java` | 显式构造服务/存储/执行器Bean | 各@Bean工厂 | 共享DataSource与READ_COMMITTED事务；租约/截止/触发使用DB时间 | WF-005 | I |
| `platform-server/src/main/java/com/project/platform/server/configuration/ExecutorPump.java` | 有限批次内置消息推进 | poll | 每步由Executor独立事务；DB故障下次再试 | WF-005 | I |
| `platform-server/src/main/java/com/project/platform/server/security/SecurityProperties.java` | 外部配置账号/命名空间/actions | record访问器 | 不提交密码到源码；没有默认密码 | SEC-001 | I |
| `platform-server/src/main/java/com/project/platform/server/security/IdentityDirectory.java` | 配置身份映射与密码编码 | users/actor | 启动校验；不接受客户端指定actor | SEC-001 | I |
| `platform-server/src/main/java/com/project/platform/server/security/SecurityConfiguration.java` | HTTP Basic与无会话安全链 | apiSecurity/users/identityDirectory | 仅本地基线；无生产IAM承诺 | SEC-001 | I |
| `platform-server/src/main/java/com/project/platform/server/api/FlowController.java` | 定义/版本HTTP适配 | save/get/revisions/rollback/list | 不直接访问任何Repository或表 | WF-003 | I/C/A |
| `platform-server/src/main/java/com/project/platform/server/api/ExecutionController.java` | 执行HTTP适配与返回View | submit/get/list/tasks/attempts/logs/cancel | 202在提交/取消事务完成后；不泄露内部定义快照 | WF-004、WF-006 | I/C/A |
| `platform-server/src/main/java/com/project/platform/server/api/ApiExceptionHandler.java` | 领域和请求错误HTTP映射 | workflow/forbidden/malformed | 400/403/404/409/422；基础设施错误不改业务状态 | SEC-001、WF-004 | I |
| `workflow-runtime/src/main/java/com/project/platform/runtime/package-info.java` | 根包职责声明 | 无 | 无 | FND-001 | 结构检查 |
| `platform-foundation/src/main/java/com/project/platform/foundation/package-info.java` | 根包职责声明 | 无 | 无 | FND-001 | 结构检查 |
| `platform-resource/src/main/java/com/project/platform/resource/package-info.java` | 根包职责声明 | 无 | 无 | FND-001 | 结构检查 |
| `platform-deployment/src/main/java/com/project/platform/deployment/package-info.java` | 根包职责声明 | 无 | 无 | FND-001 | 结构检查 |
| `platform-offloading/src/main/java/com/project/platform/offloading/package-info.java` | 根包职责声明 | 无 | 无 | FND-001 | 结构检查 |
| `platform-edge/src/main/java/com/project/platform/edge/package-info.java` | 根包职责声明 | 无 | 无 | FND-001 | 结构检查 |
| `platform-dataflow/src/main/java/com/project/platform/dataflow/package-info.java` | 根包职责声明 | 无 | 无 | FND-001 | 结构检查 |
| `platform-server/src/main/java/com/project/platform/server/package-info.java` | 根包职责声明 | 无 | 无 | FND-001 | 结构检查 |
| `workflow-runtime/src/main/java/com/project/platform/runtime/persistence/JdbcScheduleStore.java` | 持久Schedule载荷和游标 | configure/peek/lockDue/advance | 调用者持Flow锁；游标与执行同事务 | WF-011 | I |
| `workflow-runtime/src/main/java/com/project/platform/runtime/scheduler/ScheduleCalculator.java` | 六字段Cron/ZoneId校验和下一时间 | validate/next | 复用Spring CronExpression，无运行状态 | WF-011 | T/I |
| `workflow-runtime/src/main/java/com/project/platform/runtime/scheduler/SchedulerEngine.java` | 到期点通过统一ExecutionService提交 | configure/runOnce | Flow→Schedule锁；提交和游标原子推进 | WF-010、WF-011 | I |
| `platform-server/src/main/java/com/project/platform/server/configuration/SchedulerPump.java` | 可关闭的有限批次定时轮询 | poll | 每次触发独立事务；故障保留游标重试 | WF-011 | I |
| `platform-resource/src/main/java/com/project/platform/resource/catalog/ResourceCatalog.java` | 集群、数据集版本/位置、候选请求与结果记录 | 嵌套record及Kind | 不可变请求/响应值；版本指注册描述，不保证对象内容未变 | RES-001、RES-002 | I/C |
| `platform-resource/src/main/java/com/project/platform/resource/catalog/ResourceException.java` | 资源域非法请求、未找到与冲突异常 | invalid/missing/conflict | 无运行状态依赖；HTTP统一映射 | RES-001 | I |
| `platform-resource/src/main/java/com/project/platform/resource/catalog/JdbcResourceRepository.java` | 仅res_*目录表持久化 | putCluster/cluster/clusters/dataset/datasets/register | 版本和位置同事务；唯一键冲突后读已提交版本判断相同注册或冲突 | RES-001 | I/A |
| `platform-resource/src/main/java/com/project/platform/resource/catalog/ResourceCatalogService.java` | 资源目录公开门面与候选本地性检查 | putCluster/registerDataset/placementOptions及查询 | READ/WRITE授权；校验URI、同namespace位置与版本；预览不预约 | RES-001、RES-002、SEC-001 | I |
| `platform-server/src/main/java/com/project/platform/server/api/ResourceController.java` | 7个资源HTTP操作 | 集群/数据集版本读写、列表、placementOptions | Principal映射身份；仅调用资源公开门面，不读取Repository | RES-001、RES-002 | I/C/A |

## 表与事务所有权

- dataflow：[V2__flow_revisions.sql](../platform-dataflow/src/main/resources/db/migration/dataflow/V2__flow_revisions.sql)，wf_flow_head、wf_flow_revision。
- runtime：[V1__runtime.sql](../workflow-runtime/src/main/resources/db/migration/runtime/V1__runtime.sql)，wf_execution、wf_task_run、wf_task_attempt、wf_message、wf_log。
- 同一个数据库和事务管理器，不代表可跨模块读写表。server配置提供DataSource，但HTTP层不能直接操作存储。
- runtime：[V3__worker_lifecycle.sql](../workflow-runtime/src/main/resources/db/migration/runtime/V3__worker_lifecycle.sql)，增加wf_worker_job、消息唤醒时间、重试时间及阶段/主结果/清理错误。执行租约使用数据库时钟。
- dataflow：[V4__remove_unused_revision_checksum.sql](../platform-dataflow/src/main/resources/db/migration/dataflow/V4__remove_unused_revision_checksum.sql)，删除无行为消费者的checksum；真实幂等request_hash不删除。
- runtime：[V5__control_flow_and_scheduling.sql](../workflow-runtime/src/main/resources/db/migration/runtime/V5__control_flow_and_scheduling.sql)，新增wf_flow_control、wf_schedule和FIFO sequence_no，删除next_task。
- resource：[V6__resource_catalog.sql](../platform-resource/src/main/resources/db/migration/resource/V6__resource_catalog.sql)，res_cluster、res_dataset_version、res_dataset_location。外键限制同命名空间的集群/版本引用；仅资源模块读写。
- 共13张业务表。V6不修改既有workflow表。Executor派发Job与开始Attempt同事务；Worker短事务领取、事务外运行、结果持久化；Executor归并结果/日志/运行状态/续消息同事务。Worker不能直接修改Execution/TaskRun/Attempt。
- 资源链独立于执行链：HTTP → ResourceCatalogService → JdbcResourceRepository。候选检查是声明本地性/格式/禁用状态预览，没有创建Execution、预约或Job。资源字段消费者见[S4-01协议](contracts/s4-resource-catalog.md)。RuntimeConfiguration仅增加目录Bean装配，ApiExceptionHandler增加ResourceException映射；runtime主调用链不变。
- S1/S2活动执行必须排空后停机升级，不提供混版本执行兼容。叶子语义见[S2协议](contracts/s2-protocol.md)，控制树/准入/触发/锁顺序见[S3协议](contracts/s3-protocol.md)。

## 测试入口

- D：[DefinitionTest](../workflow-runtime/src/test/java/com/project/platform/runtime/definition/DefinitionTest.java)，10项模型/类型/绑定/模板测试。
- I：[DurableWorkflowTest](../platform-server/src/test/java/com/project/platform/server/DurableWorkflowTest.java)，63项真实MySQL/HTTP/并发/故障/重启测试；保留52项S1–S3测试，新增11项资源持久化、版本/位置原子性、并发冲突、本地性、权限与输入校验测试。
- L：[LifecycleTest](../workflow-runtime/src/test/java/com/project/platform/runtime/definition/LifecycleTest.java)，3项时长/重试校验、跨阶段定义约束、纯决策测试。
- C：[ContractTest](../platform-server/src/test/java/com/project/platform/server/ContractTest.java)，3项路由/record字段与引用/示例防漂移检查，不等同完整OpenAPI规范验证器。
- A：[ArchitectureTest](../platform-server/src/test/java/com/project/platform/server/ArchitectureTest.java)，1项包含多条依赖约束的架构测试。

- T：[ControlFlowTest](../workflow-runtime/src/test/java/com/project/platform/runtime/definition/ControlFlowTest.java)，6项控制定义/拓扑/分支/额度/Cron/时区DST测试。

## 后续实现位置规划

此表描述包边界，不预先创建空类。每次真正增加 Java 类，必须在上表登记实际路径、职责、关键接口、状态所有权和测试入口。大型模块可拆出明细文件，但本页保留统一入口。

| 模块 | 计划内部包 | 主要实现阶段 |
|---|---|---|
| workflow-runtime | model、definition、port、spi、executor、scheduler、worker、persistence、runner | S1–S3 |
| platform-dataflow | definition、execution、query、metrics | S1–S4 |
| platform-resource | catalog已实现；后续按真实消费者增加storage、placement、reservation | S4 |
| platform-deployment | application、contract、registry、distribution、deployment | S4 |
| platform-edge | gateway、terminal、policy、delivery | S5 |
| platform-offloading | eligibility、decision、profile、feedback | S5 |
| platform-foundation | identity、authorization、configuration | S1 起按需求增加 |
| platform-server | api、bootstrap、configuration | S1 起按需求增加 |

S1–S3模型采用record及嵌套record，不是每个领域名都拆成独立文件。ExecutionReducer已有真实调用者；WorkerCoordinator、通用插件SPI尚未创建。未来接口按消费者与验收需求设计，不机械复制旧版181文件清单。

## 自动检查的边界

[check-scaffold.ps1](../scripts/check-scaffold.ps1) 检查 POM 与文档模块集合、依赖白名单/环、生产 Java 索引、功能编号及本地文档链接。它不能替代 Java 语义测试、真实数据库并发测试或类级依赖测试。
