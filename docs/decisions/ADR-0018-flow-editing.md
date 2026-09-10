# ADR-0018：单一Flow事实源的编辑与管理

状态：S6-01已实施并验收，见[VER-S6-001](../verification/VER-S6-001-flow-editing.md)。基线07cde131d8a0702826058cf369acc998f7b6f1ce。

## 参考

本地Kestra提交0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4：

- webserver/src/main/java/io/kestra/webserver/controllers/api/FlowController.java：validate、search、export、import入口。
- core/src/main/java/io/kestra/core/services/FlowService.java：解析/模型校验与源文本导入、dry-run分离。
- core/src/main/java/io/kestra/core/docs/JsonSchemaGenerator.java：根据运行模型、Jackson多态及字段生成编辑Schema。

沿用模型/源码统一、编辑校验无副作用、服务统一保存的职责。当前有意简化：有限record模型生成结构Schema，不引入插件生态、Schema缓存、ZIP、多文档YAML或自动安装；每次一个Flow文档，批量使用有界JSON数组。维持本项目原expectedRevision而非导入覆盖；服务端Validator是语义权威，不复制第二个执行预览器。

## 决定与真实消费者

- 新FlowSchema从FlowDefinition字段和Binding注解读取结构，FlowService/HTTP为编辑器输出；字段别名finally/then/else沿用Jackson注解。
- validate与save共用同一解析和路由/调度权限检查；preview再复用BindingResolver.prepare处理输入/变量。未来outputs不伪造，动态Loop/Repeat不展开执行。
- import经FlowService原save事务创建修订；Repository只是USER最新修订搜索，不跨模块查询Execution或Resource表。
- 原文导出保留用户源文本；JSON/YAML导出是同模型的规范表达，往返通过原解析器验证。

不新增数据库表/列/迁移、DSL字段、alias、状态机、SPI或HTTP身份模型。Execution主链不变；S5后置功能及S6其余批次仍未完成。
