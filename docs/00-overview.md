# 系统总览

FLDATA-01（2026-09-15已发布CEA）：FedAvg/FedProx增加CIFAR-10/CIFAR-100，沿原Flow SELECT→显式参数→DatasetRule/Placement→Pod文件助手→算法本地文件的链路。init仅校验训练/测试版本引用来确定模型形状，不下载数据；原数据仍在中心存储，任务产物仍按实际执行位置写入。无平台模块/Java/API/数据库结构变化；[协议](contracts/federated-datasets.md)、[实际验收](verification/VER-FLDATA-01-cifar.md)。

MET-001（2026-09-15，发布状态见[进度](04-progress.md)）：公共SDK记录完整算法输入/输出文件大小与活动时点，原文件助手发布报告，dataflow从成功Attempt受权读取后汇总区间并集。概览只显示一个数据处理速率。不增加表、计量服务或第二执行链；历史无报告不回填。[协议](contracts/algorithm-measurement.md)。后文旧阶段“计量未实现”为对应历史时点。

OFF-04增量（2026-09-14已发布CEA）：原终端请求链在Resource冻结真实六维后，经可信控制连接交所属边缘网关做Double DQN选层；具体位置继续原Placement，执行/文件/反馈继续原Runner。PyTorch离线消费完整next转移，回放/目标网络/显式探索与固定版本评估已实现。无新Java/API/表/SPI，108个生产Java、92个HTTP操作、28张业务表不变。真实114次请求、五基线比较及实际页面已通过；DQN未优于本次全终端基线，未证明性能达标，见[协议](contracts/off04-double-dqn.md)及[验证](verification/VER-OFF-04-double-dqn.md)。下列各批“待实现”保留为历史状态。

OFF-03增量（2026-09-14已发布CEA）：Resource接纳工作量与传输事实，Offloading冻结六维及下一决策关联，终端经网关反馈本进程端到端时间。原Executor/Worker/Placement/Runner状态所有权不变；新计量不进入普通Flow，不实现Double DQN。六次真实执行、传输/工作量/乱序反馈及页面核验通过，见[验证](verification/VER-OFF-03-measured-feedback.md)。协议见[真实状态与反馈](contracts/off03-measurement.md)，下列OFF-02待做描述为历史时点。

OFF-02增量（2026-09-14已发布CEA）：终端元数据请求复用策略Flow与原执行器；Application适配器新增经网关到终端代理的执行路径。本地原文件不上传，卸载后经网关先入所属边缘存储；Pod助手/Placement保持原职责。成功小JSON通过原产物权限链回到网关。CEA已验证FIXED三层及RULE；无第二套Execution/Binding/数据库状态表。当前RULE仍在后端原适配链内运行，边缘Double DQN与真实六维采集在OFF-03/04，不冒称已完成。见[当前协议](contracts/off02-terminal-gateway.md)、[验收](verification/VER-OFF-002-terminal-gateway.md)。

EP-02只读增量：边缘处理记录是原Execution按策略范围筛选的视图，由既有接入回执补充终端/网关来源；不建立第二套处理状态或执行链。页面与接口的验证/发布状态见[进度](04-progress.md)。

EP-01增量（状态见进度）：独立HTTP网关负责终端认证与本边缘文件接入，终端容器回放真实公开样本；三个策略仍调用原EdgeAccessService/FlowExecutionService/Executor/Worker，文件走FILE-01。中心不转发原始上传；留边缘/返回终端/摘要到中心由普通Flow输出绑定和任务选址表达，不增加第二套引擎。见[决策](decisions/ADR-0024-terminal-edge-ingress.md)。

FILE-01 文件传输调整（验证/发布状态见[进度](04-progress.md)）：中心控制面仍负责 Flow/Placement/Job；Kubernetes 输入/输出文件由 Pod 公共助手直接读写 S3。输出 URI 按已选执行 cluster 固定，输入 URI 标识实际存储，跨域不强制中转中心。终端 Docker 搬运、本地数据集迁移、策略触发和吞吐计量不在本批。见[决策](decisions/ADR-0023-pod-artifact-transfer.md)。

