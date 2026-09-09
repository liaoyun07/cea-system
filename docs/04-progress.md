# 当前进度

更新时间：2026-09-10。当前阶段：S4资源与运行环境。阶段状态：IN_PROGRESS；S4-01及修正后的S4-02a应用契约目录已完成并回归通过，不代表整个S4-02已完成。

## 当前事实

- 独立8模块保留，54份生产Java（含8份包声明）、6个测试类；没有新增项目模块依赖。deployment增加spring-jdbc/Jackson，复用父BOM，未升级技术版本。
- S1定义/类型绑定、版本/CAS/回滚、幂等提交和查询保留；S2Worker租约/epoch、同Attempt接管、固定重试/超时/取消与Errors/Finally已回归。
- 新增嵌套Sequential/Parallel/Dag/If；DAG同组依赖与声明顺序无关；If选择持久化、未选分支跳过。控制节点只有TaskRun，只有叶子创建Attempt/WorkerJob。
- 新增Flow并发limit、QUEUE/FAIL和持久FIFO；同namespace/flowId跨版本共用最新额度，清理结束才释放。排队取消无Attempt/Finally，活跃取消保留清理。
- 新增单Flow六字段Cron、时区、disabled、静态inputs和持久游标；双Scheduler锁内去重，错过多次只补一个已持久到期点。默认每Worker进程4个并发叶子任务。
- 真实调用链：手动HTTP/dataflow或Scheduler → ExecutionService准入 → FlowExecutor解释控制树/派发 → Worker事务外执行 → 持久结果 → Executor归并、清理、提升队列。
- 14张业务表。dataflow只拥有定义头和修订，runtime拥有运行/传输/Flow门控/Schedule表，resource拥有3张资源目录表，deployment拥有应用契约版本表；不跨模块访问对方Repository。V7不改变执行表。
- 删除SequentialExecutor和wf_execution.next_task，以统一FlowExecutor替代；没有旧执行器兼容开关，没有增加Broker/WorkerGroup/空SPI或第二套运行状态。字段消费者见[S3协议](contracts/s3-protocol.md)。
- S3历史统一verify为75项通过，见[S3验收](verification/VER-S3-001-control-scheduling.md)。本批统一scripts/verify.ps1于18:01:48 +08:00通过86项（19单元+63真实MySQL集成+3协议+1架构），0失败/错误/跳过，结构检查通过；测试容器与JVM已退出，见[S4-01验证](verification/VER-S4-001-resource-catalog.md)。
- S3验证只运行隔离测试MySQL和自己的测试JVM，均已清理；旧web-platform、旧数据库、旧镜像未修改或迁移。随后用户授权将新backend首次提交并发布到公开仓库，不扩大到旧工程。
- 新增资源链：HTTP → ResourceCatalogService授权/校验 → JdbcResourceRepository。支持集群注册/启停、不可覆盖的数据集版本及位置、分页查询、候选本地性/格式/禁用原因检查。预览不创建Execution，不选择最终位置、不预约或派发。
- S4-02a保留应用契约版本登记/查询及类型/默认值/choices/数据集约束。撤销自动Flow Input派生、共享别名与choices求交集，不生成InputRef/Literal；作者显式定义Flow输入及Task来源。没有第二套alias/binding。
- 应用链：HTTP → ApplicationCatalogService → JdbcApplicationRepository（数据集规则走资源公开接口）。删除独立参数绑定链及两个HTTP接口；prepareInputs没有独立消费者，BindingResolver.prepare恢复78203a7实现。Execution主链不变。
- 可运行的叶子仍仅Log/Sleep；镜像准备/分发、常驻部署、命名产物/路径注入、资源观测、容器/HTTP/SQL/隔离脚本、真实跨云选址/DQN/Repeat/算法计量/前端均未实现。目录API不会运行镜像，不保证数据存在或集群健康。
- S4-01以已发布071ff4b为基线；2026-09-10用户授权更新GitHub，本批源码、测试、协议和文档纳入Git发布。测试证据保留验证当时的基线与工作区说明；旧系统没有修改。
- S4-02a原派生方案已发布为2d3c44f，101项结果仅为历史证据。本次基于该提交修正方向，删除3个生产Java文件及6个record、2个API、1个绑定示例；表和迁移不变。当前验证见[方向修正记录](verification/VER-S4-003-explicit-flow-boundary.md)，不沿用历史101项冒充本次通过。

## 阶段看板

| 阶段 | 状态 | 验证 |
|---|---|---|
| S0 工程与文档框架 | DONE | PASS，仅脚手架；见VER-S0-001 |
| S1 定义和最小闭环 | DONE | PASS；S1历史与本次回归 |
| S2 恢复和失败语义 | DONE | PASS；S2历史与本次回归 |
| S3 通用控制流 | DONE | PASS；见VER-S3-001 |
| S4 资源与运行环境 | IN_PROGRESS | 首批目录/预览，完整阶段验收尚未满足 |
| S5 边缘卸载与研究能力 | NOT_STARTED | NOT_RUN |
| S6 P2与编辑管理 | NOT_STARTED | NOT_RUN |
| S7 迁移和上线 | NOT_STARTED | NOT_RUN |

## 本批工作包

| 工作包 | 状态 | 交付/剩余验收 |
|---|---|---|
| S4-01 | DONE | 目录、本地性、7个API、11项新增测试与75项回归通过；文档/索引/协议同步，见VER-S4-001 |
| S4-02 | IN_PROGRESS | a纯契约目录DONE、95项验证PASS；b镜像准备/分发及c常驻部署NOT_STARTED，未满足完整退出条件 |
| S4-03 | NOT_STARTED | 真实资源观测、选址/原子预约、K8s Job/产物及同Attempt接管 |
| S4-04 | NOT_STARTED | HTTP/SQL及隔离Shell/Python任务 |
| S4-05 | NOT_STARTED | P04/P05/P06/P11最小部署与故障验收 |

