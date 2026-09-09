# VER-S2-001 Worker恢复与失败语义验收

日期2026-09-09，关联WF-007/008及S1回归。状态：PASS（S2及S1回归，不包含后续阶段）。阶段工作包S2-01至S2-04。

## 环境与版本

- Windows/PowerShell5.1，JDK21.0.7：D:/IDE/IntelliJ IDEA 2025.1.3/jbr；Maven3.8.8：D:/developevn/maven/bin/mvn.cmd。未更改系统Java8。
- Spring Boot4.1.1、Jackson3、Pebble3.2.4、Flyway、ArchUnit1.4.1、Testcontainers1.21.4。S2未添加依赖，锁定版本见POM。
- Docker Desktop29.5.3；Testcontainers MySQL8.0.46，mysql:8.0缓存镜像digest为sha256:7dcddc01f13bab2f15cde676d44d01f61fc9f99fe7785e86196dfc07d358ae2b。
- 每轮创建临时backend_s1_test库；升级故障用s2_upgrade_test临时schema，均位于同一本轮专用容器。名称沿用测试名不代表使用旧业务库。没有连接用户gateway数据库。
- backend无有效Git版本，构建输入定位见[S2源码SHA256清单](S2-source-sha256.md)，用于审计快照，不是新增业务hash字段。参考Kestra本地提交与差异记录于[ADR-0004](../decisions/ADR-0004-s2-worker-lifecycle.md)。

## 实际结果

最终统一scripts/verify.ps1于2026-09-09 14:33:17 +08:00退出0，Maven耗时57.689秒，父工程和8模块全部SUCCESS，可执行JAR打包成功。

| 测试 | 数量 | 结果 |
|---|---:|---|
| DefinitionTest | 10 | PASS |
| LifecycleTest | 3 | PASS |
| DurableWorkflowTest | 31 | PASS；真实MySQL，49.68秒 |
| ContractTest | 3 | PASS |
| ArchitectureTest | 1 | PASS |
| 合计 | 48 | 0失败、0错误、0跳过 |

结构检查通过：8模块、无依赖环、39生产Java索引、30功能编号。最终文档完成后复验97个本地链接和63份源码SHA256，均通过。Surefire XML已核对；验收后检查无本次Testcontainers容器或新后端测试JVM残留。

## 验收覆盖

| 范围 | 实际测试行为 |
|---|---|
| S1回归 | 定义/变量/绑定、版本CAS并发、同键幂等提交、版本快照、HTTP授权、查询与日志、独立JVM接受202后恢复 |
| 派发事务 | 注入Job写入失败，TaskRun开始/Attempt/Job全回滚，原Executor消息保留；恢复后能完成 |
| 归并事务 | 注入续消息失败，日志/状态/结果消费全回滚，RESULT仍持久保留；重试后无重复日志 |
| 租约与结果 | 过期后新epoch接管，TaskRun及Attempt不变；旧epoch心跳/回报、重复回报拒绝；结果保存后重启仍能归并 |
| Worker心跳 | Sleep超过短租约仍续租，竞争者无法接管；没有额外Attempt |
| Worker关闭/强杀 | 正常关闭不发布业务失败；单独Worker JVM强制结束后另一个JVM接管同Attempt，非伪造内存重试 |
| 重试 | 首次失败后成功，maxAttempts包含首次；等待跨上下文重启持久；耗尽才进入Errors |
| 超时 | 没有Worker也会按Attempt截止失败，重试次数受限；活动Sleep被停止并清理；deadline前已接受结果不因晚归并被判超时 |
| 取消 | 真实HTTP权限与幂等；运行中/未开始/等待重试/已存未归并结果的取消，晚结果拒绝，已失败Attempt不被改写 |
| Errors/Finally | MAIN失败跳过剩余主任务；处理器失败不覆盖原错误；清理失败继续；成功MAIN/失败清理可区分；取消仍清理 |
| 升级 | V2存在活动S1执行时V3拒绝；排空并仅修复测试库后升级成功，历史保留，checksum列删除且request_hash仍在 |
| 协议/架构 | 12个HTTP操作、14类record字段/引用防漂移；S1/S2示例实际解析；无跨模块环，Worker不能直接依赖运行状态Store |

新增“FINALLY重试期间取消”测试单独验证：主任务不重跑、清理按自身重试完成、最终KILLED，清理成功不写cleanupError。该用例在最终31项集成测试中通过。

## 过程中的失败与处理

- 首次编译时DefinitionTest遗漏一个旧record构造调用，按新增errors/finally字段修正；后续编译及原S1 26项回归通过。
- 随后39项、45项、47项分批测试通过，逐步加入心跳/超时/关闭/迁移故障证据。没有跳过Docker或将失败用例禁用。
- 迁移测试故意触发V3 guard，日志中的Flyway ERROR属于assertThrows断言预期；其后只对该测试schema排空/repair再验证迁移。不是忽略生产迁移错误。
- Surefire的native stream warning不等于测试失败，以XML failures/errors/skipped和Maven退出码为准。

## 复现与边界

在backend目录、Docker运行时：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify.ps1 -JavaHome 'D:\IDE\IntelliJ IDEA 2025.1.3\jbr' -MavenCommand 'D:\developevn\maven\bin\mvn.cmd'
```

报告在各模块target/surefire-reports；子JVM日志在platform-server/target/restart-evidence。容器和子进程由测试finally/AfterAll清理。

只验收同机独立Worker进程、共享MySQL和Log/Sleep；未验收数据库宕机/灾备、真实跨云断网、生产容量、远程Worker API/TLS、容器/任意外部副作用exactly-once。S3控制流/调度、S4资源/K8s、DQN/算法计量、旧系统数据迁移和前端均未实施。取消物理停止是协作式，不承诺任意不可中断外部任务立即停止。
