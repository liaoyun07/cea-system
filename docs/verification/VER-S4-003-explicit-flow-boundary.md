# VER-S4-003 S4-02a显式Flow边界修正

## 范围与版本

2026-09-10，以2d3c44ff67f509871b8cc32b43b66fd234857e82为基线加本次修改。仅修正S4-02a，保留应用目录/契约和V7，不进入S4-02b/c或S4-03。设计见[ADR-0007](../decisions/ADR-0007-application-contract-binding.md)。

删除3个生产类文件：ApplicationBindingService、ApplicationBindings、ApplicationBindingController；其中6个record为TaskSelection、Request、TaskBindings、Plan、ResolveRequest、ResolvedTask。删除2个plan/resolve HTTP接口、对应6个OpenAPI schema和绑定示例。BindingResolver.prepare恢复78203a7版本，无独立prepareInputs。没有新增表、字段、映射模型或SPI；Application契约字段及Execution主链未变。

## 验证安排与结果

Windows11、JDK21.0.7、Maven3.8.8、Docker29.5.3、Testcontainers1.21.4/MySQL8.0。先Maven clean，再统一scripts/verify.ps1：2026-09-10 01:53:56 +08:00退出0，95项（19单元+72真实MySQL集成+3协议+1架构），0失败/错误/跳过，总耗时约89秒。不是沿用历史101项。

- 删除8项仅验证派生/别名/交集的集成测试。
- 保留7项应用目录测试，其中示例及HTTP测试去除自动绑定部分。
- 新增2项回归：撤销的端点以已认证用户访问返回404；注册契约（含与Flow同名不同类型的参数及无默认值必填参数）不改变Flow定义/输入、不创建执行，原显式Flow执行结果仍正确。
- 原63项真实MySQL集成、19项单元、3项协议、1项架构测试保留。
- OpenAPI保留22个操作、27个record映射；生产Java54份，业务表14张。检查生产源码、干净构建产物不存在被删除的绑定服务/结构。
- 当前没有Application/Container Task或No-code；不能声称其映射/执行测试通过。

六份Surefire XML核对通过。重建的dataflow/server JAR未包含已删除绑定类；测试容器和测试BackendApplication JVM已退出。结构检查通过8模块、54个生产Java、30个功能编号、178个本地链接；git diff --check通过。原迁移保护测试中的Flyway ERROR是已断言的预期失败，最终测试无错误。后续只修正文档及OpenAPI错误描述，不更改生产代码或测试行为。

复现（只操作新backend与隔离测试库）：

```powershell
# 删除Java类后先clean，防止旧class残留参与组件扫描/打包
# 使用JDK21执行Maven clean，再执行统一验证
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify.ps1 -JavaHome 'D:\IDE\IntelliJ IDEA 2025.1.3\jbr' -MavenCommand 'D:\developevn\maven\bin\mvn.cmd'
```
