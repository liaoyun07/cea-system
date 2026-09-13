# 功能与验证索引

申报书逐项覆盖及待补进度见[审查表](07-proposal-audit.md)（DOC-02，2026-09-14）。本索引继续汇总实现/验证状态；审查表只判断这些已实现范围与原文要求的差距，不新增领域功能编号，也不把MET-001或完整DQN标为完成。

EP-02（S5-03增量，DONE/PASS，已发布）：边缘处理记录、策略/状态服务端筛选分页、原执行详情与结果；240项Maven、50项Node、最终57项浏览器及实际CEA三记录/三结果JSON验收通过。没有第二套状态/表；原数据及其余15服务保持。见[规格](features/EP-02-processing-records.md)、[API](contracts/ep02-processing-records.md)、[实际验收](verification/VER-EP-002-processing-records.md)。

EP-01（S5-03/FILE-01增量，DONE/PASS，已发布）：实际HTTP网关、终端容器上传、三个策略与三种结果去向；237项Maven、19项新Python测试、4命令断网试跑和现场3执行/数值/归属/存储核验PASS。不新增功能域/Java/DB/DSL；[规格](features/EP-01-terminal-edge-examples.md)，[协议](contracts/ep01-gateway.md)，[验收](verification/VER-EP-001-terminal-edge.md)。

FILE-01（RUN-001/RES-001 增量，DONE/PASS，已发布CEA）：K8s Pod公共文件助手和按执行位置存储，不新增功能域/DSL/SQL/API；终端Docker保留既有文件路径。完整237项、最终8项K3s/1项JAR回归、8项助手测试通过；获批新增三边缘存储/Secret权限后，现场两算法各两轮/11个Job、四存储实物和独立数值复核PASS，历史保持。规格见 [FILE-01](features/FILE-01-pod-artifacts.md)，[验证](verification/VER-FILE-001-pod-artifacts.md)。

UI-05a（DONE/PASS，已发布CEA前端）：WF-006任务实例表按startedAt展示，不改原始数据/后端顺序/执行链；同时间保留原顺序，未开始置后。范围见[规格](features/UI-05-execution-inspection.md)，50项单测/55项浏览器及实际18080验收见[验证](verification/VER-UI-005a-task-start-order.md)。

UI-06a（DONE/PASS，已发布CEA前端）：WF-006既有Metrics页面增加柱状/折线显示切换，共用原值和实例坐标，不新增采集/计量或工作流能力。范围见[Metrics规格](features/UI-06-execution-metrics.md)，47项单测/54项浏览器及实际18080发布见[验证](verification/VER-UI-006a-chart-switch.md)。

UI-10（DONE/PASS，已发布CEA）：WF-003/WF-006、RES-001、SEC-001、DEP-001/002增加Flow/终态Execution/未引用Dataset逻辑删除、ADMIN/USER账号/个人中心和独立BuildKit在线构建。无新功能域、执行链或吞吐/DQN能力。边界见[工作包](features/UI-10-cleanup-users-build.md)和[协议](contracts/ui10-cleanup-users-build.md)，实际测试/部署见[验证](verification/VER-UI-010-cleanup-users-build.md)。

UI-09（DEP-001/DEP-002/RES-001管理补齐，DONE/PASS，已发布CEA）：Registry实际库存/详情/引用保护删除、应用目录删除、Service创建/删除/访问详情及多Namespace管理；不新造功能域ID。包含源tag与digest契约的无标签副本核验，不以历史记录代替库存。验证/发布结果见[验证记录](verification/VER-UI-009-registry-kubernetes.md)。

UI-08a：用户裁剪独立“容器用量”页面，当前前端只保留节点用量，不新增其他入口或平台能力。后端API和采集器不变；验证/发布状态见[进度](04-progress.md)。

UI-08-demo：DEP-001/002现成能力的常驻HTTP示例镜像、上传契约与部署参数已提供；8项HTTP及容器/归档检查PASS，没有新增平台能力或功能编号，未自动登记/部署到CEA。见[示例](../examples/deployment-demo/README.md)与[验证](verification/VER-UI-008-demo-image.md)。

