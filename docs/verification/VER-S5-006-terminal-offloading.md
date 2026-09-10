# VER-S5-006 终端卸载最小闭环

日期：2026-09-10。基线：fd4e76813d7e4c970340e089d8eb4aff380b470d，backend/main；本批修改仅新后端。范围S5-04b，关联OFF-001/OFF-002、ADR-0016；不进入S5-05。

## 环境和当前结果

Windows / JDK21（IDEA jbr）/ Maven3.8.8 / Docker；隔离真实MySQL、Registry、K3s、MinIO和Docker-in-Docker终端。没有连接旧业务库或替换旧镜像。网络/物理SSH、多云性能未测。

- 19:38:34：`mvn -DskipTests package`仅编译通过，不作为功能通过。
- 19:41:07：OffloadingTest 10项通过，失败/错误/跳过均0。
- 19:47:27：DefinitionTest 16项及OffloadingTest 10项、ImageDistributionTest选定3项通过；包含真实终端/边缘/云RULE执行、实际样本训练注册及DQN执行，以及排队取消、同Attempt接管。生成证据位于platform-server/target/offloading-evidence，不提交构建产物。
- 首轮完整verify发现DurableWorkflowTest旧断言期待13份迁移、实际15，失败1项。更新到V15并检查三张新表实际存在；不删除测试或跳过迁移。另加强同Attempt画像时间/字节不覆盖，以及真实失败/retry/接管后的反馈与容量释放断言。修正后将完整重跑；不沿用04a的175项结果作为本批通过。
- 首轮于20:04:33结束：runtime32项通过、server155项中154通过，仅上述迁移数量断言失败；32项真实容器/联邦场景及12项Python均通过，但未进入打包JAR验收，整体FAIL。随后重新运行相同标准verify，包含修正后的断言。
- 第二轮标准verify于20:16:31完成，BUILD SUCCESS、退出码0；188项Maven及12项Python全部通过，零失败/错误/跳过。没有删去或跳过首轮失败的测试。迁移拒绝及DB断连日志来自既有预期故障注入，所属测试最终通过。

## 最终结果：PASS（S5-04最小范围）

| 范围 | 数量 | 结果 |
|---|---:|---|
| runtime定义/生命周期/控制流 | 32 | PASS |
| 持久化/队列/恢复 | 86 | PASS |
| 接入/权限/策略 | 17 | PASS |
| 真实Registry/K3s/Docker/产物/联邦学习 | 32 | PASS |
| 卸载模型/画像/反馈/FIFO | 10 | PASS |
| HTTP/SQL | 6 | PASS |
| 协议/示例与架构 | 4 | PASS |
| 实际打包JAR空库迁移/启动 | 1 | PASS |
| Python联邦数值/卸载训练器（另计） | 7+5 | PASS |

FedAvg/FedProx各两轮逐张量数值审计均PASS；终端/边缘/云实际任务样本训练出的模型被Java加载并执行，Python/Java Q值误差在1e-9内。真实测试仅验证功能链，不以三条样本证明策略性能。失败/retry后终端active=0，同Attempt接管容器ID与业务写入次数不变、仅一份成功观测。

复现：在backend根目录运行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1 -JavaHome 'D:\IDE\IntelliJ IDEA 2025.1.3\jbr' -MavenCommand 'D:\developevn\maven\bin\mvn.cmd'`；本机路径需按安装位置替换。查看各模块Surefire/Failsafe XML和platform-server/target下federated-evidence/offloading-evidence。本次最终源码由包含本记录的Git提交追溯，不提交target产物或实际业务模型。

收尾结构/链接检查PASS：8模块依赖无环、82份Java全索引、32个功能编号、325个本地链接；git diff --check通过。Git默认schannel握手失败后，使用命令级OpenSSL TLS实现恢复正常远程读取，没有关闭证书校验或修改全局Git配置。

## 覆盖

模型schema/shape/有限值、动作mask、缺模型失败、版本不可覆盖与namespace隔离；规则负载与同Attempt决策固定；画像按应用版本/命令/参数/输入量/目标隔离；首个反馈生效；未启动/取消不参与reward；真实MySQL FIFO与8线程争抢2槽；HTTP READ/WRITE与CONNECT隔离。

真实三位置任务各生成并核对产物，用实际完成样本运行Python训练器，注册网络并再次执行DQN任务；Python与Java网络Q值数值对照。5项Python人工数值fixture只是训练器正确性测试，不是性能数据。FedAvg/FedProx原有7项数值测试及完整运行链将在全量回归中重跑。

## 限制

当前网络为单步episode的Q回报拟合，不是已验证的长期DQN优化；没有自动在线训练、未执行动作奖励、吞吐提升或性能优于RULE结论。终端断线恢复不在范围，远端不可确认停止时不能释放槽冒充取消完成。S5整体仍未完成，计量口径未实现。
