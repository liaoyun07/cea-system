# S6-01：Flow编辑与管理协议

本篇范围：新backend的后端编辑/流程管理；后续Namespace Files、Webhook/Checks/SLA/afterExecution见[增量协议](s6-files-lifecycle.md)，完整前端未实现。YAML/JSON仍为同一个FlowDefinition，schemaVersion仍为1；无新Binding或alias。

## HTTP

以下路径均以 `/api/namespaces/{namespace}/flows` 为前缀，使用原Basic认证和命名空间权限。

| 方法/路径 | 请求与返回 | 权限/行为 |
|---|---|---|
| GET /editor/schema | 返回JSON Schema 2020-12结构文档 | READ；从真实record/枚举/Binding生成；递归Task用引用，无新运行模型 |
| POST /{flowId}/validate | `{source}` → FlowDefinition | WRITE；单份YAML或JSON源，路由namespace/id必须一致；不要求尚未填写的运行输入，但Flow自身结构/默认值/引用须有效 |
| POST /{flowId}/preview | `{source,inputs}` → `{definition,inputs,variables}` | WRITE；在校验基础上应用默认值、检查必填和未知输入、解析变量；不运行叶子、不展开动态实例、不虚构上游输出 |
| GET /{flowId}/export | revision可选；format=source/yaml/json，默认source | READ；USER范围；source原文，另两种为规范化定义；返回text/plain、application/yaml或application/json |
| POST /import | `{flows:[{expectedRevision,source},...]}` → FlowRevision数组 | WRITE；1..20份、同namespace、id唯一、总源≤1048576字符；结果按id排序；整批事务，原CAS保护 |
| GET 根路径 | 原limit/offset，新增q、labelKey/labelValue | READ；USER最新修订；q是id/description字面子串（≤200），不将%/_作为通配符；标签成对精确匹配（键1..100，值≤200） |

启用Schedule的validate/preview/import/save同样要求EXECUTE，预览本身不会配置Schedule。USER搜索/导出/导入不可绕过EDGE_POLICY管理范围。导入namespace来自源并必须匹配路由，不会自动改写用户Flow。

单份源长度1..262144字符；未知字段、重复键、尾随第二份JSON/YAML文档拒绝。原有所有结构/引用/嵌套约束继续由FlowValidator执行。Schema只表达结构与字段类型，不能代替服务端跨字段/引用/资源校验，也不保证schema通过就能执行。保存接口仍为POST /{flowId}/revisions，不增加第二份No-code保存数据。

422为定义/输入/批次约束错误，409为修订或管理范围冲突，404为缺少目标修订，401/403为认证/权限失败。无有效JSON请求体或类型错误使用既有400。重复导入旧expectedRevision返回409，不产生第二个修订；成功修订号由原FlowRevision返回，无新增幂等表。

## 数据与执行边界

只新增API请求/响应record：SourceRequest、PreviewRequest、ImportRequest、FlowService.ImportEntry、FlowService.Preview。每个字段分别由解析、BindingResolver、CAS保存、响应展示消费。没有新的数据库表/列/迁移、持久状态、缓存或SPI。

预览不查询外部集群/镜像/数据文件，不保证Application可执行性或调度结果；真实执行仍由ApplicationTaskRunner校验目录、位置、权限和资源。Flow中未来outputs保留引用形式，尤其Loop/Repeat，不提前伪造值。YAML与JSON规范化导出不保留注释/键顺序；需要原格式就导出source。不是旧系统库备份或模板自动迁移。

可运行HTTP示例见[编辑示例](../../examples/s6-flow-editing.http)。实现与Kestra取舍见[ADR-0018](../decisions/ADR-0018-flow-editing.md)。
