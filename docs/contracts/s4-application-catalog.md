# S4-02a 应用契约目录协议

这是应用契约登记/查询API，不是镜像执行API；不保存Flow或创建Execution。真实分发和常驻部署仍在S4-02后续子批次。字段以[OpenAPI](openapi.json)为准。

## 目录与版本

所有接口前缀/api/namespaces/{namespace}，Basic身份沿用已有配置。

| 方法/路径 | 权限 | 行为 |
|---|---|---|
| PUT /applications/{applicationId}/versions/{version} | WRITE；引用数据集时另需READ | 注册完整契约，id/version与路径一致；首次/同内容200，不同内容409 |
| GET /applications/{applicationId}/versions/{version} | READ | 指定版本；不存在404，不推断latest |
| GET /applications | READ | 按applicationId/version字典序分页，limit默认20、范围1..100；offset默认0、范围0..1000000 |

未知JSON字段400，无身份401，越权403，未找到版本404，不可覆盖冲突409，非法契约422。基础设施故障500，不返回伪成功。

ApplicationVersion仅含applicationId/version/image/parameters。新V7的dep_application_version保存namespace/id/version/contract_json，主键(namespace,application_id,version)。一次注册只有一行原子插入；并发同内容可重放，不同内容只有一个版本胜出。没有额外checksum、状态或版本头表。JSON对象键排序，标量数字统一，位置/参数内容不引用旧DTO；choices顺序属于描述内容，修改需新版本。

image要求显式repository:tag或repository@sha256:digest；支持普通小写仓库路径及registry:port。当前只验证引用形式，不访问Registry，不保证tag不移动或镜像存在；digest是可选OCI引用的一部分，不计算额外hash。不得把密码、token或真实凭据放入契约，契约可被本namespace有READ权限的账号读取。

## 参数声明

见[示例契约](../../examples/s4-application-contract.json)。最多100个业务参数，名称为字母/下划线开头、后续字母数字下划线，最多100字符。

Parameter包含type、required、defaultValue、choices和可选dataset：

- type支持STRING/INTEGER/NUMBER/BOOLEAN；required默认false。INTEGER限有符号64位整数，NUMBER必须有限；STRING最多8192字符。不自动把字符串数字转成数字。
- defaultValue可不填；有值必须通过类型和允许值校验。required无default不妨碍登记；它声明未来任务执行所需的参数，不自动产生Flow Input，也不意味着当前能执行镜像。
- choices可为空表示不限制，否则最多100个不重复非null标量；数字按规范值去重。
- dataset只能用于STRING，且不能另填choices。DatasetRule指定format及1..100个不同DatasetRef(datasetId/version)。全部引用必须已在同namespace资源目录注册且格式一致，否则拒绝登记，不残留部分应用记录。
- 数据集参数的值是datasetId/version（例如mnist/v1），不是路径，也不是自由填写的未注册名称。目录原样提供dataset.allowed约束，不对不同参数的允许值自动求交集。不按DATASET这个参数名猜测用途。

当前不包含命名产物端口、LocalData路径注入、系统环境变量、Secret或任务资源需求；这些随真实Runner消费接入，不能说现有契约已覆盖完整镜像运行协议。

## Flow与执行边界

Flow作者在同一份定义中显式声明inputs，以及Task参数的来源：inputs、vars、上游outputs或Literal。既有runtime Binding和Log模板语义不变，参见[S1绑定语义](s1-protocol.md)与[S3协议](s3-protocol.md)。Application/Container Task及其显式映射尚未实现，不能将应用契约直接提交执行。

YAML与未来No-code共用Flow定义，不保存另一套alias/binding；当前没有No-code编辑器。已撤销的plan/resolve端点不提供兼容入口。

目录链：HTTP → ApplicationCatalogService → JdbcApplicationRepository；数据集校验通过ResourceCatalogService公开接口。不保存Flow、不创建Execution、不自动生成Input/InputRef/Literal。

本批无新表/字段/SPI。完整真实任务映射和运行契约等Application/Container Task可执行时再实施；没有提前进入S4-02b/c或S4-03。[方向决策](../decisions/ADR-0007-application-contract-binding.md) / [验证记录](../verification/VER-S4-003-explicit-flow-boundary.md)。
