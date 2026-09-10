# VER-S5-002 FedAvg/FedProx迁移

2026-09-10；基线b59a17a6652adfeae349b24ef70d3c9884c15c7e加本批修改，发布提交包含本记录。仅S5-02/FL-001，S5整体仍IN_PROGRESS；其它流任务及S5-03/04/05未实施。

## 最终结果

定向验证于14:44:53 +08:00通过5项（3项协议、2项算法集成）。最终完整verify于15:00:58 +08:00通过135项，0失败/错误/跳过；镜像内另外7项Python测试通过。以下为实际报告统计，不把定向测试再重复计入全量总数。

命令：
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1 -JavaHome 'D:\IDE\IntelliJ IDEA 2025.1.3\jbr' -MavenCommand 'D:\developevn\maven\bin\mvn.cmd'`。

| 测试 | 数量 |
|---|---:|
| DefinitionTest / LifecycleTest / ControlFlowTest | 14 / 3 / 9 |
| DurableWorkflowTest | 78 |
| ImageDistributionTest | 20（新增两个真实联邦学习集成测试） |
| CommonTaskTest | 6 |
| ContractTest / ArchitectureTest | 3 / 1 |
| DeploymentSmokeIT | 1 |
| Maven合计 | 135 |
| 算法镜像内Python unittest | 7（被集成测试实际调用，不把子断言重复计数） |

环境：JDK21.0.7/Maven3.8.8/Windows11/Docker Desktop29.5.3；独立MySQL8、两个认证Registry2、Skopeo1.20、K3s1.30.6、MinIO，CPU Torch2.2.2+cpu/NumPy1.26.4/Python3.11.15。实际镜像由本批Dockerfile构建，未使用旧镜像内业务代码或数据。

## 真实验证内容

- 本批PowerShell注册脚本实际调用HTTP API，登记两个数据集版本、五个应用契约和两个Flow修订；同一YAML通过真实解析器，未加入Java硬编码模板或启动seed。
- 真实MNIST官方下载压缩文件按官方MD5检查。训练768条按标签排序后分为128/256/384三个不重叠分片，测试独立官方test split的256条；固定seed13。单元测试的随机张量明确仅用于数学测试，不冒充MNIST。
- 每个算法两个Repeat轮次，共11个真实Job（init一次、每轮3训练+聚合+评估），两个算法共22个Job；每个叶子只有1次Attempt。
- 四个目录位置为cloud/edge-a/b/c，均指向同一隔离K3s；实际持久预约记录和Pod环境证明选择正确位置，文件数值审计证明客户端使用对应分片。不是物理多云或跨地域实验。
- 三客户端TaskRun区间重叠；聚合等待三个客户端全部完成，评估等待聚合，第二轮训练不早于首轮评估结束；全部模型产物按不同TaskRun路径隔离。
- 导出每轮实际PyTorch文件，使用上一轮真实全局模型和对应真实分片重新训练，逐张量比较客户端结果；以double重算按样本数加权的聚合权重，再从聚合模型重新计算全局loss/accuracy。两轮模型确实变化，不只检查退出码或元数据。
- Python单元验证mu=0与FedAvg相等，mu>0影响权重；加权结果不同于简单平均；拒绝重复客户端、混算法/轮次、空数据、非有限值及错误下载缓存。
- 无生产Java/表/字段/API/SPI变更；既有S1–S5-01主链回归及实际JAR启动验收。新增checkpoint字段属于算法数据，不是第二套执行状态。

最终完整verify的实际全局评估结果如下，与定向结果一致；这是768条训练/256条测试、MLP、每轮1个本地epoch的功能验收，不是精度基准。FedProx/FedAvg数值审计分别于14:57:30/14:59:33 +08:00重新生成并通过。

| 算法 | 轮次 | loss | accuracy |
|---|---:|---:|---:|
| FedAvg | 1 | 2.180205374956131 | 0.27734375 |
| FedAvg | 2 | 2.0490530282258987 | 0.32421875 |
| FedProx（mu=0.1） | 1 | 2.180746406316757 | 0.27734375 |
| FedProx（mu=0.1） | 2 | 2.0500727742910385 | 0.32421875 |

完整本地证据位于platform-server/target/federated-evidence：registration.txt、dataset-manifest.json、unit-tests.txt，以及每个算法的execution.json、task-runs.json、11个模型/指标产物和numerical-audit.json。target被Git忽略，不上传数据、模型、临时凭据或构建产物。

文档最终同步后check-scaffold通过：8模块、70份生产Java索引、31个功能编号、260个本地链接；git diff --check通过。测试容器、临时随机算法镜像及测试JVM已退出/清理；旧系统容器未操作。发布仅包含本批源码、示例和文档，不上传数据集、模型或target证据目录。

## 过程中的失败与修正

- 初次定向测试在Java测试编译阶段遇到Transferable.of泛型重载歧义，拆出byte[]局部变量后编译通过；未进入测试的构建不计通过。
- 14:33:32定向结果：3项协议测试通过，2项集成错误。两个Flow实际上已SUCCESS，但测试错误地从完成后已清理的wf_worker_job查询prepared_json。改查持久res_job_reservation、真实Pod配置及独立数值审计；没有为了测试新增持久字段。
- 14:37:08定向结果：MNIST在线下载TLS EOF导致准备失败，另一个测试因前置注册未完成失败。保留失败，不更换为合成数据、不关闭TLS验证。随后通过HTTPS取得官方文件，增加target原始数据复用与官方校验；执行结果和训练不缓存。
- 本批镜像构建时pip曾重试TLS下载，最终安装成功；末尾pip自更新检查的TLS警告不作为算法验证依据。
- 14:52:18第一次完整verify失败：runtime 26项通过，server 108项中两个联邦学习测试因ImageFromDockerfile使用旧Docker构建接口、重新下载pip依赖失败而报错；其余server测试通过，Failsafe未执行。改用Docker CLI按当前源码构建，复用与文档命令一致的BuildKit依赖层；仍重新构建并执行算法，不使用旧测试结果。构建日志保存在image-build.txt，临时随机镜像在测试结束后删除。

## 范围与未验收项

只迁移FedAvg/FedProx；其它流任务、旧数据库/执行历史转换、既有Harbor发布、真实生产集群部署不在本次。当前契约仅MNIST，MLP端到端验收，CNN/模型形状仅数值单元测试；不是全量60000/10000样本精度实验，不承诺模型收敛改善或性能指标。

不实现计量SDK、吞吐计算、前端指标图或终端卸载，不声称达到2GB/s。S5-03至05及S6/S7未进入。使用与迁移差异见[S5-02规格](../features/S5-02-federated.md)、[ADR-0012](../decisions/ADR-0012-federated-migration.md)、[运行说明](../../algorithms/federated/README.md)。
