# S6：编辑、管理与P2能力

用户授权：2026-09-10“先开始完成S6”。DQN研究及S5-05计量后置，不是本阶段依赖；不改旧前端、旧库或部署既有服务。

S6-01已完成，199项Maven及12项Python完整verify、14项中文/契约收尾复测通过，见[验收记录](../verification/VER-S6-001-flow-editing.md)。02–04仍待实现；S6整体IN_PROGRESS。

## 可验收批次

| 批次 | 范围 | 退出条件 |
|---|---|---|
| S6-01 | WF-016后端编辑Schema/校验/预览；WF-015流程搜索、导入导出 | YAML/JSON共用FlowParser/FlowValidator；预览不创建修订、执行或预约；导入使用原修订CAS且批次原子；导出后再导入可执行；权限/管理范围隔离及完整verify |
| S6-02 | WF-015 Namespace Files | 命名空间文件有真实Task消费者；路径/权限、执行快照和接管语义验证；不以文件CRUD冒充执行支持 |
| S6-03 | WF-014 Webhook/Checks | 复用提交入口；重投不重复创建Execution；检查失败阻止提交；鉴权及所有入口一致 |
| S6-04 | WF-014 SLA/afterExecution | 时限检查和持久后处理有真实消费者；后处理失败不改写主结果；重启/失败/取消回归 |

S6-01先实现，其余保持待实现，不通过删除原退出条件将整个S6标为完成。完整No-code前端须另行确定工程范围；这里交付其后端编辑协议。

## S6-01最小设计

参考[ADR-0018](../decisions/ADR-0018-flow-editing.md)。FlowDefinition是唯一语义模型，源文本是其可编辑表达。Schema反映现有record/枚举/Binding，不承担第二套运行校验；服务端原Validator继续负责类型相关约束、作用域和DAG循环检查。

新增runtime/definition/FlowSchema.java，由FlowService.schema实际读取并通过HTTP提供编辑字段；不新增通用插件注册器。既有FlowParser增加规范化导出，FlowService/Repository/Controller增加无副作用解析、输入预览、原子导入和搜索。预览只解析输入默认值与变量，不执行Task、不虚构outputs、不保证外部资源可运行。

导入只接收同一namespace的1..20份源文本和各自expectedRevision，总源文本不超过1Mi字符。使用原save/并发CAS/事务；重复请求冲突，不额外新增幂等表。任何一份失败整批回滚，包括Schedule配置。先按flowId排序锁定，避免两个批次反序获取head锁。USER与EDGE_POLICY边界不变。

搜索仅针对USER最新修订，支持id/description子串、精确label键值和既有分页；不引入全文搜索引擎。导出指定不可变修订或最新修订的原文/YAML/JSON，不包含账号、执行记录或数据库内部字段。格式转换不保留注释，原文导出保留。

验收需覆盖：源格式往返、重复字段/未知字段拒绝、非法绑定/依赖与保存一致；预览默认值/必填/未知输入；只读与越权；导入冲突/非法/跨namespace/策略范围回滚及并发；literal包含SQL通配字符的搜索；导出源再次运行原Executor/Worker链。无新表、迁移、状态、Binding或Runner。
