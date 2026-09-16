# FLPAR-14：均分后三客户端数据处理速率

2026-09-16，DONE/PASS实测，2GB/s未达标。源码基线`8d0e18a`及现场既有工作；仅在已部署CEA运行现有Flow，不修改算法、计量、数据、Flow或服务配置。

## 固定负载与统计方式

- `par12-fedavg-cifar10-c3-preprocess` r2：三个客户端，edge-a/b/c各一个，Loop并发3。
- `cifar10-raw-train/v2`，样本16667/16667/16666条，总50000条；复用FLPAR-13分片，不重新分配。
- FedAvg、MLP、Repeat一轮、local_epochs=1、batch_size=1024、learning_rate=0.01、seed=13，评估10000条测试数据、batch32。
- par08算法/预处理镜像；`fl-preprocess/par13-v1`只变契约数据版本，不是新算法镜像。Worker24、每边缘6槽、cloud2，四K3s独立cgroup-root保持。
- 预热一次，之后顺序正式三次。全部执行留存；预热不计均值，失败不以补跑成功替换。
- 原SDK口径：真实业务输入＋输出文件字节之和，除以全部算法完整活动区间的并集；包含预处理、训练、聚合、评估，不计Pod启动、排队和文件助手传输。另列提交至Execution结束总耗时，不把两种时间混用。
- 每次9个算法实例（init＋三次preprocess＋三次train＋aggregate＋evaluate）。字节数逐实例对照FLPAR-13已验证报告，独立核对区间并集与峰值；计时后检查实际Job/Pod、镜像、真实train样本数及模型。

## 验证与结果

预热和三次正式全部SUCCESS，未补跑/挑选样本。预热574.53MB/s、SDK2.657514秒、总33.789秒，不计正式均值。以下MB/GB均为十进制，速率均值是三次速率的算术平均。

| 正式次序 | 数据处理速率（MB/s） | SDK活动并集（秒） | 提交到结束（秒） | train实际并行峰 |
| --- | ---: | ---: | ---: | ---: |
| 1 | 597.99 | 2.553279 | 32.609 | 3 |
| 2 | 632.03 | 2.415740 | 32.490 | 2 |
| 3 | 675.46 | 2.260406 | 32.268 | 3 |
| 平均 | 635.16 | 2.409808 | 32.456 | — |

每次实际输入903714999字节、输出623107702字节，合计1.526822701GB。包含各个真实算法阶段的文件处理量，不把50000张图片去重后的原始字节当成这个分子，不按epoch放大、不改变原计量定义。

单个train SDK区间为0.537～0.696秒，三次的训练峰为3、2、3；数据量均分不保证启动完全同时。单实例阶段SDK均值：init 0.00657秒、preprocess 0.45782秒、train 0.61902秒、aggregate 0.01810秒、evaluate 0.24221秒；这些数值存在并行重叠，不能直接相加替代区间并集。

本次635.16MB/s高于FLPAR-12历史三客户端均值540.08MB/s约17.6%，但不是同期交错A/B，存在运行时波动，不能把差值全部归因于均分或宣称稳定收益。当前均值0.635GB/s、最好0.675GB/s，仍未达到2GB/s。

- 36个实际Job/Pod与SDK报告、镜像digest、真实训练样本数16667/16667/16666核验PASS；108个算法/助手容器退出0且无重启，0启动Warning。每实例文件字节与FLPAR-13对应报告相同，后端累计字节/区间并集独立复核通过。
- 20份实际init/train/aggregate模型、80张量与FLPAR-13独立重算参考逐值一致；元数据、样本权重与完整测试集指标一致（10000条，accuracy0.2005，loss2.2323940662384034）。数值审计在计时完成后运行。
- 11项Node测试（新增1＋既有10）、PowerShell语法、结构检查与Git差异检查通过。没有Java/前端实现修改，未重跑Maven或前端构建。
- 原262条执行、31个Flow、全部数据版本、配置及19个常驻服务ID/镜像/启动时间保持。最终266条执行全终态、31个Flow；前端HTTP200、后端UP，最后一次measurement通过18080反代API可见。无需重新部署或重启服务。

正式执行ID：`1eedb631-62c2-4623-80d1-161fe681a144`、`5ce9d598-70df-49da-9d15-f2b374cf10e8`、`439bf339-3cf4-4e0e-b85c-be49db36b3e1`。预热：`a355b45d-bd98-4b6e-971e-60477b68f4fc`。

## 复测工具与证据

[测试驱动](../../examples/federated/optimization/balanced-rate.mjs)使用现有API，模式run、audit、verify；[汇总单测](../../examples/federated/optimization/balanced-rate.test.mjs)验证预热排除和失败保留。[模型审计](../../examples/federated/optimization/audit-balanced-rate.ps1)在全部计时结束后下载20个产物，与FLPAR-13独立重算通过的参考模型逐张量比较，不在性能计时过程中做额外扫描。

证据保存在`.local/cea/par14`，不提交数据、模型或凭据。测试执行会增加四条正常历史记录；不新增Flow/Application/DatasetVersion或生产Java/DB/API/SPI，不重建和重启前后端，不涉及新Kestra执行语义。
