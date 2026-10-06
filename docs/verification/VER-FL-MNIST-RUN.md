# FL-MNIST-RUN：接通两种MNIST版本并运行40轮

2026-10-06；基于3888b50。用户明确选择强非IID版本，要求接通数据并让FedAvg/FedCADS各跑40轮。不扩展到全部种子或等量版实验。

## 接入与环境

原`cea/federated:fedcads-v2`实际model.py与工作区修改前文件逐行相同；本批只增加dataset_from_refs对两个MNIST训练版本名称的识别，训练/聚合/网络数值代码不改。镜像发布为registry-center:5000/lab/cea-federated@sha256:71768d8fc05aaa34c2b97f657f08d2d31b5a1384bfa3e614b3fa5bdbe01df47b，旧镜像与角色保留。

已创建8个角色的mnist-part-v1契约、4个r1 Flow：mnist-equal-fedavg/fedcads、mnist-strong-fedavg/fedcads。新训练allowed列表包含两版，各Flow固定自己的数据选项、权重默认正确；原64个Flow/角色版本不覆盖，不重启后端/前端/K3s，不变资源或权限。

本批strong完整训练60000=3000/12000/45000，独立官方测试10000；MLP784→128→10、batch128、epoch1、lr0.1、seed31；CADS alpha0.001/rho0.1，weights1:4:15规范化0.15/0.6/2.25，schedule随本次40轮，不是之前实验保持12的配置。四K3s共享Docker宿主16CPU/约15.39GiB，三客户端真实对应edge集群、云init/aggregate/evaluate。

沿用原conv02实验入口：调用原app.run但不采集内部SDK时钟报告；计实际Flow.startedAt→endedAt。每轮评估并保留全部曲线，不提前终止或以首次达标片段冒充完整Flow时间。没有自动早停、随机参与抽样、新通用工作流能力，不涉及新增Kestra语义。

## 已验证

- 初次构建被根.dockerignore排除model.py而失败，随后增加专用Dockerfile.dockerignore，构建成功；没有拿失败构建当发布。
- 新镜像19Python测试通过（2新数据引用测试＋17原算法回归）；错系列/未知版本/错误测试版本继续拒绝。
- 2Node Flow转换测试通过：两分区选项/权重、数据Binding、CADS schedule、原训练参数保持、源Flow未改。
- API验证/发布四Flow与八契约成功，原角色conv01-v1读回完全相同。

## 完成结果

强非IID种子31，两实际Flow均SUCCESS、各40轮且每轮评估10000条测试样本：

| 方法 | 完整Flow耗时 | 最高准确率 | 第40轮准确率 | 首次达到95% |
|---|---:|---:|---:|---|
| FedAvg | 846.261 s | 96.49%（32轮） | 96.30% | 21轮，432.980 s |
| FedCADS | 855.607 s | 96.19%（13轮） | 94.93% | 8轮，175.394 s |

Execution ID：FedAvg `b4568edf-ed8d-4cac-99d3-6d99e86181f5`；FedCADS `85845a46-5fa8-4d1d-8bcf-c66c4dcc571a`。

首次达标时间是Flow启动到该轮评估任务结束的事后统计，不是实际早停Flow耗时。FedAvg第22轮曾回落，此后23～40轮均达95%；FedCADS第8～36轮均达95%，37/38/40轮回落至94.97%/94.87%/94.93%。本次显示CADS早期收敛更快，不表示最终更好或40轮整体更快；不能从一组seed31宣称稳定提升，也不据此推断回落原因。

两流程按FedAvg→FedCADS顺序执行、无独立预热；首流程可能承担新镜像首次拉取，后流程可复用缓存，时间比较存在该顺序因素。CADS schedule改为40，不与之前schedule12实验作为仅数据改变的对比。

运行后独立核验通过：两初始主网络权重逐张完全相同；六个首轮客户端模型的实际样本数分别3000/12000/45000；CADS内部schedule40、规范化权重0.15/0.6/2.25；两个最终模型在原测试集复评的准确率及loss与第40轮记录一致。402个精确Job全部成功、均使用相同内容digest，仓库/角色路径随分发变化，资源声明为空。原64Flow定义、服务容器ID/镜像/启动时间及applicationConfig保持不变。

第一次独立audit因错误要求边缘镜像完整地址等于中心地址失败，改为核对所在集群仓库前缀及不可变digest后通过；未改训练产物或重跑实验。保存10个实际模型产物及脱敏Job记录，核验脚本为audit.ps1/audit.py。19Python/2Node通过；结构检查不替代Java/Maven业务测试，本批无Java修改。

原始证据：`.local/cea/mnist-partitions/flow-strong`；失败不替换，已有accepted ID不重新提交。代码/命令见[使用](../../examples/federated/mnist-partitions/README.md)，具体语义见[契约](../contracts/mnist-partition-training.md)。
