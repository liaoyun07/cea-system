# VER-S6-001：编辑与流程管理

日期：2026-09-10；基线07cde131d8a0702826058cf369acc998f7b6f1ce，backend/main。关联WF-015（流程管理部分）、WF-016（后端协议）和[ADR-0018](../decisions/ADR-0018-flow-editing.md)。S6其他批次、完整前端、DQN研究和计量不在本批实现范围。

## 环境与当前验证

Windows / JDK21.0.7（IDEA jbr）/ Maven3.8.8 / Docker29.5.3；真实隔离MySQL、HTTP、Registry/K3s/MinIO及终端Docker。未启动/停止旧业务服务或修改已有数据库。运行环境仅单机隔离容器，不是物理多云验收。

- 22:57:37：跳过测试的package编译通过，不作为功能验收。
- 23:03:34：FlowManagementTest 11项全部通过，零失败/错误/跳过。命令：JDK21下 `mvn -B -ntp -pl platform-server -am -Dtest=FlowManagementTest -Dsurefire.failIfNoSpecifiedTests=false test`。该参数仅允许其他模块无同名定向测试，不跳过本测试类。
- 23:18:03：标准scripts/verify.ps1完整回归PASS，BUILD SUCCESS，退出码0。199项Maven（runtime32、持久化86、接入17、编辑11、真实容器/联邦32、卸载10、HTTP/SQL6、契约3、架构1、实际JAR1）和12项Python（联邦7、卸载训练器5）全部通过，零失败/错误/跳过。真实恢复测试的DB断连日志属于预期故障注入，不吞掉测试失败。
- 23:19:00：仅加强中文注释/描述的测试数据并更新OpenAPI说明后，FlowManagementTest与ContractTest共14项复测PASS；生产代码与上述全量verify相同。原文、YAML和JSON的中文往返正确。复测不累计进199项数量。
- 完整日志在platform-server/target/s6-01-verify.log；定向/收尾日志分别为s6-01-targeted.log、s6-01-final-check.log；逐项结果见Surefire/Failsafe。构建产物和临时算法证据不提交Git。复现完整回归：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1 -JavaHome 'D:\IDE\IntelliJ IDEA 2025.1.3\jbr' -MavenCommand 'D:\developevn\maven\bin\mvn.cmd'`，本机路径按实际安装位置替换。
- HTTP示例的3份JSON请求体解析通过。最终结构检查通过：8模块依赖无环、83份生产Java已索引、32个功能编号、353个本地链接；git diff --check通过。结构检查不代替业务测试。

## 新增测试覆盖

1. Schema从真实record生成，finally/then/else别名、5种Binding、递归引用存在，无第二套字段模型。
2. 校验/预览不产生修订、执行或Schedule；输入默认值/必填/未知参数与原BindingResolver一致，不伪造outputs。
3. 未知/重复字段、多文档、非法绑定/任务类型、路由namespace不匹配的校验与保存同样拒绝。
4. 历史修订原文准确导出，JSON/YAML格式往返；修改JSON再导入后通过原Executor/Worker真实执行，输出符合预期。
5. 批次后续冲突回滚前面Flow与Schedule；USER不能接管EDGE_POLICY，跨namespace失败整批回滚。
6. 最新修订搜索、精确label、分页；SQL引号和%/_仅是搜索内容，策略Flow不混入。
7. READ/WRITE/EXECUTE与namespace边界，预览不提升权限，启用Schedule仍要求EXECUTE。
8. 批量数量/大小/唯一ID/修订约束及重投409；反序并发批次按固定锁序仅一方CAS成功。
9. 所有已登记Flow YAML示例经JSON和YAML格式化后再由真实Parser读取，语义一致。

没有测试完整No-code页面；结构Schema不是第二份FlowValidator，不宣称本批实现全部JSON Schema语义约束。Namespace Files/Webhook/Checks/SLA/afterExecution和S7尚未完成。

## 文件与边界

新增1份生产Java FlowSchema；修改FlowParser、FlowValidator、FlowService、JdbcFlowRepository、FlowController。新增FlowManagementTest并加强ContractTest。5个HTTP操作及5个API请求/响应record都被真实接口消费；没有DSL字段、数据库迁移/表/列、缓存、状态机或SPI。移除无消费者的Repository.list，由参数化search供原list和新搜索共用。Execution主链和卸载策略不变。
