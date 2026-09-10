# 当前进度

更新时间：2026-09-10。S5-04a终端Docker与接入权限闭环已完成，18:41:25完整verify通过175项Maven测试和7项Python测试，失败过程及最终结果见[验收记录](verification/VER-S5-005-terminal-docker.md)。S5整体仍IN_PROGRESS；04b卸载决策/画像和05计量尚未实现。

## 当前事实

- S5-04a：用户已确认参与算法执行的终端安装Docker。复用Application及原Worker链，新增显式TERMINAL目标、Docker context配置及可信来源检查；代码/验证边界见[协议](contracts/s5-terminal-docker.md)。尚未实现自动卸载，规则/DQN、画像反馈和终端容量队列仍待04b。

- S5-03：外部CONNECT网关账号、集群/终端归属及心跳；USER/EDGE_POLICY管理隔离；终端多节点请求和事件策略均提交原Execution，结果校验终端归属后查询原状态/outputs。未复制Executor/Binding/执行状态，未部署代理。详见ADR-0014及接入协议。

- S5-02b：Loop支持有界数组、ITEM上下文、并发任务组、显式有序输出；动态candidateClusters和集合文件清单与真实Application闭环。40项/重启/失败/取消、两种客户端数量和清单接管已测试。没有新增业务表/列/状态或第二套执行链；Kestra差异见[ADR-0013](decisions/ADR-0013-loop.md)。

- 独立8模块，78份生产Java（含8份包声明），10个测试类（含1个Failsafe部署测试）；S5-04a新增ContainerTask/DockerTaskRunner，模块依赖不变，runtime不依赖业务模块。
- 单一Flow/Binding/Execution/TaskRun/Attempt模型；显式Flow Input和Task来源，不派生Input，不存在alias/plan/resolve第二套绑定。
- 主链：提交 → Executor派发 → Worker租约执行 → 持久结果 → Executor归并/重试/Errors/Finally。Application适配资源/应用公开接口，按显式目标选择KubernetesJobRunner或DockerTaskRunner；没有第二套Executor。
- 叶子支持Log/Sleep、真实Application Job或终端Docker、HTTP GET/POST、MySQL只读参数化SELECT。Shell/Python在Application容器内执行，不在宿主执行。HTTP POST结果不明时不重发，自动retry禁止；SQL写入未支持。
- 资源目录预览仍只检查声明。执行时另外检查Ready可调度节点、数据集本地性，原子占用平台Job槽；不是CPU/内存物理预约，不使用终端卸载DQN。
- 镜像按digest准备；Job按TaskRun/Attempt固定命名。Worker中断/强杀后接管同Job。取消/超时等待Pod停止才释放名额并进入Finally。命名输入、数据集文件和输出通过后端Kubernetes文件API/S3转运，镜像不带存储凭据。
- V1–V13共19张业务表；S5-03增加Flow head管理范围及edge四表，不复制Execution状态。S5-01给TaskRun增加parent_task_run_id/iteration；S5-02b复用这两个字段，V11将唯一约束扩展到父作用域，无新业务表/列。Worker传输沿用S4的cancel_reason/prepared_json。S5-02b没有新映射表/领域状态/hash；S5-03的接入请求hash用于原始事件去重，执行状态仍不复制，字段消费者见接入协议。
- 当前39个HTTP操作，43个公开record映射。S5-03新增12个管理/接入操作；沿用既有Flow/Execution链，不新增Worker HTTP端点。
- 最新完整verify于18:41:25通过175项：runtime 31、持久化/恢复86、接入17、真实镜像/Job/Docker 30、HTTP/SQL 6、协议3、架构1、实际JAR启动1，另7项Python数值测试；零失败/错误/跳过。不累加此前定向测试，S5整体仍未完成。
- Repeat由原Executor持久推进显式状态反馈，每轮新TaskRun；整轮子图成功后才进入下一轮。重试仍增加同轮Attempt，轮间重启不重复已完成任务；当前支持固定1..100轮，可以内含Loop，不支持Repeat嵌套或条件循环。
- 真实环境仅单机Docker中的隔离MySQL/Registry/K3s/MinIO及独立JVM，未动旧web-platform/amis、旧DB、旧集群或旧镜像。不是实际跨地域多云性能/容灾验收。
- FedAvg/FedProx通过五个应用契约、一个共享CPU镜像和两个显式Flow运行；真实MNIST子集/独立测试256条、动态客户端两轮，逐张量验证训练/加权聚合与全局评估。模板经API登记为数据库修订，无Java内置模板；S5-02b为通用Loop改动现有Java与V11索引，不新增生产Java文件/表/API/SPI。
- 仍未实现：其他流任务、前端/No-code、网关代理部署/终端卸载DQN、S5计量；也不支持SQL写入、任意HTTP方法、distroless/Windows镜像、强删Job后的exactly-once恢复。联邦学习测试不是全量精度、真实多云或吞吐验收；旧执行历史、模型JSON和既有Harbor未迁移。
- 详细语义：[Job协议](contracts/s4-job-execution.md)、[通用任务](contracts/s4-common-tasks.md)、[最小部署](operations/s4-minimal-deployment.md)。设计取舍见ADR-0009/0010；完整源码索引见架构文档。

