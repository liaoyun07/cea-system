# S5-02 FedAvg / FedProx迁移

FLPAR-24（2026-09-18）：新增隔离计时入口和par24-compute-window，普通完整加载后计预处理/模型构建与装载/训练/聚合/评估，写出前结束；保留原完整SDK并额外发布compute-profile.json，不计报告字节。三客户端累计10万、一次预热＋三次正式全成功；同次完整/计算均速0.516/1.262GB/s，仍未2GB/s。数值核心复用原镜像，20模型40张量与原SGD全量参考逐位一致；无正式SDK、API、DB或运行链变化。[边界与证据](../verification/VER-FLPAR-24-compute-window.md)。

FLPAR-22（2026-09-16）：隔离负载包装实验将六份客户端工作合成每边缘一份真实双份数据，累计10万/唯一5万不变；只新增数据版本、同预处理镜像的契约及两实验Flow，原算法/业务/SDK不变。客户端SGD轨迹不同，分别独立核验，不宣称等价模型。修正测试观察器残留后，干净八次全成功，52模型104张量一致，完整10000条评估accuracy26.94%/29.25%；正式均速1289.25/1298.95MB/s（+0.75%，无明显提速），端到端46.90/35.96秒。没有生产新类/表/API/调度器，当前新增的是可复测实验与观察器退出修复，非2GB/s或时钟修复。[验证](../verification/VER-FLPAR-22-coarse.md)。

FLPAR-21（2026-09-16）：新增隔离线性FedAvg实验，真实线性分类器3072→10（30730参数），沿原SGD/聚合/SDK，通过mmap和DataLoader整批取样执行，完整评估batch1024。原业务的MLP/CNN/FedProx定义不变；新模型是显式Application版本/Flow输入选项，不是新DSL或执行链。八次全成功，独立原SGD重训/64模型192张量通过；正式均速860.84MB/s、accuracy0.2694，只适用于此次单轮CIFAR10负载，不宣称2GB/s或原MLP等价加速。[验证](../verification/VER-FLPAR-21-linear.md)。

FLPAR-16（已部署）：aggregate用model_state_shapes直接检查权重名称、Tensor形状及客户端间dtype一致，保留算法/模型/数据集/轮次/样本数/重复客户端检查；不再为每个输入和结果调用checked_model分配模型、初始化和复制权重。训练/评估仍正常构建加载模型，聚合算式/顺序、SDK及文件读写不变。显式shape表通过MNIST/CIFAR10/CIFAR100 × MLP/CNN实际模型元数据测试防止漂移；不扫描权重数值。18项Python、48组数值对照及实际FedAvg/FedProx两轮独立数值复核通过；仅聚合镜像/应用版本更新，旧版本保留。[验收](../verification/VER-FLPAR-16-aggregate-reuse.md)。

FLPAR-14（2026-09-16）：对已均分的三集群/三客户端Flow r2实测，配置不改；正式3/3成功，均值635.16MB/s，SDK2.410秒、总32.456秒，train峰3/2/3。36 Job/SDK与20模型80张量相同，完整评估一致；只新增正常执行历史，不扩展算法/SDK/调度或新生产能力，不重启服务。仍未2GB/s；与历史不均分结果非同期交错A/B。[验证](../verification/VER-FLPAR-14-balanced-rate.md)。

FLPAR-13（2026-09-16）：当前CIFAR-10预处理数据新增均分版本raw v2，edge-a/b/c分别16667/16667/16666条；只移动原分片边界，保留样本内容/原标签排序。par08/par10/par12五个预处理Flow r2只更新数据引用与同镜像契约，不改客户端、并发、算法/SDK。原三客户端完整执行、三份存储回读与5模型20张量/10000条测试评估通过；原主FedAvg/FedProx、CIFAR-100/MNIST与旧数据/Flow修订保持。未重做固定总量分档实验，未宣称稳定性能改善。[验证](../verification/VER-FLPAR-13-balanced-shards.md)。

FLPAR-12（2026-09-16）：新增三个隔离par12预处理实验Flow，分别只取原Loop前1/2/3个客户端（edge-a/b/c），沿用原数据分片，累计8333/25000/50000条；非固定总量重新分片，原FedAvg/FedProx及所有既有Flow不变。每档正式3/3成功，494.85/546.14/540.08MB/s，三档实际训练峰1、1～2、2；不能由配置并发推定三个训练区间完全重叠。84 Job/SDK及48模型192张量/聚合评估核验通过；算法、SDK、DatasetRule、文件助手、执行链和容量不变，未实现常驻任务或通过2GB/s。见[验证](../verification/VER-FLPAR-12-low-clients.md)。

FLPAR-04（2026-09-15，整批取样实验）：保持DataLoader采样器和RNG，仅通过TensorDataset整批接口替代逐样本取出/拼接；原app/model/SDK不变，候选只用于独立训练版本和Flow。FedAvg/FedProx×三数据集×两模型局部更新逐值相等，CEA FedAvg/CIFAR10实际模型也逐值相等。正式均值358.2→362.6MB/s但活动时间均5.638秒、第三组倒退，未证明稳定收益，不推广原业务Flow。未新增生产能力/通用语义，临时配置恢复。[范围与复测](../../examples/federated/parallel-benchmark/BULK.md)、[完整证据](../verification/VER-FLPAR-04-bulk.md)。