UI-08已实现并于2026-09-13发布CEA：DEP-001/002、RES-001增加按需镜像分发历史、单镜像归档上传、常驻部署配置回读/CAS/手动扩缩容与就绪计时、Metrics API近期CPU/内存。4个新生产Java类，7个HTTP操作，V18/V19两张记录表；执行链和RES-002选址不变。实现阶段227项Maven、45项Node、47项浏览器通过；上线健康、迁移、四集群采样/权限和实际18080只读复核通过，既有数据与其余10服务保留。不是30秒或系统开销的正式性能验收。详见[规格](features/UI-08-core-deployment-operations.md)、[协议](contracts/ui08-deployment-operations.md)与[验证](verification/VER-UI-008-core-deployment-operations.md)。

UI-07已完成并发布CEA：WF-006/RES-001的只读展示增量——任务声明产物及JSON预览、执行全窗口SQL总览、Kubernetes资源查询。220项Maven、41项Node、44项浏览器测试通过；2026-09-12 19:51实际18080复核通过。无新功能编号/表/计量口径/执行链，原流程/历史不变。范围见[规格](features/UI-07-readonly-inspection.md)，实际测试与发布见[验证](verification/VER-UI-007-readonly-inspection.md)。

UI-06已完成并发布：基于已有JSON产物展示实例指标，新增受READ授权的有界读取；216项Maven、40项Node、42项浏览器及构建/格式/scaffold通过。2026-09-12 17:15仅更新CEA前后端，实际两算法历史指标图/表与API一致、桌面/390px复核PASS；两Flow/历史及4条执行不变，其余10服务未重启。无新计量领域功能，MET-001仍后置。[规格](features/UI-06-execution-metrics.md)，[验证](verification/VER-UI-006-execution-metrics.md)。

UI-05已完成并发布：WF-016既有执行数据的前端消费者，固定修订拓扑、TaskRun输出/时间/尝试及两个联邦Flow显式SELECT。36项Node、40项浏览器、215项Maven与构建/格式/scaffold通过；CEA前端及FedAvg r5/FedProx r3只读实测PASS，历史和其余11服务未变。不新增后端领域功能或计量口径。[规格](features/UI-05-execution-inspection.md)，[验证](verification/VER-UI-005-execution-inspection.md)。

UI-02d已完成并发布：WF-016既有Loop集合每项JSON编辑，保留数组增删排序与原Binding；不新增领域能力。31项Node、37项浏览器、215项Maven及构建/格式/scaffold通过；只更新CEA前端，实际页面复核PASS，两Flow及四条历史执行未变，其余11个服务未重启。[功能规格](features/UI-02d-loop-json-items.md)，[验证记录](verification/VER-UI-002d-loop-json-items.md)。

UI-02c已完成并发布：WF-016既有No-code的必填字段前置、任务配置展平和来源下拉展示。31项Node、37项浏览器、215项Maven及构建/格式/scaffold通过；只更新CEA前端，实际页面复核PASS，两Flow及四条历史执行未变，其余11个服务未重启。不新增领域能力、Java、表、API或执行链。[功能规格](features/UI-02c-task-form-layout.md)，[验证记录](verification/VER-UI-002c-task-form-layout.md)。

UI-04已完成并发布：WF-002/WF-016增加固定字符串SELECT、values、默认值/必填和端到端成员校验；30项Node、36项浏览器、215项Maven及构建/格式/scaffold通过。已按用户确认同步更新CEA前后端并只读复核，不改两Flow及四条历史执行，其他十个容器未重启。不新增功能编号、API、表或执行链。[语义与边界](features/UI-04-select-input.md)，[验证记录](verification/VER-UI-004-select-input.md)。

UI-02b已完成并发布：Loop.values的Array/引用及逐项集合编辑，FedAvg/FedProx移除clients启动输入，实际CEA修订为r4/r2。29项Node、34项浏览器、212项Maven及构建/格式/scaffold通过，实际页面和历史保留复核PASS，其余11个服务未重启。无新领域功能编号或后端执行能力，见[记录](verification/VER-UI-002b-loop-values.md)。

