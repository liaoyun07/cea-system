# 当前进度

最新完成：UI-06执行Metrics已发布CEA，新增已有JSON产物的受权只读接口及前端指标选择/实例明细/图表；不改执行链、表或算法镜像。2026-09-12 17:00:24完整verify 216项通过；40项Node、42项浏览器、构建/格式/scaffold通过，真实FedAvg/FedProx两轮原值与文件一致。用户确认后17:15仅替换前后端，17:16:52实际18080的两算法历史指标图/表、刷新、桌面/390px复核PASS；FedAvg r5/FedProx r3及其历史、4条Execution、38个TaskRun及Attempt未变，其余10容器ID/StartedAt/镜像ID未变。没有重跑生产训练。[规格](features/UI-06-execution-metrics.md)，[验证](verification/VER-UI-006-execution-metrics.md)。

最新完成：UI-05只读执行拓扑、轮次/item实例选择、TaskRun输出/时间/尝试，以及两个联邦Flow显式数据集SELECT。36项Node、40项真实浏览器、215项Maven及构建/格式/scaffold通过。2026-09-12 14:45只更新CEA前端，FedAvg r4→r5、FedProx r2→r3；14:46:19实际页面只读复核PASS，历史修订和四条执行未变，其余11个容器ID/StartedAt未变。无Java/API/表/执行主链变化，未增加Pod日志或产物内容/指标解析。见[验证记录](verification/VER-UI-005-execution-inspection.md)。

最新完成：UI-02d仅将Loop.values每项改为JSON文本框，保留逐项增删排序/来源与原DSL；不扩展inputs或统一任务表单方案。31项Node、37项浏览器、215项Maven及构建/格式/scaffold通过；2026-09-12 02:45只更新CEA前端，实际18080页面只读复核PASS，两Flow及四条历史执行不变，其余11个服务未重启。无Java/表/API或执行链变化。见[验证记录](verification/VER-UI-002d-loop-json-items.md)。

最新完成：UI-02c任务表单按类型必填前置/其余纵向排列，Loop/Repeat配置展平，values来源改普通下拉，保留原YAML路径/Binding和保存执行链。31项Node、37项浏览器、215项Maven及构建/格式/scaffold通过；2026-09-12 01:44仅更新CEA前端，01:45实际页面只读复核PASS，两Flow及四条历史执行不变，其余11个服务未重启。无Java/表/API变化，集合元素递归编辑仍保留。详见[验证记录](verification/VER-UI-002c-task-form-layout.md)。

最新完成：UI-04 SELECT输入。固定字符串values、默认值/必填/成员校验、No-code选项编辑及执行下拉已接通，保留唯一Flow/Binding/Execution链。30项Node、36项真实浏览器、215项Maven及构建/格式/scaffold通过。用户确认后于2026-09-12 01:01同步更新CEA前后端，01:05部署只读复核PASS；现有两Flow的源码/修订及四条历史执行的输入/输出/状态未变，其他十个容器ID/StartedAt未变。无新增Java类、表/列、API或SPI；暂不支持动态选项和多选。详见[SELECT规格](features/UI-04-select-input.md)与[验证记录](verification/VER-UI-004-select-input.md)。

最新完成：UI-02b Loop.values支持就地Array逐项/对象/嵌套数组编辑、类型与引用切换、增删排序；FedAvg/FedProx不再暴露clients启动输入。29项Node、34项真实浏览器、212项Maven及构建/格式/scaffold通过。2026-09-12 00:26只更新CEA前端，两个Flow经CAS分别保存为r4/r2，历史及其他配置保留；00:29实际页面与目录/历史执行只读复核PASS，其余11个容器ID/StartedAt未变。无生产Java、表、API或执行链变化，故障与验证详情见[记录](verification/VER-UI-002b-loop-values.md)。

最新调整：UI-02a候选集群选择已增加高亮/勾选和取消，按钮紧邻列表，状态与YAML双向同步。29项Node、30项真实浏览器回归、212项Maven（17:20:21完成）、构建/格式/scaffold通过；首次模板漏timeout及上线截图发现hover冲突均已修正并重测。用户确认后17:13发布最终前端，实际CEA的1440px/650px选中/取消和查询复核PASS，其他11个容器ID及StartedAt未变。无Java/表/API/调度语义变更。见[记录](verification/VER-UI-002a-cluster-selection.md)。

