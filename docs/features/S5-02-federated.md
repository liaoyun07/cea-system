# S5-02 FedAvg / FedProx迁移

本批仅这两个算法，其他旧流任务暂不迁移；不进入网关/终端卸载/计量批次。执行主链没有变化，也没有新增生产Java、表、迁移、API或SPI。

## 行为与范围

两个独立Flow数据文件：初始化 → 三个显式客户端并行 → 样本数加权聚合 → 全局测试集评估；训练、聚合和评估均处于Repeat内，下一轮训练读取上一轮聚合模型。不是将FedProx别名标记在FedAvg运行上：FedProx客户端优化交叉熵加mu/2乘参数偏离本轮初始全局模型的平方和。

应用目录保留五个角色契约，共用一个可复现构建的CPU镜像，使用CLI子命令执行不同阶段；共享依赖和数学代码，不在Java中识别算法名或预置Flow。保存后的Flow是数据库数据，可以按既有修订API编辑、读取、执行。YAML只是首次导入源，启动后端不自动加载它们。

第一批可运行数据集契约只登记MNIST，允许MLP/CNN；原通用模型实现保留MNIST/CIFAR10的形状能力，但本批没有CIFAR10数据准备与端到端验收。不迁移吞吐优化模型、预处理、分层聚合/FedAdam或其它演示任务。

## 迁移差异

| 旧实现 | 新实现及原因 |
|---|---|
| 镜像直接调用MinIO、隐式INPUT_PATH/FLOW_* | 后端传入命名文件和契约参数；镜像只处理本地文件，无存储凭据 |
| 浮点权重转JSON并四舍五入 | PyTorch state_dict文件，保留张量精度；不兼容旧权重JSON，需重新初始化 |
| 聚合扫描目录/COMPOSITE清单 | Flow显式绑定三个client文件、CLI显式传入；不扫描目录或猜测上游 |
| FLOW_ROUND/客户端编号依赖控制层注入 | 模型携带实际轮号，训练输出baseRound/round；CLIENT_ID由Flow显式指定 |
| 全局测试集地址硬编码镜像内 | TEST_DATASET契约声明允许版本，resource目录定位，注入TEST_DATASET_PATH本地文件 |
| 旧遥测SDK/速率 | 不迁移；S5-05计量口径仍待确认，当前只有真实评估JSON产物 |

四个集群名cloud/edge-a/b/c是示例Flow的显式部署选择，可由作者编辑。训练数据是同一MNIST训练版本在三个站点的分片；全局测试版本只在cloud登记。数据本地性检查沿用S4；当前S4通过后端存储/文件API转运，不代表新增了边缘直读或传输优化。

## 验收要求

- 真正MNIST训练样本768条（128/256/384不重叠分片）和独立测试样本256条，来源及分片方法留档；不是随机张量冒充MNIST。
- 每个Flow两轮、每轮3个训练Job+1个聚合Job+1个评估Job，加初始化共11个真实Job。
- 检查每个客户端实际取数位置、三客户端TaskRun重叠、第二轮在第一轮评估完成后开始。
- 导出真实模型，按上一轮全局模型重算训练结果；逐张量校验样本数加权聚合；读取聚合模型在同一测试集重算loss/accuracy。
- FedProx mu=0与FedAvg一致，mu>0实际影响权重；拒绝重复客户端、混轮/混算法及无效数据，不以正常退出码代替数值检查。
- 完整verify回归S1–S5-01，结果在verification记录，不预先标完成。

测试只使用一个隔离K3s承载四个资源目录位置，不声称完成真实跨地域多云或大规模精度/吞吐验收。评估samples是核验用JSON字段，没有新增界面或测试样本数曲线。

## 文件与入口

- [算法与使用说明](../../algorithms/federated/README.md)
- [FedAvg Flow](../../examples/federated/fedavg.yaml) / [FedProx Flow](../../examples/federated/fedprox.yaml)
- [数据目录](../../examples/federated/datasets.json) / [首次注册脚本](../../scripts/register-federated.ps1)
- [迁移决策](../decisions/ADR-0012-federated-migration.md)

当前实际状态见[进度](../04-progress.md)。

本批实际测试结果、失败修正和数值证据见[VER-S5-002](../verification/VER-S5-002-federated.md)。