UI-02a修复候选集群选中反馈：高亮/勾选、点击取消、YAML同源回显和固定列表/LITERAL切换保留。29项Node、30项浏览器、212项Maven及构建/格式/结构检查通过，已按确认更新18080并只读复核，其他11个服务未重启；见[验证记录](verification/VER-UI-002a-cluster-selection.md)。无新后端模型或执行链。

UI-03a已删除常驻教学/架构说明，不新增展开帮助或tooltip；保留字段、真实数据、错误/确认/结果。29项Node、29项浏览器、212项Maven及构建/格式/结构检查通过。用户确认后已更新18080前端并只读复核，其余11个服务未重启；见[验证记录](verification/VER-UI-003a-copy-cleanup.md)。不新增领域功能编号或后端能力。

UI-03是RES-001、DEP-001/002、EDGE-001/002及OFF-002的前端消费者，沿用现有编号/API；只读卸载页不扩展模型研究。已有管理功能与真实分发/部署/策略事件验收通过，29项Node、28项浏览器及212项Maven/12项Python PASS。已更新CEA前端，详细已迁移/缺接口列表及失败经过见[UI-03规格](features/UI-03-management.md)和[验收](verification/VER-UI-003-management.md)。MIG-001旧数据/模板转换与切换仍未实施。

UI-02是WF-016/WF-002/WF-003的前端消费者，不增加功能编号或后端模型；任务块、单表单、原Binding/目录、同源YAML和修订比较回退已实现，测试与部署状态见[UI-02验收](verification/VER-UI-002-no-code.md)。[功能边界](features/UI-02-no-code.md)不含完整Kestra、资源注册管理、Pod日志、指标或旧数据迁移。下方UI-01/S6描述保留对应历史批次边界。

DEPLOY-01是OPS-001/FL-001的独立部署工作包，当前DONE/PASS，不是新增领域能力。[范围](features/DEPLOY-01-independent.md)与[实测记录](verification/VER-DEPLOY-001-cea.md)覆盖D盘Compose、显式配置、四集群联邦算法、浏览器和重启复核；FL-001本批已扩至真实MNIST训练60000/测试10000。算法Pod stdout未汇入Execution日志；不包含MIG-001旧数据转换/切换，OPS汇总仍保留最终上线未验收的边界。

UI-01新增独立前端最小闭环，归WF-016编辑协议的当前消费者；[工作包](features/UI-01-console.md)、[验证记录](verification/VER-UI-001-console.md)。只覆盖源编辑与基本执行管理，不把完整No-code或全部旧管理页面标为完成。

当前增量：S6-02至04的Namespace Files、Webhook/Checks/SLA/afterExecution已实现，212项Maven/12项Python完整verify通过，见[验收](verification/VER-S6-002-files-lifecycle.md)。WF-016完成的是后端编辑协议，不是完整前端。用户同意S5计量和DQN研究后置，MET-001仍未实现。

本表是功能编号和状态的唯一汇总。NOT_STARTED 表示没有业务实现，NOT_RUN 表示没有该功能的测试结果。SCAFFOLD 仅指目录、POM 和包声明，不能称为业务完成。