最新调整：UI-03a页面说明直接删除，未改成展开帮助或悬浮提示；必要字段、数据及错误/确认/结果保留。29项Node、29项真实浏览器、212项Maven完整回归及构建/格式/结构检查通过；十页真实CEA只读数据预览与1440px/650px截图检查通过。用户确认后于15:03更新18080前端，只读部署复核PASS，其余11个容器ID和StartedAt均未变。无Java、表、API或执行链变更；见[记录](verification/VER-UI-003a-copy-cleanup.md)。

最新完成：UI-03已有管理能力迁移并更新CEA的18080前端。应用契约版本与真实镜像准备、Deployment创建/状态/版本前置删除、集群/数据集、网关/终端登记启停、同源策略No-code/YAML/CAS及卸载观测只读均已接通。最终29项Node、28项真实JAR/Registry/K3s浏览器回归、212项Maven及12项Python通过；首轮测试定位/断言问题如实保留在[UI-03验收](verification/VER-UI-003-management.md)。14:31:01实际CEA只读复核PASS：应用5、集群4、数据集2，空网关/终端/策略/观测和部署列表与API一致。只替换frontend，其他11个容器ID及StartedAt均未变；生产Java、表、API和执行主链未改。仍缺后端接口的功能见[迁移矩阵](features/UI-03-management.md)，不是全部旧页面或S7完成。

上一批：UI-02同源No-code已实现并更新CEA的18080前端。任务块/单表单、显式Binding与目录选择、YAML联动、修订比较回退复用原API；最终23项Node单测、19项真实JAR浏览器回归、构建/格式检查和实际CEA只读复核PASS。后端完整verify首轮两项超时，未改代码或测试阈值，13:39:37第二轮212项Maven及容器内12项Python通过，失败经过保留在[UI-02验收](verification/VER-UI-002-no-code.md)。只替换frontend，其余11个CEA容器ID/StartedAt均不变，未改业务模板、执行数据、Java、表或API。不是完整Kestra、管理台全迁移或S7完成。

部署基线：DEPLOY-01独立D盘cea部署。Docker数据路径迁移、12个专用服务、四集群、外部连接配置已落地；FedAvg/FedProx各全量MNIST两轮/11个Job及独立数值复核PASS。整组stop/start后两Flow、四条含排错历史的Execution、全部成功产物与Job保留，再次数值/浏览器复核PASS。修正KubernetesJobRunner传文件时带宿主归属导致的权限失败；04:20:01完整212项Maven/12项Python回归PASS，无新Java类/表/API/SPI。见[实测记录](verification/VER-DEPLOY-001-cea.md)。不将S7切换标为完成，不改旧业务数据。

UI-01基线：2026-09-11用户授权UI-01独立前端最小闭环并要求参考Kestra风格/操作。[frontend](../frontend/README.md)已接通现有API，11项实际JAR浏览器联调通过，包含日志分页/动态实例检查；9项Node单测、构建及格式检查通过。Java主链未改，本次重新执行完整verify，212项Maven/12项Python于00:45:59通过。最终证据见[UI验收](verification/VER-UI-001-console.md)。S7、完整No-code、其他管理页、计量和长期DQN不在本批范围。

S6基线：剩余02–04已完成。2026-09-11 00:02:08 +08:00完整verify通过212项Maven与12项Python测试，见[S6验收](verification/VER-S6-002-files-lifecycle.md)。S6按已授权的最小后端范围DONE；S5的DQN研究和数据处理速率仍后置。

更新时间：2026-09-11。S6-01至04全部验收通过；S5已实现的核心链继续通过回归，长期DQN、计量和物理多云性能尚未完成，不因后置而标为达标。

## 当前事实

- UI-03：已有API管理页与真实部署验收完成。策略复用单一Flow编辑源和原执行器，目录版本/归属/CAS约束保持。应用注册不是镜像tar上传；Deployment更新回读不足，暂不提供编辑/启停/缩放；账号、Node/Service/Namespace、对象浏览及分发历史仍缺接口。

- UI-01：内存Basic认证、命名空间；真实Flow列表/搜索/分页、YAML源校验/Schema参考、修订CAS和未保存提示；显式Flow.inputs类型表单/预览、固定修订及未决请求同键重试；Execution/TaskRun/Attempt、增量日志、取消、主结果与afterExecution展示。前端独立npm工程，不增Java、表、API或第二套绑定。原先“前端未实现”的记录指此批之前或完整前端范围。