## 阶段看板

| 阶段 | 状态 | 验证 |
|---|---|---|
| S0 工程与文档框架 | DONE | PASS，仅脚手架；见VER-S0-001 |
| S1 定义和最小闭环 | DONE | PASS；S1历史与本次回归 |
| S2 恢复和失败语义 | DONE | PASS；S2历史与本次回归 |
| S3 通用控制流 | DONE | PASS；见VER-S3-001 |
| S4 资源与运行环境 | DONE | PASS；123项统一verify，见VER-S4-005；最小范围与限制见下文 |
| S5 边缘卸载与研究能力 | IN_PROGRESS | S5-01/02/02b/03/04a PASS；175项Maven及7项Python全量通过，04b与05未实现 |
| S6 P2与编辑管理 | NOT_STARTED | NOT_RUN |
| S7 迁移和上线 | NOT_STARTED | NOT_RUN |

## 本批工作包

| 工作包 | 状态 | 交付/剩余验收 |
|---|---|---|
| S4-01 | DONE | 目录、本地性、7个API、11项新增测试与75项回归通过；文档/索引/协议同步，见VER-S4-001 |
| S4-02 | DONE | a纯契约目录保留，b真实镜像分发/c常驻部署完成；103项统一verify PASS，见VER-S4-004 |
| S4-03 | DONE | 真实Job/产物/同Attempt接管/取消/平台槽及全量回归PASS |
| S4-04 | DONE | GET/POST、只读SQL、隔离Shell/Python及全量回归PASS |
| S4-05 | DONE | 真实JVM强杀、DB短时故障、可执行JAR空库启动与统一验收PASS |
| S5-01 | DONE | Repeat定义/状态反馈/新轮次/屏障/恢复/重试/取消，真实容器产物及统一verify PASS，见VER-S5-001 |
| S5-02 | DONE | 仅FedAvg/FedProx，真实训练/聚合/评估数值、API注册和全量回归PASS，见VER-S5-002 |
| S5-02b | DONE | 通用Loop、ITEM、动态集群、集合文件；150项全量verify和7项Python PASS，见VER-S5-003 |
| S5-03 | DONE | 后端接入/策略及统一结果查询，完整回归和收尾复测PASS，见VER-S5-004；未部署网关代理 |
| S5-04a | DONE | 终端Docker、真实来源/接入权限、文件/结果、retry/timeout/cancel/接管及全量回归PASS；不等于自动卸载 |
| S5-04b | NOT_STARTED | 保留终端卸载资格、规则/DQN、画像/反馈和容量队列验收 |
| S5-05 | NOT_STARTED | 计量口径待确认，本轮不实现 |