| 编号 | 功能 | 计划阶段 | 主责模块 | 实现状态 | 验证状态 |
|---|---|---|---|---|---|
| FND-001 | 工程和文档框架 | S0 | platform-server | SCAFFOLD | PASS |
| WF-001 | Flow/Task 模型、解析和结构校验 | S1 | workflow-runtime | IMPLEMENTED | PASS |
| WF-002 | Inputs/Variables/Outputs 类型与绑定 | S1 | workflow-runtime | IMPLEMENTED | PASS |
| WF-003 | 模板持久化、不可变版本、回滚与受保护逻辑删除 | S1/UI-10 | platform-dataflow | IMPLEMENTED | PASS |
| WF-004 | 手动提交、Execution/TaskRun/Attempt 状态 | S1 | workflow-runtime | IMPLEMENTED | PASS |
| WF-005 | 持久消息、幂等、顺序任务、Log 闭环 | S1 | workflow-runtime | IMPLEMENTED | PASS |
| WF-006 | 执行历史、日志、结果查询与终态历史逻辑删除 | S1/UI-10 | platform-dataflow | IMPLEMENTED | PASS |
| WF-007 | Worker 租约、结果归并、接管和恢复 | S2 | workflow-runtime | IMPLEMENTED | PASS |
| WF-008 | Constant Retry、超时、取消、Errors/Finally | S2 | workflow-runtime | IMPLEMENTED | PASS |
| WF-009 | DAG/Topology、If/Else、Parallel | S3 | workflow-runtime | IMPLEMENTED | PASS |
| WF-010 | 并发槽、FIFO、QUEUE/FAIL | S3 | workflow-runtime | IMPLEMENTED | PASS |
| WF-011 | Schedule/Cron、Disabled、触发幂等 | S3 | workflow-runtime | IMPLEMENTED | PASS |
| WF-012 | HTTP/SQL 与隔离 Shell/Python Task | S4 | workflow-runtime | IMPLEMENTED | PASS |
| WF-013 | Repeat 状态反馈、轮次隔离和屏障 | S5 | workflow-runtime | IMPLEMENTED | PASS |
| FL-001 | FedAvg/FedProx应用与显式Flow迁移 | S5 | platform-dataflow | IMPLEMENTED | PASS |
| WF-014 | Webhook/Checks/SLA/afterExecution | S6 | workflow-runtime | IMPLEMENTED | PASS |
| WF-015 | Namespace Files、导入导出、搜索过滤 | S6 | platform-dataflow | IMPLEMENTED | PASS |
| WF-017 | 通用动态Loop、item作用域、有序集合输出 | S5 | workflow-runtime | IMPLEMENTED | PASS |
| WF-016 | 统一编辑 Schema、No-code 前端对接 | S6/UI-01/02/03 | platform-dataflow/frontend | IMPLEMENTED（当前DSL的同源No-code/源码；含策略入口） | PASS（当前范围） |
| RES-001 | 站点/集群资源、数据集版本与本地性 | S4 | platform-resource | IMPLEMENTED | PASS |
| RES-002 | 普通选址、共享资源预约与释放 | S4 | platform-resource | IMPLEMENTED | PASS |
| DEP-001 | 应用目录、镜像契约 | S4 | platform-deployment | IMPLEMENTED | PASS |
| DEP-002 | 镜像上传/在线构建/复制、分发历史、常驻部署管理 | S4/UI-08/09/10 | platform-deployment | IMPLEMENTED | PASS |
| RUN-001 | Kubernetes Job、终端Docker与产物发布 | S4/S5 | workflow-runtime | IMPLEMENTED | PASS |
| EDGE-001 | 网关/终端接入、事件和状态同步 | S5 | platform-edge | IMPLEMENTED | PASS |
| EDGE-002 | 边缘数据处理策略与结果交付 | S5 | platform-edge | IMPLEMENTED | PASS |
| OFF-001 | 终端卸载资格、规则/单步Q决策 | S5 | platform-offloading | IMPLEMENTED | PASS |
| OFF-002 | 显式卸载任务画像、模型版本与反馈 | S5 | platform-offloading | IMPLEMENTED | PASS |
| MET-001 | SDK 样本、完整性与单一处理速率口径 | S5 | platform-dataflow | NOT_STARTED | NOT_RUN |
| SEC-001 | 身份、命名空间权限、两角色人员/个人中心与内部通信认证 | S1/S4/UI-10 | platform-foundation/platform-server | IMPLEMENTED | PASS |
| MIG-001 | 旧功能/模板转换与切换 | S7 | platform-server | NOT_STARTED | NOT_RUN |
| OPS-001 | 最小部署与单机恢复验收 | S4/S7 | platform-server | IN_PROGRESS | PARTIAL |