- S6-02至04：固定版本Namespace小型文本文件进入原Application Prepared/容器文件链；认证Webhook和统一Checks；SLA首次超限持久查询；AFTER_EXECUTION阶段通过原Executor/Worker运行，主终态/输出/结束时间不被后处理错误改写。完整回归通过，见[S6协议](contracts/s6-files-lifecycle.md)。

- S6-01：从同一FlowDefinition生成编辑Schema；校验/输入预览不创建执行；批量导入复用修订CAS和事务，搜索/导出维持USER管理范围。JSON和YAML共享解析/校验/保存，不存在独立No-code绑定；完整前端未实现。

- S5-04：用户确认终端Docker；显式TERMINAL+offload才进行规则或已注册单步Q模型决策及观测。04c中普通CLUSTER和固定TERMINAL不再读写卸载画像；终端FIFO以同Attempt预约并在确认停止后按实际资源预约释放，不重复派发；详情见[协议](contracts/s5-terminal-offloading.md)。

- S5-03：外部CONNECT网关账号、集群/终端归属及心跳；USER/EDGE_POLICY管理隔离；终端多节点请求和事件策略均提交原Execution，结果校验终端归属后查询原状态/outputs。未复制Executor/Binding/执行状态，未部署代理。详见ADR-0014及接入协议。

- S5-02b：Loop支持有界数组、ITEM上下文、并发任务组、显式有序输出；动态candidateClusters和集合文件清单与真实Application闭环。40项/重启/失败/取消、两种客户端数量和清单接管已测试。没有新增业务表/列/状态或第二套执行链；Kestra差异见[ADR-0013](decisions/ADR-0013-loop.md)。

- 独立8模块，86份生产Java（含8份包声明），12个测试类（含1个Failsafe部署测试）；本轮新增NamespaceFileService和两个Controller，未新增测试类。模块依赖未增加，runtime仍不依赖业务模块。
- 单一Flow/Binding/Execution/TaskRun/Attempt模型；显式Flow Input和Task来源，不派生Input，不存在alias/plan/resolve第二套绑定。
- 主链：统一提交Checks → Executor派发 → Worker租约执行 → 持久结果 → Executor归并/重试/Errors/Finally → 主终态 → 同链afterExecution。Application适配资源/应用公开接口，按显式目标选择KubernetesJobRunner或DockerTaskRunner；没有第二套Executor。
- 叶子支持Log/Sleep、真实Application Job或终端Docker、HTTP GET/POST、MySQL只读参数化SELECT。Shell/Python在Application容器内执行，不在宿主执行。HTTP POST结果不明时不重发，自动retry禁止；SQL写入未支持。
- 资源目录预览仍只检查声明。执行时另外检查Ready可调度节点、数据集本地性，原子占用平台Job槽；不是CPU/内存物理预约，不使用终端卸载DQN。
- 镜像按digest准备；Job按TaskRun/Attempt固定命名。Worker中断/强杀后接管同Job。取消/超时等待Pod停止才释放名额并进入Finally。命名输入、数据集文件和输出通过后端Kubernetes文件API/S3转运，镜像不带存储凭据。
- V1–V17共23张业务表；V16新增df_namespace_file，V17新增sla_violated_at并扩大phase列；04b增加resource终端预约表、offloading观测/模型两表，不复制Execution。字段真实消费者见卸载协议；既有接入hash、Worker prepared_json、TaskRun轮次/所属作用域语义保持。
- 当前51个HTTP操作、58个公开record映射。本轮增加3个文件操作和Webhook，Check/Sla/NamespaceFile引用及文件API record；无新Worker端点、Binding、Runner或SPI。
- 本批完整verify通过212项：runtime33、持久化86、接入18、编辑/文件/生命周期21、容器/联邦33、卸载10、HTTP/SQL6、协议3、架构1、实际JAR1；另Python7+5项通过。全部零失败/错误/跳过，不重复累加定向复测；失败与修正保留在VER-S6-002。
- Repeat由原Executor持久推进显式状态反馈，每轮新TaskRun；整轮子图成功后才进入下一轮。重试仍增加同轮Attempt，轮间重启不重复已完成任务；当前支持固定1..100轮，可以内含Loop，不支持Repeat嵌套或条件循环。
- 真实环境仅单机Docker中的隔离MySQL/Registry/K3s/MinIO及独立JVM，未动旧web-platform/amis、旧DB、旧集群或旧镜像。不是实际跨地域多云性能/容灾验收。
- FedAvg/FedProx通过五个应用契约、一个共享CPU镜像和两个显式Flow运行；真实MNIST子集/独立测试256条、动态客户端两轮，逐张量验证训练/加权聚合与全局评估。模板经API登记为数据库修订，无Java内置模板；S5-02b为通用Loop改动现有Java与V11索引，不新增生产Java文件/表/API/SPI。
- 仍未实现：其他流任务、完整Kestra工作台、账号及完整Node/Service/Namespace管理前端、网关代理部署/终端卸载DQN、S5计量；也不支持SQL写入、任意HTTP方法、distroless/Windows镜像、强删Job后的exactly-once恢复。联邦学习测试不是物理多云或吞吐验收；旧执行历史、模型JSON和既有Harbor未迁移。
- 详细语义：[Job协议](contracts/s4-job-execution.md)、[通用任务](contracts/s4-common-tasks.md)、[最小部署](operations/s4-minimal-deployment.md)。设计取舍见ADR-0009/0010；完整源码索引见架构文档。