UI-10管理增量：Flow/终态Execution/未引用Dataset逻辑删除；server持久化人员身份并提供ADMIN/USER和个人中心；deployment以独立rootless BuildKit构建后复用原镜像导入/分发。Flow删除不破坏执行快照图，不做存储GC或停止工作负载；执行主链、Runner、Placement不变。状态见[进度](04-progress.md)，边界见[UI-10](features/UI-10-cleanup-users-build.md)。

UI-09已验证并发布CEA：deployment实时读取Registry库存并执行引用保护删除manifest，resource管理工作空间内Kubernetes Namespace/Service，dataflow负责应用目录删除前的Flow引用检查。目录删除与仓库删除分开；V20保留已删除应用版本身份，避免复用改变历史含义。契约tag经已授权源Registry解析为候选摘要，和已有摘要一样必须现场核验目标副本。Kubernetes是资源事实源，不增加管理状态表，不改变Execution/Worker/Runner/Placement。范围、权限代价与验证状态见[UI-09](features/UI-09-registry-kubernetes-management.md)及[进度](04-progress.md)。

UI-08核心运维增量（已验证、已发布CEA）：deployment负责镜像归档导入、不可变应用登记、按需分发历史和常驻部署配置/CAS/计时；resource负责Metrics API近期用量，server只装配与鉴权适配。新增两张业务表保存分发和部署操作证据，Kubernetes仍唯一拥有Deployment期望/实际状态，执行主链不变。227项Maven、45项Node、47项浏览器通过，具体见[协议](contracts/ui08-deployment-operations.md)与[验收](verification/VER-UI-008-core-deployment-operations.md)。

UI-07：执行总览读取runtime拥有的执行窗口聚合；产物声明读取不可变Execution.definition，内容按实际TaskRun读取已有成功JSON；Kubernetes只读页通过resource目录与显式连接访问Node、该连接Namespace及其中的Service。无新状态所有权、数据库表/列、Runner或调度路径。验证/发布状态见[进度](04-progress.md)，不是完整Kubernetes管理台。

UI-06补执行Metrics：已有JSON产物→命名空间READ授权读取→真实TaskRun实例表与单指标图；不改变算法/执行/存储所有权，不新增计量表或速率口径。当前验证与发布状态见[进度](04-progress.md)。

DEPLOY-01提供当前可运行的[独立CEA部署](../deploy/cea/README.md)：同一台Windows/Docker Desktop上12个常驻容器，D盘Linux命名卷，独立前后端、数据库、存储、四仓库和四集群。FedAvg/FedProx真实两轮及重启持久性通过；不导入旧业务数据，不等于S7切换、物理多云或吞吐验收。仅修正既有Kubernetes文件上传为字节流，没有新模型/表/执行链。算法Pod stdout尚未汇入工作台Execution日志。

UI-01/02提供[独立工作台](../frontend/README.md)：Vue客户端 → 同源/api代理 → 现有Flow/Execution API。UI-02增加任务分组/单配置面板、显式绑定/目录选择、同源YAML编辑和修订比较回退。UI-03扩展已有后端支持的应用/镜像准备/部署、资源目录和边缘管理页面，范围见[迁移矩阵](features/UI-03-management.md)。八模块、状态所有权及数据库不变；没有旧DTO/旧数据迁移，完整Kestra及S7仍未完成。

S6包含同一Flow的结构Schema、源校验/输入预览、原子导入/导出/搜索；本轮补充固定版本Namespace文件及真实Task消费、认证Webhook/统一Checks、SLA告警和终态后处理。执行状态仍由同一个Executor/Worker推进，详细边界见[编辑协议](contracts/s6-flow-editing.md)与[文件/生命周期](contracts/s6-files-lifecycle.md)。S6后端最小范围及完整回归已通过；S5计量、长期DQN和完整前端仍未实现。

基线日期：2026-09-11。S1–S3执行基础、S4资源/应用目录、镜像分发/常驻部署、一次性Job/产物与通用任务均已实现；当前验收状态与边界见[进度](04-progress.md)。

实施边界已确认：backend独立Git仓库，新后端Java21；终端任务断线恢复不在本期范围，服务端Worker恢复保留；速率口径在S5开始时确定。生产部署保障按[已确认范围](06-deployment-safeguards-review.md)落实最小认证、凭据配置、部署和单机恢复验证，其他扩展按选择保留或后置，不追求全套高可用架构。

## 目标与原则