全部Java和测试入口见[代码索引](01-code-architecture.md)，本批职责与有意简化见[ADR-0006](decisions/ADR-0006-s4-resource-boundary.md)。[S4工作包](features/S4-resource-runtime.md)保留原阶段全部退出条件，不将未完成批次移到S5。

## 下一步

下一子批为S5-04b：终端卸载资格、规则/DQN、画像与反馈，以及终端容量队列；先设计真实消费者，再实施。数据处理速率口径尚待讨论确认，本批没有新增SDK或计算逻辑。SQL写入、更多HTTP方法、任意镜像运行和生产高可用不属于本次已完成能力。

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

2026-09-10：按用户确认的Docker方向完成S5-04a。新增ContainerTask/DockerTaskRunner两份生产Java；Container.execution、Prepared.dockerContext和Settings.terminals均有执行消费者，无新表/列/迁移/HTTP API/Binding/SPI。修复网关CONNECT账号在真实Application Worker中的权限缺口；保持普通集群选址不变。175项Maven及7项Python完整verify于18:41:25通过，含真实文件链、非零/缺文件、重试/超时/取消及同Attempt接管，见[VER-S5-005](verification/VER-S5-005-terminal-docker.md)。按持续授权提交GitHub；S5-04b及05未实施，物理终端/SSH连接尚未验证。

2026-09-10：S5-03按后端协议最小范围完成。新增6份生产Java、4张edge表、1个Flow head管理范围字段和12个HTTP操作；删除无消费者的Repository旧保存包装，没有新Runner/SPI/Binding或执行状态机。166项全量及7项Python测试通过，权限收尾后107项定向verify通过，证据见[VER-S5-004](verification/VER-S5-004-edge-access.md)。按持续授权提交GitHub；网关代理部署、S5-04/05、S6/S7及旧系统切换未实施。

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

2026-09-10：用户授权完成剩余S4，本批完成S4-02b/c。统一verify于02:33:49 +08:00通过103项；新增8个生产Java、5个API，无新表/迁移/SPI，Execution主链未变。镜像复制/常驻部署使用真实Registry/K3s及限定namespace凭据测试，见[验证记录](verification/VER-S4-004-image-deployment.md)。S4-03/04/05未标完成，按持续授权提交发布此可验收子批次。

2026-09-10：继续完成S4-03/04/05，123项统一verify于13:07:08 +08:00通过，S4按已记录的最小范围DONE。新增8份生产Java、1张预约表、2个Worker传输字段，无新HTTP操作或自动Flow Input/alias；真实Job/文件/通用任务、强杀/DB短时故障和实际JAR验收见[VER-S4-005](verification/VER-S4-005-external-task-runtime.md)。按持续授权提交GitHub，S5未进入。

2026-09-10：用户授权开始S5，完成首批S5-01通用Repeat。最终133项统一verify于13:54:58 +08:00通过；新增Repeat嵌套record、Task.repeat与TaskRun两个字段，V10无新业务表/生产Java文件/API/Binding来源。沿用Executor/Worker链；真实两轮文件反馈与整轮屏障、失败/重试/取消/轮间恢复见[VER-S5-001](verification/VER-S5-001-repeat.md)。按持续授权提交GitHub；S5整体IN_PROGRESS，02–05未实现，不进入S6/S7。

2026-09-10：用户限定本批只迁移FedAvg/FedProx，完成S5-02/FL-001。新增Python算法镜像源码、数据准备、两份Flow、五份契约和API注册脚本；没有生产Java/数据库/API变化。最终135项Maven及7项Python测试于15:00:58 +08:00通过；真实MNIST子集两轮、22个Job及数值核对见[VER-S5-002](verification/VER-S5-002-federated.md)，中途失败和修正一并留档。按持续授权纳入GitHub发布；S5仍IN_PROGRESS，不迁移其他流任务，不进入03–05或S6/S7，不动旧系统。