## 阶段看板

| 阶段 | 状态 | 验证 |
|---|---|---|
| S0 工程与文档框架 | DONE | PASS，仅脚手架；见VER-S0-001 |
| S1 定义和最小闭环 | DONE | PASS；S1历史与本次回归 |
| S2 恢复和失败语义 | DONE | PASS；S2历史与本次回归 |
| S3 通用控制流 | DONE | PASS；见VER-S3-001 |
| S4 资源与运行环境 | DONE | PASS；123项统一verify，见VER-S4-005；最小范围与限制见下文 |
| S5 边缘卸载与研究能力 | IN_PROGRESS | S5-01/02/02b/03/04最小范围PASS；188项Maven及12项Python通过，05未实现 |
| S6 P2与编辑管理 | DONE（后端最小范围） | 01–04及212项Maven/12项Python完整回归PASS；不含完整前端 |
| S7 迁移和上线 | NOT_STARTED | NOT_RUN |

## 本批工作包

| 工作包 | 状态 | 交付/剩余验收 |
|---|---|---|
| UI-03a | DONE（已部署） | 常驻说明直接删除；29项Node/29项浏览器/212项Maven PASS，CEA前端更新及只读复核PASS |
| DEPLOY-01 | DONE（独立单机部署） | D盘Compose、独立配置/凭据、四集群两算法、22个成功Job、全量数据数值/浏览器/重启复核PASS；Pod stdout汇入日志、物理多云、旧切换不在范围 |
| UI-01 | DONE（最小前端） | 原API源编辑/保存/固定修订执行/详情，9项Node及11项真实浏览器联调PASS；不是完整No-code或全管理台 |
| UI-02 | DONE（当前DSL范围） | 23项Node/19项真实JAR浏览器及212项Maven/12项Python完整回归PASS，CEA前端更新/只读复核PASS；首轮失败保留在VER-UI-002 |
| UI-03 | DONE（已有API范围） | 29项Node/28项真实浏览器、212项Maven/12项Python PASS；只更新CEA前端并只读复核，缺口见VER-UI-003 |
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
| S5-04b | DONE | 显式卸载、规则/单步Q、画像/反馈和终端FIFO及全量回归PASS；不宣称长期DQN或策略性能最优 |
| S5-04c | DONE | 普通执行/资源释放最小解耦，观测表不可用真实产物链及完整188项Maven/12项Python回归PASS，见VER-S5-007 |
| S5-05 | 后置（仅设计） | 用户同意先跳过；MET-001业务代码未实现，口径未确认，见[S5-05方案](features/S5-05-measurement.md) |
| S6-01 | DONE | 统一编辑协议、原子导入/导出/搜索；199项Maven/12项Python完整回归及14项收尾复测PASS，见VER-S6-001 |
| S6-02 | DONE | 业务闭环、故障/权限与完整verify PASS；见VER-S6-002 |
| S6-03 | DONE | 业务闭环、故障/权限与完整verify PASS；见VER-S6-002 |
| S6-04 | DONE | 业务闭环、故障/权限与完整verify PASS；见VER-S6-002 |

全部Java和测试入口见[代码索引](01-code-architecture.md)，本批职责与有意简化见[ADR-0006](decisions/ADR-0006-s4-resource-boundary.md)。[S4工作包](features/S4-resource-runtime.md)保留原阶段全部退出条件，不将未完成批次移到S5。

## 下一步

CEA部署已可直接使用，入口18080；凭据见本地deploy/cea/.env，启动/升级/证据见[部署说明](../deploy/cea/README.md)。不要重复首次seed或清空卷。C盘Docker迁移前副本仍保留；没有释放这部分C盘占用。完整管理台、Pod日志采集、物理网关、S7及新增功能需要后续确认。

