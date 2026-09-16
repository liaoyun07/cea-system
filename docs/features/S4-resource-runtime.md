# S4资源与运行环境工作包

FLPAR-16（已部署）：镜像准备按目标仓库HEAD确认的digest复用，404才调用Skopeo复制；固定digest命中不启动Skopeo，可变tag仍实时解析。认证/网络异常不降级；实际复制和失败继续记录，复用不新增分发历史。复用RegistryHttpClient与既有配置/表，节点IfNotPresent及执行链不变。51项真实Registry/集群测试及四个CEA仓库复用验证通过，删除后重分发已在隔离集成环境验证。[验收](../verification/VER-FLPAR-16-aggregate-reuse.md)。

状态DONE，按下述最小实现范围验收，见[VER-S4-005](../verification/VER-S4-005-external-task-runtime.md)。S3基线为Git 071ff4b8fc61dbae5093e5369adcaa8634c3e474，用户授权开始S4；2026-09-10另授权将S4-01提交并更新GitHub，未授权S5。

| 工作包 | 当前范围 | 验收条件 |
|---|---|---|
| S4-01 | 集群目录、数据集版本/位置与只读候选本地性检查 | 真实MySQL持久化、版本不可覆盖、同内容注册幂等、位置原子性、跨namespace权限、候选逐项拒绝原因、S1–S3回归 |
| S4-02 | 应用/镜像契约与镜像准备/分发、常驻部署 | 契约与已注册数据集一致；Flow输入和任务来源由作者显式定义，应用目录不派生；分发与Job职责分开；真实准备/部署结果 |
| S4-03 | 资源观测/普通选址与原子预约、K8s一次性Job及产物 | 独立测试集群真实运行；位置与Attempt持久；Worker接管同Job，取消/超时及发布/释放闭环；不可迁移数据约束有效 |
| S4-04 | HTTP/SQL与隔离Shell/Python任务 | 通过同一Worker/Attempt链；脚本不在宿主任意执行；失败/超时/结果真实；外部副作用的未知结果不盲目重放 |
| S4-05 | P04/P05/P06/P11最小保障与全量验收 | 实际远程接口认证/凭据外置、独立部署启动、进程和DB短时故障恢复、全部协议/文档/测试一致 |

这些是S4内部实现顺序，不减少阶段退出条件。每个批次验证后明确剩余部分，不能用资源列表或mock Kubernetes替代真实环境验收。

## S4-03/04/05本批实现与验收入口

- S4-03：[ADR-0009](../decisions/ADR-0009-s4-job-execution.md)、[Job协议](../contracts/s4-job-execution.md)。原子预约是平台Job槽；健康观测采用Ready节点，本地性强制校验。固定Attempt Job及真实产物由ImageDistributionTest验证。
- S4-04：[ADR-0010](../decisions/ADR-0010-s4-common-tasks.md)、[通用任务协议](../contracts/s4-common-tasks.md)。GET/POST、只读MySQL SELECT，POST结果未知不自动重发；Shell/Python在同一Application Pod链执行。不支持的写SQL/HTTP方法/镜像类型明确列出，不暗示Kestra全部插件已迁移。
- S4-05：[最小部署](../operations/s4-minimal-deployment.md)。独立JVM强杀、真实DB短时故障恢复，以及package后的实际JAR空库启动；不修改旧系统，不宣称跨地域容灾。

S4-01至S4-05已验收；工作包状态统一见进度。最终123项verify通过，不代表SQL写入/全插件集或生产高可用已实现。

本批S4-01设计见[ADR-0006](../decisions/ADR-0006-s4-resource-boundary.md)。资源注册是声明式目录，不等于观测已上线；候选检查不等于最终选址。没有真实任务消费者前不创建预约表或Runner空接口。

S4-01具体语义、错误及字段消费者见[资源协议](../contracts/s4-resource-catalog.md)，11项新增资源测试与75项回归结果见[验证记录](../verification/VER-S4-001-resource-catalog.md)。只验收目录和声明约束；不证明真实数据或集群可用。阶段与工作包状态统一见[进度](../04-progress.md)。

## S4-02实现次序

2026-09-10用户授权开始S4-02，基线为已发布78203a7。按可验证消费者拆开实现，不删减原来的真实准备/部署验收：

| 子批次 | 当前功能范围 | 必须验证 |
|---|---|---|
| S4-02a | 应用契约版本目录、标量参数和数据集规则 | 同版本不能覆盖、并发登记、类型/默认值/choices、数据集版本/格式/权限；目录不改Flow定义或创建Execution；原执行链回归 |
| S4-02b | 镜像准备/复制与分发策略 | 真实Registry传输及准备结果；认证/凭据外置；与Job职责分离 |
| S4-02c | 常驻Deployment生命周期 | 独立测试集群真实创建/查询/更新/停止及失败呈现，不能用目录状态替代实际部署 |

历史首批实现S4-02a。最新授权完成剩余S4；b/c新增真实Registry复制与Deployment生命周期，见[镜像/部署协议](../contracts/s4-image-deployment.md)。[ADR-0007](../decisions/ADR-0007-application-contract-binding.md)记录职责来源与简化，[协议](../contracts/s4-application-catalog.md)定义真实能力及尚未实现的部分。状态只在进度/功能索引维护，阶段不因契约登记成功而DONE。


2026-09-10方向修正：撤销S4-02a原来的别名派生、独立计划/解析API与示例；原101项验证仅作历史。当前修正验收见[VER-S4-003](../verification/VER-S4-003-explicit-flow-boundary.md)。显式参数映射等真实Application/Container Task可执行时再实现；该历史方向修正批次未进入b/c、S4-03。现按最新授权实施剩余S4，仍不增加无消费者映射模型/表或Runner/SPI。YAML与No-code目标是同一Flow事实源，No-code当前未实现。