建立独立、可恢复、可测试的云边端任务平台。通用执行模型与机制借鉴本地 Kestra；不是复制其实现，也不把 Kestra 的服务数量等同于本平台业务模块数。

优先级：成熟合理的模块边界 > 单纯对应申报书章节。模块围绕业务对象、状态所有权与生命周期划分；申报书通过功能映射体现。旧算法与外围实现按批次迁移；当前仅FedAvg/FedProx已适配新后端，其余不能视为已迁入能力。

## 目标模块

| 模块 | 负责 | 不负责 |
|---|---|---|
| platform-dataflow | Flow保存/编辑/版本、提交/查询、运行展示与流程指标 | 不另写执行状态机或 DQN |
| workflow-runtime | Flow/Binding、Execution/TaskRun/Attempt、控制任务、持久执行、Worker及后续Runner | 不包含 FedAvg、站点名等业务常量 |
| platform-deployment | 应用与契约版本、镜像仓库、分发策略及复制、常驻服务生命周期 | 不管理一次性 Flow Job 的业务状态 |
| platform-resource | 集群能力、资源观测、数据集版本/位置、普通选址与资源预约 | 不定义终端卸载奖励和决策模型 |
| platform-edge | 网关/终端接入、数据事件、边缘处理策略、结果交付 | 不持有第二套 Execution 状态 |
| platform-offloading | 原属终端且允许卸载的任务选层与决策观测 | 不选具体cluster；不处理普通任务画像；请求来自终端不是充分条件 |
| platform-foundation | 身份权限及少量公共基础能力 | 不收容所有公共业务和 Repository |
| platform-server | HTTP 协议适配、配置、模块与运行角色装配 | 不在 Controller 中编排或创建 Pod |

## 当前终端卸载增量

OFF-01：普通CLUSTER与固定TERMINAL仍不读写卸载观测；资源回收依照Prepared/实际预约。显式RULE只决定层，JobPlacementService根据可信归属边缘或服务端central-clouds范围选具体cluster；卸载配置不再含candidateClusters。新DQN决策暂停到OFF-04，S5-05计量继续后置。见[ADR-0025](decisions/ADR-0025-offloading-layer-placement.md)，当前测试/发布状态见[进度](04-progress.md)。

ApplicationTaskRunner→Resource汇总合法层负载→OffloadingService冻结同Attempt层决策→JobPlacementService选择/预约具体位置→原Docker/Kubernetes执行或OFF-02网关终端适配→记录服务端观测，Executor仍独占运行状态。terminal FIFO归resource，决策观测及旧模型存档归offloading，dataflow只调用公开服务。OFF-02已打通元数据请求及三路径；现有服务端观测不是终端端到端反馈，六维MDP仍待OFF-03。详见[协议](contracts/s5-terminal-offloading.md)。

## 目标执行关系（未全部实现）

用户编排由 dataflow 管理；边缘策略由 edge 管理。两者通过统一提交接口进入 runtime。runtime 判断就绪节点，由执行位置接口选择固定位置/普通资源规则/终端卸载策略，持久记录位置后交 Worker 执行。卸载任务使用同一 TaskRun/Attempt 与结果归并机制。

K8s 一次性 Job 生命周期属于 runtime 执行适配器；常驻 Deployment 属于 deployment。两者通过明确定义的连接和镜像准备接口复用能力，不复制状态所有权。

部署目标：中心 API/Executor/Scheduler/Worker 可分角色运行；开发允许 standalone，但同样使用持久消息。S3已实现standalone或分进程Executor/Worker/Scheduler；同一新后端MySQL承担持久传输、准入队列与定时游标。站点侧边缘网关独立运行；当前阶段不复制或启动网关，不承诺断网自治。

## 与申报书和清单的映射

逐项覆盖、尚需补充的功能和指标证据见[申报书审查表](07-proposal-audit.md)。模块归属不等于对应研究方向已经全部完成；审查结论不自动扩大实施范围。

| 研究内容 | 主要承担模块 |
|---|---|
| 云边端协同数据流处理 | dataflow + runtime + resource |
| 模块化边缘服务部署 | deployment + resource |
| 智能终端任务卸载 | offloading + resource + edge |
| 多云协作 | edge + deployment + resource + runtime |