FLPAR-03（2026-09-15，单轮batch实验）：固定9客户端重复CIFAR10原分片、MLP、epoch1/1轮，评估batch32，只改变训练batch；32/256/1024/16384均值376.6/454.3/484.3/444.1MB/s，12次全成功、四档模型审计PASS。每轮完整样本处理不变但SGD更新次数减少，accuracy分别31.59%/25.35%/21.24%/10.59%；性能提高不等于训练质量保持。不改算法/SDK/业务Flow，4个隔离Flow可在CEA查看，容量恢复。[复测](../../examples/federated/parallel-benchmark/BATCH.md)、[结果](../verification/VER-FLPAR-03-batch.md)。

FLPAR-02（2026-09-15，重复负载验证）：普通Loop支持同集群多个唯一客户端ID读取同一完整原分片，不需要新DatasetVersion或第二套执行链。按用户要求测试FedAvg/CIFAR10的3/6/9/12客户端，累计工作量增加但唯一样本不变；均值216.5/257.8/315.5/291.0MB/s，12次中11成功。四档训练/聚合/评估审计PASS，默认业务Flow与容量配置保持；不把该实验称为更大的独立数据集或已达2GB/s。[复测](../../examples/federated/parallel-benchmark/REPEATED-LOAD.md)、[全部结果与限制](../verification/VER-FLPAR-02-repeated-load.md)。

FLPAR-01（2026-09-15，验证增量）：沿已有Loop/DatasetRule按ITEM为六个客户端选择不重叠分片，同一边缘可并行两个train，无新增算法或调度模型。四组3→6并行平均速率提高12.3%–45.9%，五组数值复核通过；27次中26成功、不是稳定性或2GB/s验收。原两个Flow及原运行容量保持，独立测试对象留存；[定义与复测](../../examples/federated/parallel-benchmark/README.md)、[全部结果/失败/边界](../verification/VER-FLPAR-01-parallel-clients.md)。

FLDATA-01（2026-09-15）：新增CIFAR-10/CIFAR-100数据准备及10/100类模型，训练/测试SELECT与init显式引用同步更新，复用现有文件助手和计量SDK。准确语义见[数据协议](../contracts/federated-datasets.md)，实际结果见[验证](../verification/VER-FLDATA-01-cifar.md)。以下初次迁移范围保留其历史含义，不代表当前只有MNIST。

本批仅这两个算法，其他旧流任务暂不迁移；不进入网关/终端卸载/计量批次。初次迁移S5-02没有新增Java/表/API；后续S5-02b通过通用Loop替代重复train定义，变更见[Loop协议](../contracts/s5-loop.md)，仍无第二套执行链。

## 行为与范围

两个独立Flow数据文件：初始化 → 动态客户端集合并行 → 样本数加权聚合 → 全局测试集评估；训练、聚合和评估均处于Repeat内，下一轮训练读取上一轮聚合模型。不是将FedProx别名标记在FedAvg运行上：FedProx客户端优化交叉熵加mu/2乘参数偏离本轮初始全局模型的平方和。

应用目录保留五个角色契约，共用一个可复现构建的CPU镜像，使用CLI子命令执行不同阶段；共享依赖和数学代码，不在Java中识别算法名或预置Flow。保存后的Flow是数据库数据，可以按既有修订API编辑、读取、执行。YAML只是首次导入源，启动后端不自动加载它们。

第一批可运行数据集契约只登记MNIST，允许MLP/CNN；原通用模型实现保留MNIST/CIFAR10的形状能力，但本批没有CIFAR10数据准备与端到端验收。不迁移吞吐优化模型、预处理、分层聚合/FedAdam或其它演示任务。

## 迁移差异

| 旧实现 | 新实现及原因 |
|---|---|
| 镜像直接调用MinIO、隐式INPUT_PATH/FLOW_* | 后端传入命名文件和契约参数；镜像只处理本地文件，无存储凭据 |
| 浮点权重转JSON并四舍五入 | PyTorch state_dict文件，保留张量精度；不兼容旧权重JSON，需重新初始化 |
| 聚合扫描目录/COMPOSITE清单 | Flow绑定Loop.models数组，平台生成本地文件清单、CLI显式读取；不扫描目录或猜测上游 |
| FLOW_ROUND/客户端编号依赖控制层注入 | 模型携带实际轮号，训练输出baseRound/round；CLIENT_ID由Flow显式指定 |
| 全局测试集地址硬编码镜像内 | TEST_DATASET契约声明允许版本，resource目录定位，注入TEST_DATASET_PATH本地文件 |
| 旧遥测SDK/速率 | 不迁移；S5-05计量口径仍待确认，当前只有真实评估JSON产物 |

cloud是示例的固定聚合/评估位置；客户端从Loop.values的固定集合元素id/clusters读取，默认edge-a/b/c，可在Loop面板更换列表并保存新修订，不复制Task，也不声明inputs.clients。训练数据是同一MNIST训练版本在三个站点的分片；全局测试版本只在cloud登记。数据本地性检查沿用S4；当前S4通过后端存储/文件API转运，不代表新增了边缘直读或传输优化。

## 验收要求

- 真正MNIST训练样本768条（128/256/384不重叠分片）和独立测试样本256条，来源及分片方法留档；不是随机张量冒充MNIST。
- S5-02原验收每个Flow3客户端共11个Job；S5-02b保留两轮真实数值验收，FedAvg使用3客户端共11个Job，FedProx使用2客户端共9个Job，以验证集合数量确实决定展开实例数。
- 检查每个客户端实际取数位置、所选客户端TaskRun重叠、第二轮在第一轮评估完成后开始。
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
