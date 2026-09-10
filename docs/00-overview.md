# 系统总览

基线日期：2026-09-10。S1–S3执行基础、S4资源/应用目录、镜像分发/常驻部署、一次性Job/产物与通用任务均已实现；当前验收状态与边界见[进度](04-progress.md)。

实施边界已确认：backend独立Git仓库，新后端Java21；终端任务断线恢复不在本期范围，服务端Worker恢复保留；速率口径在S5开始时确定。生产部署保障按[已确认范围](06-deployment-safeguards-review.md)落实最小认证、凭据配置、部署和单机恢复验证，其他扩展按选择保留或后置，不追求全套高可用架构。

## 目标与原则

建立独立、可恢复、可测试的云边端任务平台。通用执行模型与机制借鉴本地 Kestra；不是复制其实现，也不把 Kestra 的服务数量等同于本平台业务模块数。

优先级：成熟合理的模块边界 > 单纯对应申报书章节。模块围绕业务对象、状态所有权与生命周期划分；申报书通过功能映射体现。现有算法镜像和外围实现是后续迁移来源，不是当前已迁入的能力。

## 目标模块

| 模块 | 负责 | 不负责 |
|---|---|---|
| platform-dataflow | Flow保存/编辑/版本、提交/查询、运行展示与流程指标 | 不另写执行状态机或 DQN |
| workflow-runtime | Flow/Binding、Execution/TaskRun/Attempt、控制任务、持久执行、Worker及后续Runner | 不包含 FedAvg、站点名等业务常量 |
| platform-deployment | 应用与契约版本、镜像仓库、分发策略及复制、常驻服务生命周期 | 不管理一次性 Flow Job 的业务状态 |
| platform-resource | 集群能力、资源观测、数据集版本/位置、普通选址与资源预约 | 不定义终端卸载奖励和决策模型 |
| platform-edge | 网关/终端接入、数据事件、边缘处理策略、结果交付 | 不持有第二套 Execution 状态 |
| platform-offloading | 原始执行位置为终端且允许卸载的任务决策、画像与反馈 | 不等同于任意子任务选址；请求来自终端不是充分条件 |
| platform-foundation | 身份权限及少量公共基础能力 | 不收容所有公共业务和 Repository |
| platform-server | HTTP 协议适配、配置、模块与运行角色装配 | 不在 Controller 中编排或创建 Pod |

## 目标执行关系（未全部实现）

用户编排由 dataflow 管理；边缘策略由 edge 管理。两者通过统一提交接口进入 runtime。runtime 判断就绪节点，由执行位置接口选择固定位置/普通资源规则/终端卸载策略，持久记录位置后交 Worker 执行。卸载任务使用同一 TaskRun/Attempt 与结果归并机制。

K8s 一次性 Job 生命周期属于 runtime 执行适配器；常驻 Deployment 属于 deployment。两者通过明确定义的连接和镜像准备接口复用能力，不复制状态所有权。

部署目标：中心 API/Executor/Scheduler/Worker 可分角色运行；开发允许 standalone，但同样使用持久消息。S3已实现standalone或分进程Executor/Worker/Scheduler；同一新后端MySQL承担持久传输、准入队列与定时游标。站点侧边缘网关独立运行；当前阶段不复制或启动网关，不承诺断网自治。

## 与申报书和清单的映射

| 研究内容 | 主要承担模块 |
|---|---|
| 云边端协同数据流处理 | dataflow + runtime + resource |
| 模块化边缘服务部署 | deployment + resource |
| 智能终端任务卸载 | offloading + resource + edge |
| 多云协作 | edge + deployment + resource + runtime |

清单 P0 为执行基础，P1 为控制流与版本，P2 为可选能力但列入后续计划；P3 暂不实施。ARM、多核专用优化、任务优先级、完整边缘自治不因目录名称而自动纳入本期，分别在功能/迁移文档标明范围。

## 当前与目标的区别

当前调用链：HTTP身份认证 → dataflow权限/版本/提交 → Executor派发持久WorkerJob → Worker事务外执行 → 持久结果 → Executor归并状态/日志/续消息 → dataflow查询。server负责装配，不直接写业务表。定义版本表由dataflow所有；运行表和消息由runtime所有。

当前有15张业务表，定义版本属于dataflow，执行/传输/调度属于runtime，集群/数据集/预约属于resource，应用契约属于deployment。模板是数据库数据，不是后端硬编码。S1–S3控制、队列、重试、Errors/Finally保持单一执行语义。

S4已接入应用目录、真实Registry复制、常驻Deployment和一次性Application Job。一次性Job与常驻部署分开；同Attempt固定镜像digest、位置、参数和Job，Worker重连接管原Job。后端暂存输入、收集输出并发布S3产物；取消须等Pod停止。普通选址检查节点健康和数据本地性、预约平台作业槽，不走终端卸载DQN。

Flow作者显式定义inputs及参数Binding，不由应用契约派生；YAML与未来No-code共用Flow，当前No-code未实现。HTTP GET/POST、参数化只读SQL与容器Shell/Python沿用同一Worker链。POST未知结果不自动重发；不声称通用外部副作用exactly-once。

凭据由管理员外部配置；当前鉴权与隔离集群故障验证不等于完整生产IAM、多地域容灾或性能指标验收。S4本批验证状态见进度；S5–S7未进入。

## 设计来源与效力

- 课题能力清单和申报书的摘要映射见[迁移说明](migration/README.md)。
- 早期方案在同级 web-platform/docs/kestra-refactor 中，仅作历史参考；其中“卸载负责全部选址”、旧模块数量、181 文件清单不是当前实施依据。
- 当前基线以本目录、最新已接受 ADR 和用户后续要求为准；发现矛盾先记录并修正文档，不能同时实施两套模型。

S4-02b/c增加真实镜像复制及常驻Deployment链，与Execution主链分离，见[镜像/部署协议](contracts/s4-image-deployment.md)。S4-03/04/05本批实现与验收见进度；镜像准备成功不等于Flow运行成功。
