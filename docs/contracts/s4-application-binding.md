# S4-02a 应用契约与参数绑定协议

这是编排校验/解析API，不是镜像执行API；不保存Flow或创建Execution。真实分发和常驻部署仍在S4-02后续子批次。字段以[OpenAPI](openapi.json)为准。

## 目录与版本

所有接口前缀/api/namespaces/{namespace}，Basic身份沿用已有配置。

| 方法/路径 | 权限 | 行为 |
|---|---|---|
| PUT /applications/{applicationId}/versions/{version} | WRITE；引用数据集时另需READ | 注册完整契约，id/version与路径一致；首次/同内容200，不同内容409 |
| GET /applications/{applicationId}/versions/{version} | READ | 指定版本；不存在404，不推断latest |
| GET /applications | READ | 按applicationId/version字典序分页，limit默认20、范围1..100；offset默认0、范围0..1000000 |
| POST /application-bindings/plan | READ | 派生运行输入、允许值和各任务绑定，不写库 |
| POST /application-bindings/resolve | READ | 验证给定输入并返回各任务参数，不启动镜像 |

未知JSON字段400，无身份401，越权403，未找到版本404，不可覆盖冲突409，非法契约/绑定422。基础设施故障500，不返回伪成功。

ApplicationVersion仅含applicationId/version/image/parameters。新V7的dep_application_version保存namespace/id/version/contract_json，主键(namespace,application_id,version)。一次注册只有一行原子插入；并发同内容可重放，不同内容只有一个版本胜出。没有额外checksum、状态或版本头表。JSON对象键排序，标量数字统一，位置/参数内容不引用旧DTO；choices顺序属于描述内容，修改需新版本。

image要求显式repository:tag或repository@sha256:digest；支持普通小写仓库路径及registry:port。当前只验证引用形式，不访问Registry，不保证tag不移动或镜像存在；digest是可选OCI引用的一部分，不计算额外hash。不得把密码、token或真实凭据放入契约，契约可被本namespace有READ权限的账号读取。

## 参数声明

见[示例契约](../../examples/s4-application-contract.json)。最多100个业务参数，名称为字母/下划线开头、后续字母数字下划线，最多100字符。

Parameter包含type、required、defaultValue、choices和可选dataset：

- type支持STRING/INTEGER/NUMBER/BOOLEAN；required默认false。INTEGER限有符号64位整数，NUMBER必须有限；STRING最多8192字符。不自动把字符串数字转成数字。
- defaultValue可不填；有值必须通过类型和允许值校验。required无default不妨碍登记，但编排时必须有别名或固定值。
- choices可为空表示不限制，否则最多100个不重复非null标量；数字按规范值去重。
- dataset只能用于STRING，且不能另填choices。DatasetRule指定format及1..100个不同DatasetRef(datasetId/version)。全部引用必须已在同namespace资源目录注册且格式一致，否则拒绝登记，不残留部分应用记录。
- 数据集参数的值是datasetId/version（例如mnist/v1），不是路径，也不是自由填写的未注册名称。计划API的choices为下拉框提供允许值。不按DATASET这个参数名猜测用途。

当前不包含命名产物端口、LocalData路径注入、系统环境变量、Secret或任务资源需求；这些随真实Runner消费接入，不能说现有契约已覆盖完整镜像运行协议。

## 别名派生

见[编排请求示例](../../examples/s4-application-bindings.json)。tasks为1..100个TaskSelection：taskId、applicationId、version、aliases、fixedValues。

aliases是“镜像参数名→运行参数别名”。例如两个任务都写EPOCHS→epochs，得到一个运行输入epochs，类型由契约派生。同一任务的多个参数也可以共用别名。别名遵循既有Flow输入标识规则，无空白别名。

每个镜像参数只能有一个来源：

1. 有别名：生成现有InputRef；不允许同时指定固定值。
2. 没有别名而指定fixedValues：校验后生成现有Literal。
3. 两者都没有：使用契约默认值生成Literal；必需但无值时422，可选且无值时最终不传该参数。

只有aliases派生Flow Input，所以CHUNK、MODEL_PATH等名字不会因为出现在契约中就自动暴露；是否暴露由编排者明确命名决定，不对具体算法硬编码。未知参数/任务重复/类型错误拒绝，不静默丢弃。参数重命名在未填别名时属于不同字段，不做旧名称兼容。

共用别名的规则：

- 类型必须相同；普通STRING不能与数据集STRING混用。
- 所有受限choices取交集，空交集422；无限制的目标不缩小交集。
- 所有默认值规范化后相同且允许才派生公共默认值；否则defaultValue为空、required=true，用户必须显式指定。不能以任务定义顺序选默认值。
- required至少为任一目标required；显示的choices不是唯一保护，resolve仍逐目标验证。

Plan返回inputs（复用FlowDefinition.Input）、choices和tasks中的parameters（复用Literal/InputRef）。该结构是编排片段，不是可以直接提交给执行API的完整Flow。

ResolveRequest为同样tasks加inputs。通过BindingResolver.prepareInputs处理未知输入/类型/必填/默认值，再用现有BindingResolver解析每个绑定，最后逐契约验证值及数据集允许范围。结果返回taskId/applicationId/version/image/parameters。数据集仍是逻辑版本引用，没有伪造DATA_PATH。解析不意味着已选址或数据已经传输。

## 状态与调用边界

目录链：HTTP → ApplicationCatalogService → JdbcApplicationRepository；数据集校验通过ResourceCatalogService公开接口，不跨模块访问表。

绑定链：HTTP → ApplicationBindingService(dataflow) → ApplicationCatalogService(deployment) → 既有runtime Input/Binding/BindingResolver。新增prepareInputs复用于既有Flow prepare，无Execution语义变化；deployment不依赖runtime。

所有新增字段均用于目录版本定位、参数约束、别名派生或解析响应；本批没有应用执行状态机、Runner/Manager空接口、分发结果表。测试与边界见[S4-02a验证](../verification/VER-S4-002-application-binding.md)。
