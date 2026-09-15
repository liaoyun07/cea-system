# FLPAR-13：均分现有三个边缘集群的数据分片

2026-09-16，DONE/PASS，已在CEA生效。源码基线`2b05074`及既有未提交工作；本批仅新增离线分片/发布/验证工具和文档，不修改生产算法。

## 用户范围与结果

用户明确要求的是三个集群的分片均匀，不是把总量按1、2、3客户端分别重新分配。因此撤销此前误解的固定总量三档实验计划；本次只重新划分当前测试使用的CIFAR-10原始训练分片。

| 集群 | 原分片样本 | 新分片样本 | 新raw文件字节 | 实际预处理产物字节 |
| --- | ---: | ---: | ---: | ---: |
| edge-a | 8333 | 16667 | 51469325 | 205072475 |
| edge-b | 16667 | 16667 | 51469325 | 205072475 |
| edge-c | 25000 | 16666 | 51466253 | 205060187 |

总量50000条，最大差1条，无重叠或遗漏。仅移动分片边界；原像素、标签、源索引及原有按标签排列的顺序均保留，不额外改为IID、不混入测试集。分片保存前clone，避免PyTorch把全量底层storage写进每份文件。

这是数据准备时的离线核验，不向算法SDK区间增加像素扫描。CIFAR-100、MNIST及原始非预处理数据目录未修改。

## 发布对象与调用链

- 新增不可变`cifar10-raw-train/v2`，三个Location指向`s3://datasets/par13/raw/edge-{a,b,c}.pt`。旧`v1`与其原文件原样保留。
- 新增`fl-preprocess/par13-v1`契约，RAW_DATASET仅允许上述v2。复用原par08预处理镜像digest `sha256:64a28956ff712b1f8e7b340f1d0d013fdbe4578ba31146cf5c0ab9aa0bd5b4dc`，没有重新构建算法镜像。
- 下列五个当前预处理测试Flow均新增r2，仅更新`raw_training_dataset`默认值/选项以及preprocess契约版本：`par08-fedavg-cifar10-c9-preprocess`、`par10-fedavg-cifar10-c18-preprocess`、`par12-fedavg-cifar10-c1-preprocess`、`par12-fedavg-cifar10-c2-preprocess`、`par12-fedavg-cifar10-c3-preprocess`。
- Flow ID、Loop成员、候选集群、并发、Repeat、batch、epoch、模型和SDK均保持。原r1及执行快照不变。原FedAvg/FedProx主流程不改，未新建Flow或新一轮性能对比实验。

原始分片的物理存储继续使用原中心`datasets`桶，Location按edge-a/b/c选择对应文件；原文件助手送往边缘Pod，preprocess在边缘产生prepared.pt并按既有本云存储/交接链供train使用。这次不改变存储拓扑或权限。准备时曾误用边缘`datasets`桶，首次上传被拒绝（桶不存在，没有上传对象）；核对配置后改用原有中心数据桶，最终上传/回读均成功，未创建新桶。

init中的`training_dataset=cifar10-train/v1`仍是现有模型系列选择，不是preprocess实际读取的文件版本；实际数据依赖由`RAW_DATASET=cifar10-raw-train/v2`的DatasetRule与Location决定，train读取prepared_data。没有借此次分片调整重构init接口。

新数据版本供全部三个集群使用；1客户端Flow仍只用edge-a的16667条，2客户端仍用a+b的33334条，3客户端用完整50000条。9/18客户端依旧按原方式重复各集群分片，不改变工作负载定义。本次未运行这些档位的新性能对比。

无新Java类、DB表/列、API、SPI、执行状态或调度器；沿既有Application/DatasetRule/Binding/Placement/Worker/文件助手主链，不涉及新增Kestra控制流语义。只是数据与配置发布，不重建/重启前后端。

## 实际验证

- 3项Python分片单测：商余数均分、样本内容/顺序不变且storage独立、重复源索引拒绝。
- 10项Node测试：新增1项只改数据引用/契约版本，回归既有9项Flow/区间工具测试。两份PowerShell语法检查通过。
- 新旧完整50000条图像/标签/索引逐值核对；新文件上传后重新下载，三份存储回读与生成文件完全一致。原数据只读，不覆盖。
- 仅运行一次原三客户端Flow r2的发布验证：`c296bdce-4b4f-4309-9377-114bdb5b6e71`，SUCCESS。9个Job/SDK完整；3个train日志实际样本数16667、16667、16666，preprocess真实版本v2、报告文件长度正确。
- 下载5份真实模型，用此前验证的par07镜像独立重算init、三个客户端训练、加权聚合，20个张量逐值相同。完整10000条测试集评估复核通过（accuracy 0.2005，loss 2.2323940662384034）。复核在执行结束后离线完成。
- 原261条Execution、旧数据/应用版本与全部非目标Flow保持；最终262条执行全终态，仍31个Flow。19个常驻服务的容器ID、镜像、启动时间不变；Worker24/edge槽6/cloud槽2及配置文件不变。五个r2通过18080反代API可见，前端HTTP200、后端UP。
- 结构检查及Git差异检查通过；没有Java/前端生产变更，未重跑Maven或前端构建。

这一次发布验证总耗时32.964秒，SDK活动并集2.223750749秒，输入903714999字节、输出623107702字节，数据处理速率686.60MB/s。只是一条冒烟观测，不是重复性能对比，不能宣称稳定提速或2GB/s达标。输入字节相对旧三客户端多128字节来自PT序列化长度变化，不是增加样本或调整计量。

## 工具与复核入口

- [分片及单测](../../examples/federated/optimization/balance_shards.py)、[单测文件](../../examples/federated/optimization/test_balance_shards.py)。输入`.local/cea/par05/raw`，输出`.local/cea/par13/raw`；只接受原三个CIFAR-10分片，拒绝覆盖输出。
- [发布/冒烟/验证](../../examples/federated/optimization/balanced-shards.mjs)、[Flow边界测试](../../examples/federated/optimization/balanced-shards.test.mjs)。依次capture、离线生成、上传与data audit、publish、smoke、models audit、verify；快照、接受的Execution ID和证据保存在`.local/cea/par13`，不覆盖历史或以重跑成功替换失败。
- [上传](../../examples/federated/optimization/upload-balanced-shards.ps1)、[回读/模型核验入口](../../examples/federated/optimization/audit-balanced-shards.ps1)、[核验实现](../../examples/federated/optimization/verify_balanced_shards.py)。使用原storage-tool与par07参考镜像，无新常驻服务。

本地`.local/cea/par13`证据、数据及模型均不进入Git；失败的第一次存储上传已如实记录，后续数据、执行、模型和服务核验通过。旧FLPAR-05～10未提交修改继续保留，不纳入本批。
