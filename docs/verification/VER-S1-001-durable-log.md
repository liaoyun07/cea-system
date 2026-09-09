# VER-S1-001 定义与最小持久闭环验收

日期：2026-09-08。结果：PASS（仅S1）。关联：WF-001、WF-002、WF-003、WF-004、WF-005、WF-006及SEC-001本地部分；工作包S1-01至S1-05。

## 环境和可追溯版本

- Windows/PowerShell5.1；JDK21.0.7，路径D:/IDE/IntelliJ IDEA 2025.1.3/jbr；Maven3.8.8。未更改系统默认JDK8。
- Spring Boot4.1.1、Jackson3（BOM）、Pebble3.2.4、ArchUnit1.4.1、Testcontainers1.21.4；详细锁定配置在父/模块POM。Testcontainers BOM优先，避免Boot BOM拉入另一主版本的传递依赖。
- Docker Desktop29.5.3，测试MySQL8.0.46；mysql:8.0实际镜像digest：sha256:7dcddc01f13bab2f15cde676d44d01f61fc9f99fe7785e86196dfc07d358ae2b。
- Testcontainers每次新建backend_s1_test隔离库，动态映射端口；不用H2、不连接gateway-mysql。触发器故障注入只在这个临时库；测试容器开启log-bin-trust-function-creators，不改业务数据库参数。
- backend没有有效Git提交号；见[构建输入SHA256清单](S1-source-sha256.md)。清单涵盖POM、Java、SQL/配置、示例、脚本、API协议，不包含target、凭据或自身。

## 实际结果

| 测试 | 数量 | 结果 |
|---|---:|---|
| DefinitionTest | 10 | 通过，0失败/跳过 |
| DurableWorkflowTest | 12 | 通过，真实MySQL与实际HTTP，0失败/跳过 |
| ContractTest | 3 | 通过，路由、record字段、引用、示例 |
| ArchitectureTest | 1 | 通过，包含多条模块/类依赖约束 |
| 合计 | 26 | 通过 |
| Maven verify | 父+8模块 | 全部SUCCESS；Boot可执行JAR打包成功 |
| 结构检查 | 8模块/34生产Java/30功能编号 | 文档、模块依赖和Java索引一致 |

完整增量verify于2026-09-08 18:50:36 +08:00结束，退出0，耗时28.860秒；其中真实MySQL测试21.17秒。统一verify脚本最终复验于18:52:38 +08:00结束，退出0，耗时26.441秒；26项全通过、0失败/错误/跳过。结构检查通过71个本地链接。最终报告位于各模块target/surefire-reports（可再生成）；子JVM重启日志在platform-server/target/restart-evidence。

## 覆盖了什么

1. 同一JSON/YAML模型；未知字段、重复键、重复任务、不支持类型、未知Binding、变量循环和错误默认值拒绝；变量定义顺序无关；输入原类型保留。
2. 不可变历史、CAS冲突；6个并发保存者只有1个成功；回滚生成新版本。
3. 12次同键并发提交只生成1个Execution；不同payload同键冲突；模板编辑后重投仍返回原execution，执行仍使用旧版本/默认值。
4. 顺序Log产生真实数据库日志/输出；TaskRun/Attempt与时间可查；模板运行时错误FAILED并SKIPPED后续任务。
5. 提交消息失败时Execution/TaskRun一起回滚；完成Log时续消息失败，日志/状态/消息确认也一起回滚，恢复消费后不重复日志。
6. 4个并发消费者推进同次执行，无重复日志、Attempt；运行中TaskRun在Spring上下文重启后保持ID和attempt。
7. 独立子JVM通过HTTP返回202后被destroyForcibly；新JVM从同库恢复并完成，不丢已接受请求。测试为本机进程恢复，不是外部Worker或跨机容灾。
8. 真实HTTP 401、namespace越权403、只读用户写403、版本409、参数422、缺幂等头400、202提交及状态/日志查询；X-User不能伪造身份。
9. 11个HTTP方法/路径操作与OpenAPI一致，13种record字段与文档一致；接口引用有效；示例被实际解析。
10. ArchUnit无模块包环；runtime不依赖业务/foundation，runtime.model不依赖Spring/JDBC，Controller不直接访问持久层。

## 首次失败及处理记录

- 第一轮12个集成测试中：缺省required被严格primitive反序列化拒绝，导致10个错误；另外HTTP因上次构建class未包含-parameters而失败。修正Input的可省略required规范化，补默认值回归用例；compiler启用parameters后clean重编译。没有弱化输入值类型校验。
- 第二轮只剩2个测试错误：MySQL开启binlog而测试账号不能创建故障触发器。只调整Testcontainers启动参数允许测试触发器，未修改生产授权。
- 第三轮23项全部通过；补3项协议测试后26项全部通过。
- Surefire可能记录JDK/native库输出stream warning；此项不是用例失败，未关闭测试或忽略失败。以XML中failures/errors/skipped以及Maven退出码为准。

## 复现

在backend目录，确保Docker运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify.ps1 -JavaHome 'D:\IDE\IntelliJ IDEA 2025.1.3\jbr'
```

也可在JDK21环境执行 `mvn -B -ntp clean verify`。测试自己创建并清理容器/子JVM，不要求手动开启旧服务。Docker不可用会报错，不自动跳过真实数据库验证。

## 没有验收的能力

S2的Worker投递/租约/epoch、Retry、超时、取消、Errors/Finally；S3的DAG/并行/触发器；容器/真实多云、终端卸载、数据集、FedAvg/FedProx、SDK计量、旧数据迁移均未实现/未测试。
S1的Log“原子副作用”仅指同库写入，不能推导出任意外部任务exactly-once。
没有界面验收、性能/容量、生产TLS/RBAC、数据库宕机/备份恢复验收；完整OpenAPI规范和响应实例Schema验证尚非当前防漂移测试的覆盖范围。