全部Java和测试入口见[代码索引](01-code-architecture.md)，本批职责与有意简化见[ADR-0006](decisions/ADR-0006-s4-resource-boundary.md)。[S4工作包](features/S4-resource-runtime.md)保留原阶段全部退出条件，不将未完成批次移到S5。

## 下一步

本次只完成S4-02a方向修正和回归，不进入S4-02b/c或S4-03。后续经用户确认再推进镜像准备/分发及常驻部署；真实Application/Container Task可执行时实现显式参数映射和完整运行/产物契约，不提前建ParameterBinding、新表达式系统、映射表或Runner空SPI。S5开始时再讨论计量口径。

本地运行和角色开关见[README](../README.md)。S2升级S3须停止提交、排空CREATED/RUNNING/KILLING并停机；备份新后端专用库，不混版本、不自动repair，不操作旧业务库。

## 已决事项与后续待定范围

| 编号 | 事项 | 决定与处理 |
|---|---|---|
| OPEN-001 | 已决定：backend独立Git仓库 | 公开仓库[liaoyun07/cea-system](https://github.com/liaoyun07/cea-system)，本地origin对应此仓库，main为发布分支。首次提交前的SHA256证据保留 |
| OPEN-002 | 已决定：技术版本以适用为准 | 当前保留已验证的Boot4.1.1/Jackson3/Flyway/MySQL8，不为了更新而升级 |
| OPEN-003 | 已决定：新后端Java 21 | 项目编译/运行均以21为准，现有配置已符合；不改旧工程或全局JAVA_HOME |
| OPEN-004 | 已决定：不做终端任务断线恢复 | 移出本期范围，不建设终端恢复专用查询/ACK、离线补发、断点续跑；正常终端接入/卸载和S2服务端Worker接管保留。结果不明不能盲目重投或伪造成功 |
| OPEN-005 | 后置：数据处理速率口径 | 到S5开始实现时再讨论并验证，当前不新增指标逻辑 |
| OPEN-006 | 已决定：生产部署保障 | P01/P07保留现状；P04/P05/P06/P11随S4真实运行接入最小实现；其他已选后置项不变。见[范围清单](06-deployment-safeguards-review.md)，目录API不能冒充远程接口/凭据/部署保障验收 |

## 完成记录

2026-09-08：S0-01至S0-05完成，仅工程与文档，业务测试0。[S0证据](verification/VER-S0-001-scaffold.md)保留为历史。

2026-09-08：用户授权执行S1，完成S1-01至S1-05；26项测试通过，见[S1证据](verification/VER-S1-001-durable-log.md)。记录描述当时S1，不代表当前Worker链。

2026-09-09：用户授权继续S2，实施S2-01至S2-04；统一verify于14:33:17 +08:00通过，结构索引同步，临时容器和测试JVM均已退出。S3–S7未实施。

2026-09-09：用户明确六项约束；初始化backend独立仓库，确认Java21/技术版本策略，移除终端断线恢复计划，计量后置S5，生产保障单独列为待选。仅仓库初始化与文档变更，未提交代码、未修改业务逻辑；本次验证见[范围确认记录](verification/VER-DOC-001-scope-decisions.md)。

2026-09-09：用户逐项确认生产保障范围，计划更新至0.5并分配后续阶段与最小验收；P010按P10记录。仅文档更新，S2仍DONE、S3未开始；验证续记在VER-DOC-001。

2026-09-09：用户授权开始S3，完成S3-01至S3-04；75项统一verify通过（16:26:40 +08:00），真实MySQL及独立Worker/Scheduler JVM验证完成。旧系统未改、S4未开始；详细证据见VER-S3-001。

2026-09-09：用户指定公开仓库cea-system，创建liaoyun07/cea-system并配置origin；将S1–S3快照作为首次发布。此任务仅Git发布与版本管理说明更新，不修改业务代码；业务测试沿用上述75项结果，本次另检查上传文件、敏感配置、结构链接和源码快照一致性。

2026-09-09：用户授权开始S4，计划更新至0.7，分S4-01至S4-05验证。首批资源目录与候选本地性完成，86项统一验证于18:01:48 +08:00通过；剩余Job/镜像/预约/通用任务/保障验收没有标为完成，证据见VER-S4-001。

2026-09-10：用户授权更新GitHub，发布S4-01源码与文档到cea-system/main。本次仅Git发布与发布说明更新，不修改业务逻辑；业务测试沿用2026-09-09的86项结果，不声称本次重新运行，另执行结构/链接和待上传内容检查。

2026-09-10：用户授权开始S4-02，按ADR-0007完成应用契约版本与参数绑定子批次a，101项统一验证于00:57:29 +08:00通过；计划0.8保留镜像准备/分发及常驻部署的真实验收，未动旧系统，未再次Git发布。完整验证记录见VER-S4-002。

2026-09-10：用户要求以后较大的新增/修改完成后更新GitHub，持续授权写入AGENTS.md，并同步计划中的发布约束。本次仅更新工作约定，不修改业务逻辑、不推进阶段；已有未提交S4-02a改动保持不变，未重跑业务测试。


2026-09-10：S4-02a原版本发布为2d3c44f。用户随后要求撤销自动派生，按修订ADR-0007保留应用目录，恢复Flow显式声明边界；没有新增业务能力或数据库迁移，S4-02仍IN_PROGRESS，b/c与S4-03未开始。clean后统一verify于01:53:56 +08:00通过95项（19单元+72真实MySQL集成+3协议+1架构），0失败/错误/跳过，见VER-S4-003。按持续授权纳入本次GitHub发布。