清单 P0 为执行基础，P1 为控制流与版本，P2 为可选能力但列入后续计划；P3 暂不实施。ARM、多核专用优化、任务优先级、完整边缘自治不因目录名称而自动纳入本期，分别在功能/迁移文档标明范围。

## 当前与目标的区别

S5-04a增加显式Application TERMINAL执行路径及真实Docker适配，保留原Executor/Worker/TaskRun/Attempt链。终端来源只从接入回执取得，Docker连接由管理员配置，普通CLUSTER任务仍走原Kubernetes选址；本地执行不等于规则/DQN卸载已完成，见[协议](contracts/s5-terminal-docker.md)和当前验证状态。

04a当时通过175项Maven与7项Python完整回归，见[历史验收](verification/VER-S5-005-terminal-docker.md)。04b已增加上述显式卸载与画像，当前验证以[最新记录](verification/VER-S5-006-terminal-offloading.md)为准。以下旧批次数量均为历史；物理终端部署、长期DQN性能及计量仍未完成。

S5-03新增入口：受信网关CONNECT身份 → edge终端归属/策略事件匹配 → dataflow公开服务 → 原Execution链。策略拥有独立管理范围，但Flow定义/修订仍在原表；result直接查询原Execution，无边缘执行状态镜像或离线结果队列。后端协议及四表真实消费者见[接入协议](contracts/s5-edge-access.md)。

当前调用链：HTTP身份认证 → dataflow权限/版本/提交 → Executor派发持久WorkerJob → Worker事务外执行 → 持久结果 → Executor归并状态/日志/续消息 → dataflow查询。server负责装配，不直接写业务表。定义版本表由dataflow所有；运行表和消息由runtime所有。

当前有19张业务表，定义版本属于dataflow，执行/传输/调度属于runtime，集群/数据集/预约属于resource，应用契约属于deployment，网关/终端/策略/接入关联属于edge。模板是数据库数据，不是后端硬编码。S1–S3控制、队列、重试、Errors/Finally保持单一执行语义。

S4已接入应用目录、真实Registry复制、常驻Deployment和一次性Application Job。一次性Job与常驻部署分开；同Attempt固定镜像digest、位置、参数和Job，Worker重连接管原Job。后端暂存输入、收集输出并发布S3产物；取消须等Pod停止。普通选址检查节点健康和数据本地性、预约平台作业槽，不走终端卸载DQN。

Flow作者显式定义inputs及参数Binding，不由应用契约派生；YAML与UI-02 No-code共用唯一源文件，不存在alias/plan/resolve。HTTP GET/POST、参数化只读SQL与容器Shell/Python沿用同一Worker链。POST未知结果不自动重发；不声称通用外部副作用exactly-once。

凭据由管理员外部配置；当前鉴权与隔离集群故障验证不等于完整生产IAM、多地域容灾或性能指标验收。S4及S5-01 Repeat已验收；S5-02将FedAvg/FedProx实现为普通Application与显式Flow数据，初始化后按轮并行训练、加权聚合和全局评估，无执行器算法特例。S5-02b增加通用Loop，客户端集合动态展开为独立TaskRun；仍沿用单一Binding/Executor/Worker链，没有专用联邦状态表。150项Maven验证及7项Python测试通过，见[验收记录](verification/VER-S5-003-loop.md)。S5-03已完成后端网关/终端接入和策略入口；完整166项回归通过，收尾权限变更另复测107项通过，详见[接入验收](verification/VER-S5-004-edge-access.md)。上述为S5-03历史验收；当前S5核心执行已完成、长期DQN及计量后置，S6后端已完成，S7未进入。

## 设计来源与效力

- 课题能力清单和申报书的摘要映射见[迁移说明](migration/README.md)。
- 早期方案在同级 web-platform/docs/kestra-refactor 中，仅作历史参考；其中“卸载负责全部选址”、旧模块数量、181 文件清单不是当前实施依据。
- 当前基线以本目录、最新已接受 ADR 和用户后续要求为准；发现矛盾先记录并修正文档，不能同时实施两套模型。

S4-02b/c增加真实镜像复制及常驻Deployment链，与Execution主链分离，见[镜像/部署协议](contracts/s4-image-deployment.md)。S4-03/04/05本批实现与验收见进度；镜像准备成功不等于Flow运行成功。
