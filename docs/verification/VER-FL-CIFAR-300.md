# FL-CIFAR-300

2026-10-06，基于0107287。模型及epoch按用户要求对齐作者LeNet/Fusion（已直接读取作者utils_models.py），强非IID两方法各300轮。具体未改变参数、数据、计时和资源边界见[使用](../../examples/federated/cifar300/README.md)。当前实现/测试中，尚未完成300轮，不宣称90%或速率提升。

旧40轮控制程序42664/12708经CommandLine核实后停止，避免其续发强非IID旧试验；已对旧等量CADS d1e43a3d-745b-4e4e-b43f-21dcf3fb456f调用取消API。旧等量Avg已结束，数据和所有执行/产物保留，没有删除。停止旧试验是新请求替换配置的正常步骤，非停止集群服务。

## 接入验证

19Python通过（2新LeNet/Fusion测试＋17原算法回归）：作者forward计算路径及张量形状、主初权重一致、5epoch训练、两聚合与评估；这是小样本数值测试，不是全数据300轮实验通过。

新镜像实际registry digest为sha256:6a09342fd8b7b26459f68e479edecd958b9102afe30f429a9794774fbe589683。继承原cifar-part-v1，新增lenet.py、model.py入口/形状及构建时模型dispatch补丁；保留镜像原CADS数值核心，未纳入工作区其它算法修改。原8个cifar-part-v1契约读回一致，两新cifar300-strong-fedavg/fedcads r1 API验证发布，旧Flow不覆盖。

FedAvg首次Execution为46eb7315-448b-4877-9ed6-c142a0a09343：init成功，但Repeat进入训练前因`integer 1..100 required` FAILED，不是数值训练失败。证据保留到.local/cea/cifar300-failed-repeat100。最小调整FlowExecutor Repeat校验到1..300，新增300入循环/取消测试，非法边界改301。

JDK21完整scripts/verify.ps1于18:54通过（18分08秒），包括DurableWorkflow102条与真实MySQL/Registry/Kubernetes及打包JAR测试；2条生成Flow配置测试通过。仅重建CEA backend，20个服务前后核对只有backend容器改变，其余19个未重启；/health为200，原镜像保留cea/backend:before-cifar300。无新增Java类、API、数据库表或权限；主调用链保持不变，仅现有Repeat接受300次。

新FedAvg Execution fe02f72a-6571-456c-b8f6-31f6c9030520于18:55启动，init成功，Repeat进入第1轮，三个真实train TaskRun均RUNNING。控制程序顺序执行FedAvg300轮再提交FedCADS300轮，当前FedCADS尚未启动；没有把两者说成已完成。每轮官方10000条测试、首次90%时间与完整Flow时间由run.mjs保存至.local/cea/cifar300；最终准确率/耗时仍待实验。

参考本地Kestra0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4的core/src/main/java/io/kestra/plugin/core/flow/LoopUntil.java：maxIterations为正整数、可配置。本平台仍有限固定次数/状态反馈的有意简化，只扩大当前300轮所需边界，不引入条件循环或新通用能力。前文“不涉及引擎”计划因实测硬上限修正，无新类/表/权限/SDK。
