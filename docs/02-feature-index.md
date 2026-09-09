# 功能与验证索引

本表是功能编号和状态的唯一汇总。NOT_STARTED 表示没有业务实现，NOT_RUN 表示没有该功能的测试结果。SCAFFOLD 仅指目录、POM 和包声明，不能称为业务完成。

| 编号 | 功能 | 计划阶段 | 主责模块 | 实现状态 | 验证状态 |
|---|---|---|---|---|---|
| FND-001 | 工程和文档框架 | S0 | platform-server | SCAFFOLD | PASS |
| WF-001 | Flow/Task 模型、解析和结构校验 | S1 | workflow-runtime | IMPLEMENTED | PASS |
| WF-002 | Inputs/Variables/Outputs 类型与绑定 | S1 | workflow-runtime | IMPLEMENTED | PASS |
| WF-003 | 模板持久化、不可变版本与回滚 | S1 | platform-dataflow | IMPLEMENTED | PASS |
| WF-004 | 手动提交、Execution/TaskRun/Attempt 状态 | S1 | workflow-runtime | IMPLEMENTED | PASS |
| WF-005 | 持久消息、幂等、顺序任务、Log 闭环 | S1 | workflow-runtime | IMPLEMENTED | PASS |
| WF-006 | 执行历史、日志、结果查询 | S1 | platform-dataflow | IMPLEMENTED | PASS |
| WF-007 | Worker 租约、结果归并、接管和恢复 | S2 | workflow-runtime | IMPLEMENTED | PASS |
| WF-008 | Constant Retry、超时、取消、Errors/Finally | S2 | workflow-runtime | IMPLEMENTED | PASS |
| WF-009 | DAG/Topology、If/Else、Parallel | S3 | workflow-runtime | IMPLEMENTED | PASS |
| WF-010 | 并发槽、FIFO、QUEUE/FAIL | S3 | workflow-runtime | IMPLEMENTED | PASS |
| WF-011 | Schedule/Cron、Disabled、触发幂等 | S3 | workflow-runtime | IMPLEMENTED | PASS |
| WF-012 | HTTP/SQL 与隔离 Shell/Python Task | S4 | workflow-runtime | NOT_STARTED | NOT_RUN |
| WF-013 | Repeat 状态反馈、轮次隔离和屏障 | S5 | workflow-runtime | NOT_STARTED | NOT_RUN |
| WF-014 | Webhook/Checks/SLA/afterExecution | S6 | workflow-runtime | NOT_STARTED | NOT_RUN |
| WF-015 | Namespace Files、导入导出、搜索过滤 | S6 | platform-dataflow | NOT_STARTED | NOT_RUN |
| WF-016 | 统一编辑 Schema、No-code 前端对接 | S6 | platform-dataflow | NOT_STARTED | NOT_RUN |
| RES-001 | 站点/集群资源、数据集版本与本地性 | S4 | platform-resource | NOT_STARTED | NOT_RUN |
| RES-002 | 普通选址、共享资源预约与释放 | S4 | platform-resource | NOT_STARTED | NOT_RUN |
| DEP-001 | 应用目录、镜像契约、参数别名派生 | S4 | platform-deployment | NOT_STARTED | NOT_RUN |
| DEP-002 | 镜像复制、分发策略、常驻部署管理 | S4 | platform-deployment | NOT_STARTED | NOT_RUN |
| RUN-001 | Kubernetes 一次性 Job 与产物发布 | S4 | workflow-runtime | NOT_STARTED | NOT_RUN |
| EDGE-001 | 网关/终端接入、事件和状态同步 | S5 | platform-edge | NOT_STARTED | NOT_RUN |
| EDGE-002 | 边缘数据处理策略与结果交付 | S5 | platform-edge | NOT_STARTED | NOT_RUN |
| OFF-001 | 终端卸载资格、DQN/规则决策 | S5 | platform-offloading | NOT_STARTED | NOT_RUN |
| OFF-002 | 终端任务画像、模型版本与反馈 | S5 | platform-offloading | NOT_STARTED | NOT_RUN |
| MET-001 | SDK 样本、完整性与单一处理速率口径 | S5 | platform-dataflow | NOT_STARTED | NOT_RUN |
| SEC-001 | 身份、命名空间权限与内部通信认证 | S1/S4 | platform-foundation | IN_PROGRESS | PARTIAL |
| MIG-001 | 旧功能/模板转换与切换 | S7 | platform-server | NOT_STARTED | NOT_RUN |
| OPS-001 | 最小部署与单机恢复验收 | S4/S7 | platform-server | NOT_STARTED | NOT_RUN |

状态定义见[文档规范](05-documentation-guide.md)。FND-001 的具体范围见[框架规格](features/FND-001-scaffold.md)。WF-001至WF-006及SEC-001本地部分见[S1规格](features/WF-001-006-s1.md)与[验收记录](verification/VER-S1-001-durable-log.md)。WF-007/008见[S2规格](features/WF-007-008-s2.md)与[S2验收记录](verification/VER-S2-001-worker-lifecycle.md)。本次同时回归S1。未开始功能用[模板](features/TEMPLATE.md)补齐行为和验收条件，不为未开始功能批量制造空规格。

SEC-001 分层落地：S1 保证本地接口边界与身份契约；接入站点/远程Worker API前完成真实鉴权；S2共享专用MySQL的本地Worker进程不提供远程Worker HTTP接口，不能把“后面做权限”当成可上线状态。WF-016 的完整前端实现需明确授权与前端工程范围，新后端当前只规划协议与编辑 Schema。

WF-009至WF-011见[S3规格](features/WF-009-011-s3.md)、[协议](contracts/s3-protocol.md)与[验收记录](verification/VER-S3-001-control-scheduling.md)。本轮75项测试通过并回归S1/S2；控制任务由Executor解释，叶子仍仅Log/Sleep。S4–S7未自动进入。

## 明确的范围限制

本期不默认加入完整插件市场、WorkerGroup、多租户、复杂 RBAC、完整 Secret Manager、AI Copilot、完整 SLA/Retry 矩阵。ARM 适配、任务优先级、多核专用算法、边缘离线自治分别待需求确认。

普通任务可以做固定/规则选址，但不因此进入 OFF-001。终端发起一个流程，也不表示其中每个任务都是卸载任务。卸载资格必须显式表示并校验。

2026-09-09范围决定：EDGE-001/EDGE-002不含终端断线自动恢复、离线补发、断点续跑及恢复专用ACK；正常接入/卸载/结果交付保留，WF-007已实现的服务端Worker接管不变。MET-001的计量口径到S5开始再确定。SEC-001/OPS-001按[已确认范围](06-deployment-safeguards-review.md)推进：P01/P07保留现状；P04/P05/P06/P11后续最小实现；P02/P03/P08/P09/P10/P12/P13现在后置。已有保护不删除，P10后置不取消WF-010核心并发/FIFO；选择范围不改变当前实现/验证状态。
