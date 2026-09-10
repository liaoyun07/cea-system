# VER-S5-004 S5-03接入与策略验证

日期2026-09-10，基线1769cbe加本批修改；发布提交包含本记录。范围EDGE-001/002，不包含S5-04/05。设计见[ADR-0014](../decisions/ADR-0014-edge-access.md)，协议见[接入文档](../contracts/s5-edge-access.md)。

## 环境及命令

Windows 11 / JDK21.0.7 / Maven3.8.8 / Docker Desktop29.5.3。测试独立MySQL8.0与随机端口Spring Boot4.1.1真实HTTP；不连接旧数据库或启动旧服务。

```powershell
$env:JAVA_HOME='D:\IDE\IntelliJ IDEA 2025.1.3\jbr'
& 'D:\developevn\maven\bin\mvn.cmd' -B -ntp -pl platform-server -am test '-Dtest=EdgeAccessTest,ArchitectureTest' '-Dsurefire.failIfNoSpecifiedTests=false'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1 -JavaHome 'D:\IDE\IntelliJ IDEA 2025.1.3\jbr' -MavenCommand 'D:\developevn\maven\bin\mvn.cmd'
& 'D:\developevn\maven\bin\mvn.cmd' -B -ntp -pl platform-server -am verify '-Dtest=EdgeAccessTest,DurableWorkflowTest,ContractTest,ArchitectureTest' '-Dsurefire.failIfNoSpecifiedTests=false'
```

## 实际结果

- 首次12项接入测试于16:39:04全部通过。
- 增补边界后，16项EdgeAccessTest与1项ArchitectureTest于16:41:58通过，0失败/错误/跳过。
- 结构检查通过：8模块、76份生产Java，依赖无环、索引与文档链接一致。
- 完整verify于16:53:31 +08:00通过166项，0失败/错误/跳过；另7项Python数值测试通过。不是将定向测试重复累加。
- 最后补上“启用策略需EXECUTE”检查/测试、删除无消费者的Repository.save旧包装后，于16:56:27重编译并通过107项定向复测：持久化86、接入16、协议3、架构1、打包JAR启动1。0失败/错误/跳过；不是第二次全量测试，不重复累加计数。

| 完整verify测试 | 数量 |
|---|---:|
| DefinitionTest / LifecycleTest / ControlFlowTest | 14 / 3 / 13 |
| DurableWorkflowTest | 86 |
| EdgeAccessTest | 16 |
| ImageDistributionTest | 23 |
| CommonTaskTest | 6 |
| ContractTest / ArchitectureTest | 3 / 1 |
| DeploymentSmokeIT | 1 |
| 合计 | 166 |

原有迁移拒绝、Worker强杀和DB短时断连测试会输出预期ERROR/WARN；对应测试均通过，不是略过启动故障。真实联邦学习、模型反馈与数值核对已回归，不代表本批新增算法或性能验收。

## 新增验收覆盖

1. 真实HTTP注册网关/终端，外部CONNECT账号与服务端心跳时间。
2. 无认证401、越权403、网关不可访问普通管理/执行API。
3. 终端请求两个真实Log Task，经过原Executor/Worker，结果来自Execution.outputs。
4. 事件按集群/eventType匹配策略；普通Flow列表/编辑/历史/提交不绕过管理范围。
5. 策略改版、停用后重复请求仍指向原Execution，新事件按最新版本或拒绝。
6. 四线程并发同事件仅一个Execution；相同键改内容/换请求类别409；不同终端同键互不干扰。
7. 输入缺失、策略不存在、坏定义、版本冲突均回滚，不留下伪成功回执或半个策略。
8. 结果跨网关403、跨终端404；取消直接返回原KILLED状态。
9. 网关、终端或集群停用拒绝接入；跨namespace拒绝；cluster事件匹配隔离。
10. 固定网关/终端归属；重复事件路由409；策略禁止独立启用Schedule。
11. 服务端上下文关闭重启后，同请求仍指向同Execution，原Worker链继续执行；不是终端断线补发测试。
12. OpenAPI加入12条操作及8个公开record映射，架构禁止edge跨模块读Repository。

## 限制

网关/终端是HTTP测试客户端，不是已部署的物理代理或网络故障试验。协议样例为两节点回显，不称为工业算法。无设备侧认证、MQTT、文件上传代理、二进制结果下载、离线恢复、结果ACK或下行推送。单集群/eventType匹配一策略，不支持事件路由重分配。无DQN、SDK或吞吐结论。
