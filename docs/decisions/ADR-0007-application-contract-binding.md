# ADR-0007 应用契约目录与显式Flow边界

2026-09-10，ACCEPTED（方向修订）。本决策取代2d3c44f中关于自动派生输入、别名绑定和独立plan/resolve的决定；原版本由Git历史保留。只修正S4-02a，不进入S4-02b/c、S4-03或S5。

## 已核对来源

本地Kestra提交0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4（本地快照，不声称是最新官方版本）：

- core/src/main/java/io/kestra/core/models/flows/AbstractFlow.java：Flow显式持有inputs与outputs。
- core/src/main/java/io/kestra/core/models/flows/Flow.java：Flow持有variables及tasks。
- core/src/main/java/io/kestra/plugin/core/log/Log.java：作者指定message字面量或表达式，run时通过RunContext.render求值。
- core/src/main/java/io/kestra/core/runners/RunVariables.java：inputs、vars、outputs进入执行上下文。

据此沿用“Flow拥有输入声明、Task显式指定来源、runtime负责解析和执行”的职责，不根据镜像参数自动建立另一份Flow输入模型。没有据这些文件声称Kestra采用本项目的ApplicationVersion目录或JSON Binding语法。

## 决定

1. deployment保留ApplicationVersion、ApplicationContractValidator、ApplicationCatalogService、JdbcApplicationRepository及dep_application_version/V7。契约保存applicationId/version/image/parameters；同规范内容重放成功，不同内容409。image、标量类型、required/defaultValue/choices、DatasetRule不变。
2. resource拥有Cluster/DatasetVersion/Location。应用登记经资源公开接口验证同namespace数据集版本和format，不跨模块读表。
3. dataflow管理Flow保存、编辑和提交；Flow作者显式定义Input及Task参数来源。runtime拥有Flow/Execution/Binding/Worker及未来Runner。现有InputRef、VariableRef、TaskOutputRef、Literal和模板表达式保留，不新增ParameterBinding或表达式系统。
4. 删除ApplicationBindingService、ApplicationBindings（6个嵌套record）、ApplicationBindingController及plan/resolve两个API。撤销自动Input/InputRef/Literal生成、choices求交集、独立alias/fixedValues及其专用测试/示例。
5. prepareInputs在删除派生服务后没有独立消费者，合回BindingResolver.prepare，恢复78203a7的最简单实现。ExecutionService、FlowExecutor、Worker和持久消息链不变。
6. YAML与未来No-code编辑同一份Flow定义，不维护第二套alias/binding。当前只有既有JSON/YAML解析与保存，不宣称No-code已实现。
7. 等真实Application/Container Task可以执行时，再实现显式参数映射和执行闭环。本次不创建不可执行Task、Runner/SPI、新表/字段或新映射系统。原14张业务表保留，无数据库迁移。

## 差异与验收

Application契约及DatasetRule属于云边端镜像/数据集目录的业务需求；当前仅登记校验，不属于Kestra通用Flow输入定义。本项目现有有限Binding语法属于当前阶段的有意简化，不追求完整Kestra表达式能力。

该方向修正批次的应用目录仅登记/查询版本及验证约束，当时未实现真实镜像/部署/Job。后续用户另授权完成剩余S4，镜像准备与常驻Deployment按[ADR-0008](ADR-0008-s4-external-runtime.md)接入；此处保留历史批次边界，当前实现以进度文档为准。

测试必须保留应用目录及S1–S4-01回归，验证撤销接口不存在、目录操作不改写Flow定义/输入或创建Execution，更新OpenAPI/Java索引并执行clean后的verify。见[验证记录](../verification/VER-S4-003-explicit-flow-boundary.md)。