状态定义见[文档规范](05-documentation-guide.md)。FND-001 的具体范围见[框架规格](features/FND-001-scaffold.md)。WF-001至WF-006及SEC-001本地部分见[S1规格](features/WF-001-006-s1.md)与[验收记录](verification/VER-S1-001-durable-log.md)。WF-007/008见[S2规格](features/WF-007-008-s2.md)与[S2验收记录](verification/VER-S2-001-worker-lifecycle.md)。本次同时回归S1。未开始功能用[模板](features/TEMPLATE.md)补齐行为和验收条件，不为未开始功能批量制造空规格。

SEC-001 分层落地：S1 保证本地接口边界与身份契约；接入站点/远程Worker API前完成真实鉴权；S2共享专用MySQL的本地Worker进程不提供远程Worker HTTP接口，不能把“后面做权限”当成可上线状态。WF-016 的完整前端实现需明确授权与前端工程范围，新后端已实现后端编辑协议与 Schema。

WF-009至WF-011见[S3规格](features/WF-009-011-s3.md)、[协议](contracts/s3-protocol.md)与[验收记录](verification/VER-S3-001-control-scheduling.md)。S3历史75项测试通过；控制任务由Executor解释；该历史阶段叶子仅Log/Sleep。

S4工作包见[S4规格](features/S4-resource-runtime.md)。S4-01/02历史验收保留；本批增加真实节点健康/本地性/平台Job槽预约、Application Job及命名文件、GET/POST与只读SQL、隔离Shell/Python。123项统一验证与实际JAR部署验收通过，见[VER-S4-005](verification/VER-S4-005-external-task-runtime.md)。

RES-001包含节点健康与UI-08近期Metrics API用量查询，不提供Prometheus历史监控体系；RES-002预约平台槽，不使用这些采样决定Placement、不冒充CPU物理独占。DEP-001仍为纯契约目录，镜像上传经DEP-002受控导入后调用原目录登记；显式Flow绑定在真实执行消费者解析。命名文件由Flow声明，不新增自动alias/映射表。DEP-002常驻Deployment不等于Job。

详细边界见[Job协议](contracts/s4-job-execution.md)、[通用任务](contracts/s4-common-tasks.md)和[部署说明](operations/s4-minimal-deployment.md)。SQL写入、其他HTTP方法、Windows/distroless、完整No-code前端仍未实现；不通过隐藏这些限制冒充迁移了Kestra全套插件。S6后端范围已完成并通过完整回归；S7未进入。

SEC-001按已接入接口及ADMIN/USER人员管理的最小范围PASS，不表示TLS、SSO或复杂IAM已实现。OPS-001的S4空库部署和单机恢复部分PASS；因还包含S7最终上线环境复验，汇总仍IN_PROGRESS/PARTIAL，不将S7提前标完成。
S5的WF-013、WF-017与FL-001已实现，150项Maven verify及7项Python测试通过，见[Loop及动态联邦学习验收](verification/VER-S5-003-loop.md)及[S5工作包](features/S5-research-edge.md)。FL-001仅真实MNIST子集两轮功能验收，不包含其他流任务、物理多云或性能基准。计量口径仍待确认，MET未实现；S5整体仍IN_PROGRESS。EDGE-001/002已按后端接入/策略协议范围完成，166项全量回归及107项收尾复测通过，见[接入验收](verification/VER-S5-004-edge-access.md)；不表示已部署物理网关代理。

S5-04a完成RUN-001终端Docker与可信来源基础；S5-04b增加OFF-001/002的显式卸载、规则/单步Q、画像/反馈及终端FIFO。新增3表、3个HTTP操作，原执行链不变。188项Maven与12项Python全量验证通过，见[本批验收](verification/VER-S5-006-terminal-offloading.md)。状态仅代表当前最小范围，单步模型不等于多步长期DQN优化，未做策略性能对比。

S6-02至04及完整verify已完成；字段消费者、最小范围及验证见[协议](contracts/s6-files-lifecycle.md)与[VER-S6-002](verification/VER-S6-002-files-lifecycle.md)。不做完整前端、计量或长期DQN。
