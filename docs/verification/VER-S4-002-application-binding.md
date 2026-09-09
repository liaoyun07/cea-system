# VER-S4-002 应用契约与参数绑定

## 对应范围与版本

2026-09-10，S4-02a；涉及DEP-001部分能力、WF-002复用及SEC-001现有权限回归。未验证镜像拉取/复制、常驻Deployment、容器Job/产物、资源预约或真实多云。

验证时基线为提交78203a7797ae9dfa086c750171406602f8bf28e5加本批未提交工作区，当时尚无Git提交/推送授权；后续发布授权见[进度](../04-progress.md)。新增9个生产Java文件、1张dep_application_version表/V7、5个HTTP操作；修改BindingResolver抽取prepareInputs供原Flow和参数解析共同使用，不改变Execution主链。路径及职责见[Java索引](../01-code-architecture.md)，设计及Kestra来源见[ADR-0007](../decisions/ADR-0007-application-contract-binding.md)。

## 环境与复现

Windows11、JDK21.0.7（IntelliJ jbr）、Maven3.8.8、Docker29.5.3；父POM现有Boot4.1.1/Jackson3依赖管理未升级。真实Testcontainers MySQL8.0隔离库，不连接或迁移旧业务库；示例Registry地址没有被访问。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify.ps1 -JavaHome 'D:\IDE\IntelliJ IDEA 2025.1.3\jbr' -MavenCommand 'D:\developevn\maven\bin\mvn.cmd'
```

## 执行记录

首轮Maven verify于2026-09-10 00:48:31 +08:00退出0：98项（19单元+75集成+3协议+1架构），0失败/错误/跳过。随后补同任务共用别名、分页与规范值重放、示例实际登记/解析3个测试，统一verify于00:55:31 +08:00通过101项。

复查后将应用契约JSON读回的NUMBER显式保留BigDecimal，并在既有分页/规范值测试中追加高精度小数读回及重放断言，防止读回损失精度引起虚假版本冲突。此处是已有存储/重放消费者的修正，不引入额外字段或兼容分支。

最终scripts/verify.ps1于2026-09-10 00:57:29 +08:00退出0，101项（19单元+78真实MySQL集成+3协议+1架构），0失败/错误/跳过。总耗时约89秒，DurableWorkflowTest为81.13秒；结构检查通过8模块、57份生产Java、30个功能编号和174个本地链接。S4-02a验收PASS，完整S4-02仍IN_PROGRESS。

六份Surefire XML核对一致；测试结束后Testcontainers标签容器与本批BackendApplication测试JVM均无残留。git diff --check通过，HEAD仍为78203a7。本批只操作新backend及其隔离测试库，未修改/迁移/重启旧系统、未提交或推送代码。

新增15项真实MySQL/HTTP测试对应：

1. 应用版本重启后可读，同版本不可覆盖、新版本不改旧版本。
2. 8并发相同契约登记与两种冲突契约竞争，无重复或混合版本。
3. 类型/默认值/choices/镜像引用合法性，包括有限数字和整数范围。
4. 数据集必须同namespace登记、版本与格式符合、默认值在允许范围。
5. 只有显式别名成为运行输入；固定值覆盖镜像默认，不暴露内部参数。
6. 一个运行输入向多个任务分发；相同默认值共用。
7. 默认值冲突时要求显式输入，正反定义顺序行为一致。
8. 数据集允许范围交集、非法选择拒绝、普通字符串不能冒充数据集参数。
9. 别名类型不符及允许值空交集拒绝。
10. 未知参数/重复taskId/多来源/空别名/缺必填/输入类型错误拒绝。
11. 可选且无值时省略参数；解析不创建Execution。
12. 同任务多个参数共享别名及choices逐目标校验。
13. 目录分页/namespace隔离与1.0、1等规范数字重放。
14. 两份示例实际登记、生成输入并解析，不只检查JSON可读。
15. HTTP Basic/READ/WRITE/namespace隔离、错误码及绑定响应。

ContractTest覆盖24个HTTP操作、33个record字段映射及引用；ArchUnit补充deployment不依赖runtime/dataflow，dataflow/API不访问deployment Repository，deployment不访问resource Repository。原86项测试全部保留。

## 限制

只读绑定解析不是已保存的可执行Flow，示例镜像没有运行。未实现命名产物端口、运行路径注入、镜像契约与容器任务持久关联。数据集值为明确id/version，但未验证真实对象内容或位置可用性。不能据此标记DEP-001/DEP-002或整个S4-02完成，剩余见[S4规格](../features/S4-resource-runtime.md)。

没有新增Runner/SPI、应用执行状态或兼容旧契约字段。P04/P05/P06/P11的真实运行环境验收仍未完成。测试报告在target/surefire-reports（构建产物不提交）。升级保护测试中预期的Flyway ERROR以断言通过为准，不是未处理构建失败。
