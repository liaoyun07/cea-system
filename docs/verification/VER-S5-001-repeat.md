# VER-S5-001 Repeat状态反馈与轮次屏障

日期2026-09-10；基线Git `8efaa5918ddb57d391b67ea87510f398f1267f39` 加本批修改，发布提交包含本记录。对应S5-01/WF-013，不代表整个S5或真实联邦学习迁移完成。

## 验证结果

最终完整verify于2026-09-10 13:54:58 +08:00通过：133项，0失败、0错误、0跳过。最终源码包含按当前循环作用域/轮次读取的SQL调整。

使用JDK21.0.7、Maven3.8.8、Windows11、Docker Desktop29.5.3，运行：
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1 -JavaHome 'D:\IDE\IntelliJ IDEA 2025.1.3\jbr' -MavenCommand 'D:\developevn\maven\bin\mvn.cmd'`。

| 测试 | 数量 |
|---|---:|
| DefinitionTest / LifecycleTest / ControlFlowTest | 14 / 3 / 9 |
| DurableWorkflowTest | 78 |
| ImageDistributionTest | 18 |
| CommonTaskTest | 6 |
| ContractTest / ArchitectureTest | 3 / 1 |
| DeploymentSmokeIT | 1 |
| 合计 | 133（Surefire 132 + Failsafe 1） |

继续使用隔离MySQL8、两个认证Registry2、Skopeo1.20、K3s1.30.6、真实MinIO和容器。不是对旧系统/生产集群的运行验收。133项包括S1–S4回归与实际打包JAR空库启动。

## 新增10项测试与真实断言

- 3项定义测试：显式状态键和保留名、循环外不得引用内部输出、初始来源/反馈的作用域、拒绝嵌套和未知输入；不自动补依赖。
- 6项真实MySQL测试：两轮输出seed-x-x及独立UUID；DAG两分支完成后反馈；轮间重建应用上下文后保留首轮UUID并完成第二轮；重试仍是同轮TaskRun上的Attempt；失败/取消不创建下一轮且运行Finally；非整数/超范围轮数失败且无子任务。
- 1项真实Kubernetes/MinIO测试：两轮各运行处理和检查容器。第二轮实际读取第一轮发布的S3文件，再追加内容；最终文件为原始内容加两次updated。两个检查输出分别为2、3行，且第二轮处理startedAt不早于第一轮检查endedAt。模型命名仅模拟数据流角色，这不是实际FedAvg或性能测量。

控制任务不创建Attempt；叶子Job名与产物目录继续绑定独立TaskRun UUID/Attempt。循环状态更新、下一轮创建和派发由原Executor事务管理，没增加第二套调度/Worker链。当前轮读取使用SQL作用域过滤，不每次反序列化全部历史。

## 实施与过程记录

- 新增FlowDefinition.Repeat嵌套record；Task.repeat、TaskRun.parentTaskRunId/iteration有真实执行与查询消费者。
- V10修改wf_task_run轮次身份与父循环字段，无新增业务表/生产Java文件/API/Binding来源；当前70份生产Java、15张表、27个操作、34个公开record映射。
- 结构、功能、计划、进度、OpenAPI、示例及ADR均同步；[代码索引](../01-code-architecture.md)、[协议](../contracts/s5-repeat.md)、[ADR-0011](../decisions/ADR-0011-repeat.md)记录源码文件和Kestra参考版本。
- 定向9项控制定义和5项Repeat MySQL测试通过，随后增加DAG专项并通过；一次命令因PowerShell未引用带点的Maven属性名而未进入测试，引用完整参数后成功，不算业务测试失败/通过。
- 13:49:40第一次完整133项verify通过。复核后把按轮查询下推SQL，并再次运行完整verify，上方最终结果覆盖最后源码。
- 测试中Flyway拒绝活动执行的ERROR、DB故障注入的通信WARN、Worker被中断后的远端接管提示，均保留日志并检查最终状态；没有跳过故障测试。
- 没有修改旧web-platform/amis、既有数据库/镜像或启停已有服务；只使用可清理的隔离测试资源。构建产物、测试日志及临时凭据不提交Git。
- 最终结构检查通过：8模块、70份生产Java索引、30个功能编号、239个本地链接；git diff --check通过。验证完成后，本批Testcontainers容器及测试Java进程查询为空。

## 边界与下一批

本批为固定1..100轮、显式状态反馈、整轮屏障。支持轮内已有Sequential/Parallel/Dag/If；不支持嵌套Repeat、条件/无限循环或控制任务retry/timeout。评估节点需作者放入Repeat内；放在外部就是整个循环后执行一次，不按镜像名推断业务意图。

S5-02真实FedAvg/FedProx、S5-03网关/终端及策略、S5-04卸载/DQN、S5-05 SDK计量均未验收，功能索引不提前标完成。计量候选仍需讨论和实际验证，不承诺2GB/s，不新增指标接口或伪造样本。
