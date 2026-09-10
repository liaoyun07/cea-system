# S6：编辑、管理与P2能力

用户授权：2026-09-10“先开始完成S6”，随后“继续完成S6剩下部分”。DQN研究及S5-05计量后置，不是本阶段依赖；不改旧前端、旧库或部署既有服务。

S6-01已完成，历史验收见[VER-S6-001](../verification/VER-S6-001-flow-editing.md)。02–04于2026-09-11通过212项Maven及12项Python完整回归，见[VER-S6-002](../verification/VER-S6-002-files-lifecycle.md)。S6按本篇最小后端范围DONE；不代表完整前端、S7、计量或长期DQN完成。

## 可验收批次

| 批次 | 范围 | 退出条件 |
|---|---|---|
| S6-01 | WF-016后端编辑Schema/校验/预览；WF-015流程搜索、导入导出 | YAML/JSON共用FlowParser/FlowValidator；预览不创建修订、执行或预约；导入使用原修订CAS且批次原子；导出后再导入可执行；权限/管理范围隔离及完整verify |
| S6-02 | WF-015 Namespace Files | 命名空间文件有真实Task消费者；路径/权限、执行快照和接管语义验证；不以文件CRUD冒充执行支持 |
| S6-03 | WF-014 Webhook/Checks | 复用提交入口；重投不重复创建Execution；检查失败阻止提交；鉴权及所有入口一致 |
| S6-04 | WF-014 SLA/afterExecution | 时限检查和持久后处理有真实消费者；后处理失败不改写主结果；重启/失败/取消回归 |

02–04原退出条件已验证，不通过删除验收项标完成。完整No-code前端须另行确定工程范围；这里交付其后端编辑协议。

## S6-02至04实现与验收映射

具体字段、调用、限制和升级见[协议](../contracts/s6-files-lifecycle.md)，设计参考及消费者见[ADR-0019](../decisions/ADR-0019-s6-files-lifecycle.md)。

- 02：NamespaceFileService的不可变小型文本修订由ApplicationTaskRunner实际消费；仅显式固定本命名空间版本，原Prepared和容器文件传输负责重试/接管。FlowManagementTest覆盖HTTP权限/路径/CAS，ImageDistributionTest覆盖真实脚本产物、修改最新文件后旧执行不漂移、Job同UID/Attempt接管及缺文件失败。
- 03：Flow.checks使用原表达式在统一ExecutionService检查，preview同样检查；Webhook是明确opt-in、Basic/EXECUTE认证、原幂等键隔离的提交入口。FlowManagementTest覆盖拒绝和重投/版本变化/Cron推进；EdgeAccessTest验证终端请求和事件策略失败无执行/回执。
- 04：SLA只做maxDuration持久告警，不改变结果；原Executor终态后继续推进AFTER_EXECUTION TaskRun，复用所有原控制/Worker/Retry。FlowManagementTest覆盖超限/未超限、重建Executor、旧Worker租约拒绝、后处理失败/重试/主失败/取消/准入拒绝、Finally顺序及结果输出结束时间不变。
- 不新增第二套Flow、Binding、Executor、Worker、Runner或SPI；不做glob/跨namespace文件、匿名Webhook、多种SLA动作、完整前端或计量。

## S6-01最小设计

参考[ADR-0018](../decisions/ADR-0018-flow-editing.md)。FlowDefinition是唯一语义模型，源文本是其可编辑表达。Schema反映现有record/枚举/Binding，不承担第二套运行校验；服务端原Validator继续负责类型相关约束、作用域和DAG循环检查。

新增runtime/definition/FlowSchema.java，由FlowService.schema实际读取并通过HTTP提供编辑字段；不新增通用插件注册器。既有FlowParser增加规范化导出，FlowService/Repository/Controller增加无副作用解析、输入预览、原子导入和搜索。预览只解析输入默认值与变量，不执行Task、不虚构outputs、不保证外部资源可运行。

导入只接收同一namespace的1..20份源文本和各自expectedRevision，总源文本不超过1Mi字符。使用原save/并发CAS/事务；重复请求冲突，不额外新增幂等表。任何一份失败整批回滚，包括Schedule配置。先按flowId排序锁定，避免两个批次反序获取head锁。USER与EDGE_POLICY边界不变。

搜索仅针对USER最新修订，支持id/description子串、精确label键值和既有分页；不引入全文搜索引擎。导出指定不可变修订或最新修订的原文/YAML/JSON，不包含账号、执行记录或数据库内部字段。格式转换不保留注释，原文导出保留。

验收需覆盖：源格式往返、重复字段/未知字段拒绝、非法绑定/依赖与保存一致；预览默认值/必填/未知输入；只读与越权；导入冲突/非法/跨namespace/策略范围回滚及并发；literal包含SQL通配字符的搜索；导出源再次运行原Executor/Worker链。无新表、迁移、状态、Binding或Runner。
