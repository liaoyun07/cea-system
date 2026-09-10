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
| WF-012 | HTTP/SQL 与隔离 Shell/Python Task | S4 | workflow-runtime | IMPLEMENTED | PASS |
| WF-013 | Repeat 状态反馈、轮次隔离和屏障 | S5 | workflow-runtime | IMPLEMENTED | PASS |
| FL-001 | FedAvg/FedProx应用与显式Flow迁移 | S5 | platform-dataflow | IMPLEMENTED | PASS |
| WF-014 | Webhook/Checks/SLA/afterExecution | S6 | workflow-runtime | NOT_STARTED | NOT_RUN |
| WF-015 | Namespace Files、导入导出、搜索过滤 | S6 | platform-dataflow | NOT_STARTED | NOT_RUN |
| WF-017 | 通用动态Loop、item作用域、有序集合输出 | S5 | workflow-runtime | IMPLEMENTED | PASS |
| WF-016 | 统一编辑 Schema、No-code 前端对接 | S6 | platform-dataflow | NOT_STARTED | NOT_RUN |
| RES-001 | 站点/集群资源、数据集版本与本地性 | S4 | platform-resource | IMPLEMENTED | PASS |
| RES-002 | 普通选址、共享资源预约与释放 | S4 | platform-resource | IMPLEMENTED | PASS |
| DEP-001 | 应用目录、镜像契约 | S4 | platform-deployment | IMPLEMENTED | PASS |
| DEP-002 | 镜像复制、分发策略、常驻部署管理 | S4 | platform-deployment | IMPLEMENTED | PASS |
| RUN-001 | Kubernetes 一次性 Job 与产物发布 | S4 | workflow-runtime | IMPLEMENTED | PASS |
| EDGE-001 | 网关/终端接入、事件和状态同步 | S5 | platform-edge | NOT_STARTED | NOT_RUN |
| EDGE-002 | 边缘数据处理策略与结果交付 | S5 | platform-edge | NOT_STARTED | NOT_RUN |
| OFF-001 | 终端卸载资格、DQN/规则决策 | S5 | platform-offloading | NOT_STARTED | NOT_RUN |
| OFF-002 | 终端任务画像、模型版本与反馈 | S5 | platform-offloading | NOT_STARTED | NOT_RUN |
| MET-001 | SDK 样本、完整性与单一处理速率口径 | S5 | platform-dataflow | NOT_STARTED | NOT_RUN |
| SEC-001 | 身份、命名空间权限与内部通信认证 | S1/S4 | platform-foundation | IMPLEMENTED | PASS |
| MIG-001 | 旧功能/模板转换与切换 | S7 | platform-server | NOT_STARTED | NOT_RUN |
| OPS-001 | 最小部署与单机恢复验收 | S4/S7 | platform-server | IN_PROGRESS | PARTIAL |

状态定义见[文档规范](05-documentation-guide.md)。FND-001 的具体范围见[框架规格](features/FND-001-scaffold.md)。WF-001至WF-006及SEC-001本地部分见[S1规格](features/WF-001-006-s1.md)与[验收记录](verification/VER-S1-001-durable-log.md)。WF-007/008见[S2规格](features/WF-007-008-s2.md)与[S2验收记录](verification/VER-S2-001-worker-lifecycle.md)。本次同时回归S1。未开始功能用[模板](features/TEMPLATE.md)补齐行为和验收条件，不为未开始功能批量制造空规格。

SEC-001 分层落地：S1 保证本地接口边界与身份契约；接入站点/远程Worker API前完成真实鉴权；S2共享专用MySQL的本地Worker进程不提供远程Worker HTTP接口，不能把“后面做权限”当成可上线状态。WF-016 的完整前端实现需明确授权与前端工程范围，新后端当前只规划协议与编辑 Schema。

WF-009至WF-011见[S3规格](features/WF-009-011-s3.md)、[协议](contracts/s3-protocol.md)与[验收记录](verification/VER-S3-001-control-scheduling.md)。S3历史75项测试通过；控制任务由Executor解释；该历史阶段叶子仅Log/Sleep。

S4工作包见[S4规格](features/S4-resource-runtime.md)。S4-01/02历史验收保留；本批增加真实节点健康/本地性/平台Job槽预约、Application Job及命名文件、GET/POST与只读SQL、隔离Shell/Python。123项统一验证与实际JAR部署验收通过，见[VER-S4-005](verification/VER-S4-005-external-task-runtime.md)。

RES-001只观测节点健康，不提供Prometheus利用率体系；RES-002预约平台槽，不冒充CPU物理独占。DEP-001仍为纯契约目录，显式Flow绑定在真实执行消费者解析。命名文件由Flow声明，不新增自动alias/映射表。DEP-002常驻Deployment不等于Job。

详细边界见[Job协议](contracts/s4-job-execution.md)、[通用任务](contracts/s4-common-tasks.md)和[部署说明](operations/s4-minimal-deployment.md)。SQL写入、其他HTTP方法、Windows/distroless、No-code仍未实现；不通过隐藏这些限制冒充迁移了Kestra全套插件。S5已开始，当前批次状态见下方；S6/S7未进入。

SEC-001按已接入接口的最小鉴权范围PASS，不表示TLS/IAM已实现。OPS-001的S4空库部署和单机恢复部分PASS；因还包含S7最终上线环境复验，汇总仍IN_PROGRESS/PARTIAL，不将S7提前标完成。
S5的WF-013、WF-017与FL-001已实现，150项Maven verify及7项Python测试通过，见[Loop及动态联邦学习验收](verification/VER-S5-003-loop.md)及[S5工作包](features/S5-research-edge.md)。FL-001仅真实MNIST子集两轮功能验收，不包含其他流任务、物理多云或性能基准。计量口径仍待确认，EDGE/OFF/MET未实现；S5整体仍IN_PROGRESS。
