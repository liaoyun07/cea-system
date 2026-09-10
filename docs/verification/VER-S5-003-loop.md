# VER-S5-003 通用Loop与动态联邦客户端

日期2026-09-10，基线dd1a75aca3f9a702bf2414348c3a86c95c13bac2加本批修改；发布提交包含本记录。S5-02b/WF-017/FL-001，仅动态Loop与FedAvg/FedProx；不进入S5-03至05。

## 验证状态

最终完整verify于16:00:37 +08:00通过150项，0失败/错误/跳过；镜像内另有7项Python测试通过。结构检查通过：8模块、70个生产Java文件、32个功能编号。统计来自本轮Surefire/Failsafe XML，不累计先前定向和中间轮次。

| 测试 | 数量 |
|---|---:|
| DefinitionTest / LifecycleTest / ControlFlowTest | 14 / 3 / 13 |
| DurableWorkflowTest | 86 |
| ImageDistributionTest | 23 |
| CommonTaskTest | 6 |
| ContractTest / ArchitectureTest | 3 / 1 |
| DeploymentSmokeIT | 1 |
| Maven合计 | 150 |
| 镜像内Python unittest | 7 |

最终本轮FedProx/FedAvg数值证据分别于15:56:41/15:59:09重新生成，审计均PASS。FedAvg共有14个TaskRun（含Repeat和两次Loop控制实例），6个train实例；FedProx共有12个TaskRun，4个train实例。不是把控制TaskRun算作容器Job。

| 算法/客户端数 | 轮次 | loss | accuracy |
|---|---:|---:|---:|
| FedAvg / 3 | 1 | 2.180205374956131 | 0.27734375 |
| FedAvg / 3 | 2 | 2.0490530282258987 | 0.32421875 |
| FedProx / 2 | 1 | 2.214192509651184 | 0.28125 |
| FedProx / 2 | 2 | 2.1616303771734238 | 0.30859375 |

这两行算法使用不同客户端子集，是动态编排功能测试，不能用来比较算法优劣。

命令：
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1 -JavaHome 'D:\IDE\IntelliJ IDEA 2025.1.3\jbr' -MavenCommand 'D:\developevn\maven\bin\mvn.cmd'`。

环境：Windows11、JDK21.0.7、Maven3.8.8、Docker Desktop29.5.3；隔离MySQL8、认证Registry2、Skopeo1.20、K3s1.30.6、MinIO；Python3.11.15/Torch2.2.2+cpu/NumPy1.26.4。未改旧系统/数据库/集群/Harbor；测试镜像使用随机标签，测试后清理。不把四个资源别名指向同一K3s说成物理多云。

## 验收内容

- YAML/持久JSON同一解析：Loop、ITEM原生对象路径、候选数组归一Literal、动态候选Binding；拒绝作用域泄漏、非法并发/集合和Loop内嵌套动态循环。
- 真实MySQL：有界item并发、乱序完成仍按输入顺序输出、重复值独立实例；服务重启后TaskRun UUID不变，旧结果重放拒绝。
- 叶子retry保持item/TaskRun，只增加Attempt；永久失败停止新增item，等待已接纳组完成；包含组内Parallel失败但同组另一个叶子仍运行的场景。
- 空集合、INPUT/VARIABLE/LITERAL/TASK_OUTPUT四种values来源；40个客户端项只使用一份子Task定义；运行期超过1000项不创建子实例。
- Repeat两轮中的同名Task和相同item序号由不同Loop父UUID隔离，feedback读取本轮集合，第二轮不误认为已执行。
- cancel停止已接纳item，跳过未接纳项，Finally一次；真实Kubernetes场景同时包含已启动Pod和等待平台槽的item，终态前均停止。
- V11空库迁移；从V10升级拒绝活动Execution，排空后保留历史并禁止同一root/null作用域重复实例。没有新增业务表/列。
- 集合文件：真实URI数组下载与JSON本地路径清单；不允许非字符串/非法S3 URI/展开文件名冲突。Worker租约接管保留Prepared清单、远程Job UID及Attempt，不重新执行业务。
- 两个真实联邦Flow：FedAvg选择3客户端，FedProx选择2客户端(edge-a/edge-c)，两轮；分别11和9个Job，唯一train定义。每轮Loop显式models数组顺序与实际train输出一致，后端清单实际送入聚合Pod。
- 真实MNIST：FedAvg使用128+256+384=768条训练，FedProx使用128+384=512条训练，统一独立test split的256条。两种算法各客户端从上一轮真实全局模型重新训练核对、逐张量验证加权聚合、重新评估；不是只验证容器退出码。

## 测试过程与限制

首次78项旧MySQL回归仅迁移数量断言失败（预期10，实际11），V11自身成功；同步为11后，83项MySQL与3项契约定向验证于15:42:38通过。第一轮完整verify于15:51:19通过146项（另7项Python）；随后补充组内失败、升级guard、40项集合和清单接管测试，最终结果单独统计，不重复累计定向/中间轮次数量。

当前无Loop子Execution、流式/无限/Map循环、Loop级retry/timeout、忽略失败/部分成功聚合、自动客户端发现、No-code或计量SDK。真实联邦验收规模只证明执行和数值正确，不是全量精度、吞吐、1000客户端压力或物理多云验收。

本批迁移要求新后端排空/停机升级；不会原地迁移历史Flow或覆写已登记ApplicationVersion。新清单CLI需要新镜像及对应版本/Flow修订，步骤见[算法说明](../../algorithms/federated/README.md)。

证据保留在本地忽略目录platform-server/target/federated-evidence的execution.json、task-runs.json、numerical-audit.json及模型文件，单元/集成结果在各target的Surefire/Failsafe报告。Git只纳入源码、示例与汇总记录，不上传缓存数据、凭据、构建产物或模型。