S6后端范围已完成并按持续授权发布GitHub；下一阶段或完整前端需用户另行确认，不自动进入S7。S5-05计量和长期多步DQN后置，不作为S6前置；策略性能对比、物理终端SSH、SQL写入、更多HTTP方法及生产高可用均未宣称完成。

本地运行和角色开关见[README](../README.md)。S2升级S3须停止提交、排空CREATED/RUNNING/KILLING并停机；备份新后端专用库，不混版本、不自动repair，不操作旧业务库。

## 已决事项与后续待定范围

| 编号 | 事项 | 决定与处理 |
|---|---|---|
| OPEN-001 | 已决定：backend独立Git仓库 | 公开仓库[liaoyun07/cea-system](https://github.com/liaoyun07/cea-system)，本地origin对应此仓库，main为发布分支。首次提交前的SHA256证据保留 |
| OPEN-002 | 已决定：技术版本以适用为准 | 当前保留已验证的Boot4.1.1/Jackson3/Flyway/MySQL8，不为了更新而升级 |
| OPEN-003 | 已决定：新后端Java 21 | 项目编译/运行均以21为准，现有配置已符合；不改旧工程或全局JAVA_HOME |
| OPEN-004 | 已决定：不做终端任务断线恢复 | 移出本期范围，不建设终端恢复专用查询/ACK、离线补发、断点续跑；正常终端接入/卸载和S2服务端Worker接管保留。结果不明不能盲目重投或伪造成功 |
| OPEN-005 | 后置：S5-05数据处理速率 | 用户同意先跳过。候选口径仅保留讨论，不新增SDK/指标逻辑，不阻塞S6 |
| OPEN-006 | 已决定：生产部署保障 | P01/P07保留现状；P04/P05/P06/P11随S4真实运行接入最小实现；其他已选后置项不变。见[范围清单](06-deployment-safeguards-review.md)，目录API不能冒充远程接口/凭据/部署保障验收 |

## 完成记录

2026-09-11：UI-01独立Vue工作台最小闭环完成，参考Kestra侧栏/列表/源编辑/执行详情；只消费原API，不修改Java、DB、旧AMIS或执行主链。9项Node单测、11项真实JAR浏览器测试、构建/格式检查通过；212项Maven/12项Python本次全量回归通过。启动步骤及限制见frontend/README，失败原因/修复见VER-UI-001。按持续授权提交并更新GitHub。

2026-09-11：完成S6-02至04。固定修订Namespace文本文件进入真实Application/Prepared；认证Webhook及所有提交入口Checks；SLA告警与原Executor的终态后处理。新增3份生产Java、4个HTTP操作、6个record、1张文件表、SLA时间列与phase扩容，无新Binding/Runner/SPI/执行链。212项Maven和12项Python完整verify于00:02:08通过，见VER-S6-002。S6后端阶段DONE，前端、S7、计量和长期DQN仍未实现。

2026-09-10：完成S6-01。新增FlowSchema一份生产Java、5个API及5个请求/响应record，修改既有Flow服务/解析器/Repository；无新数据库表/列/迁移、DSL字段、状态机或SPI。统一Flow编辑与真实执行往返、原子导入/并发/权限及完整199项Maven和12项Python验证PASS；14项中文/契约收尾复测PASS，见VER-S6-001。按持续授权发布GitHub，S6-02至04与完整前端未完成，S5研究/计量后置。

2026-09-10：S5-04c最小解耦完成，修改3个生产Java类，删除OffloadingService.observe，增加Resource按实际预约释放的公开重载；无新增类/字段/表/迁移/HTTP API/SPI，主执行链未变。188项Maven和12项Python完整verify于22:27:16通过，见VER-S5-007。S5-05已记录设计，但用户选择先讨论计量口径，未实施SDK/计量代码。按持续授权发布本次解耦与文档。

2026-09-10：完成S5-04b最小闭环，新增4份生产Java、3张表及3个HTTP操作，增加显式Offload和终端slots配置；dataflow只经offloading/resource公开服务调用，不改变Executor/Worker状态所有权，无新Binding/Runner/SPI。真实三位置执行、实际反馈训练模型及Java执行闭环通过，188项Maven与12项Python最终verify于20:16:31通过，见[VER-S5-006](verification/VER-S5-006-terminal-offloading.md)。按持续授权发布GitHub；单步Q是有意简化，未做长期DQN、物理多云性能或S5-05。

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
