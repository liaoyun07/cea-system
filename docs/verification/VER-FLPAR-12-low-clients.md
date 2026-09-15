# FLPAR-12：减少到1、2、3个客户端

2026-09-16，实测DONE/PASS，数据处理速率2GB/s未达标。基线源码`e787e37`加现场既有FLPAR-05～10工作；本批不改这些算法或历史工作，仅新增实验工具和本文结果。

## 范围与固定条件

仅按用户要求运行真实CEA低客户端负载对照。以`par10-fedavg-cifar10-c18-preprocess` r1为来源，新建`par12-fedavg-cifar10-c1-preprocess`、`c2`、`c3`三个独立Flow。只有Loop成员和并发上限改变；原FedAvg/FedProx、所有旧Flow修订与历史不变。

FedAvg、CIFAR10、MLP、Repeat一轮、epoch1、batch1024、learning_rate0.01、seed13；完整10000条测试集、评估batch32。保持par08算法镜像、预处理与原SDK。原18客户端不是本批同期对照，历史环境中的外部Pod/log观察也未在本批开启，不能据此报告严格配对的18→低客户端加速比。

| 客户端 | 集群 | 原始训练分片条数 | 累计训练样本 |
| --- | --- | --- | --- |
| 1 | edge-a | 8333 | 8333 |
| 2 | edge-a、edge-b | 8333、16667 | 25000 |
| 3 | edge-a、edge-b、edge-c | 8333、16667、25000 | 50000 |

本批不重复分片，不生成新数据；减少客户端同时减少训练样本总量。不是固定50000条重新均分，也不能把模型精度变化当作纯调度效应。每个客户端仍先预处理再训练，聚合采用真实样本量加权。

原Worker24、每边缘6槽、cloud2，四K3s独立cgroup-root及Job文件准备修复保持。算法仍逐任务启动，不实现常驻aggregate/evaluate，不改变计量边界，不设置人为同步屏障。

## 测试与复核

- 每档预热1次；正式按1/2/3、2/3/1、3/1/2交错顺序各3次，共12次。失败保留并停止检查，不用新成功样本替代。
- 保存Execution、TaskRun、SDK报告及评估输出，独立核对字节数、纳秒时间并集和实际训练并行度。
- 计时后核对84个Job/Pod及镜像digest、输入输出长度、容器退出/重启和启动Warning。容器时间仅秒级，不用于替代SDK时间。
- 计时完成后下载48份模型；逐张量对照FLPAR-08已验证的独立par07参考模型，重算本批1/2/3客户端加权聚合与10000条评估。数值核验不与计时运行并行。
- 原249执行、28Flow、数据集及19服务快照保留；最终通过18080反代API确认新Flow可见。没有前后端生产代码/DB变更，因此不做无意义的镜像构建或服务重启。

## 实际结果

12/12执行成功（3次预热＋9次正式），没有失败替换、未追加挑选样本。下表仅统计每档3次正式运行，速率是各次速率算术平均；GB、MB均为十进制。

| 客户端 | 总耗时均值 | SDK并集均值 | 每次输入 / 输出字节 | 速率均值 / 范围（MB/s） | 三次实际训练峰 |
| --- | --- | --- | --- | --- | --- |
| 1 | 30.924s | 0.736769s | 256047719 / 107272383 | 494.85 / 455.66～523.86 | 1、1、1 |
| 2 | 32.449s | 1.521608s | 515750543 / 313925402 | 546.14 / 527.19～577.36 | 1、2、1 |
| 3 | 34.539s | 2.828458s | 903714871 / 623107702 | 540.08 / 523.34～550.58 | 2、2、2 |

输入输出合计分别0.363320102、0.829675945、1.526822573GB。字节包括真实预处理、训练、聚合、评估的业务输入输出，不是原始唯一样本文件总大小；每次仍完整评估10000条。预热速率分别509.36、531.78、532.94MB/s，不混入上表。

| 客户端 | init均值 | 客户端Loop均值 | aggregate均值 | evaluate均值 | 单train SDK均值 |
| --- | --- | --- | --- | --- | --- |
| 1 | 5.815s | 12.579s | 6.212s | 6.115s | 0.278s |
| 2 | 6.104s | 14.465s | 5.861s | 5.941s | 0.418s |
| 3 | 6.260s | 16.107s | 5.848s | 6.126s | 0.581s |

上表阶段为TaskRun墙钟耗时，另有约0.2s提交启动；Loop包含各客户端准备与收尾，不能与子任务耗时相加。3客户端的算法开始仍相差1.259～2.370秒，单train区间0.313～0.909秒，实际峰始终2而非3。固定启动/收尾开销仍使单客户端流程约31秒，不能把31秒当成SDK计量分母。

2、3客户端速率相近，差异小于各自样本波动，不能宣布2客户端为最优配置。与历史18客户端均值566.49MB/s相比也没有测出明显的低客户端速率优势；历史非本批同期配对，不能推断精确性能收益。减少数据量能缩短活动区间，但分子也同步减少，不改变M01未达标状态。

84个实际Job/Pod及SDK、镜像digest/训练参数/分片文件长度与报告输入输出核验PASS；252个容器退出0、restartCount=0，0启动Warning。48份init/train/aggregate模型共192张量与独立par07参考及本批样本加权聚合逐值一致；12次完整10000测试样本评估重算通过。三档accuracy分别14.21%、18.02%、21.24%，与其训练数据量及参与分片变化相关，不是纯调度对照。

9项Node测试（新增3＋既有6）通过；首次新增驱动测试暴露缺省description/labels的差异证明问题，修正驱动后通过，未影响生产算法。PowerShell语法、结构检查及Git差异检查通过。未修改Java或前端，因此未重跑Maven/前端构建，不将既往264项Java结果记为本批结果。

最终261条执行全终态、31个Flow；旧249执行/28Flow/数据集和全部19个常驻服务身份/镜像/启动时间/资源配置保持。原24/6/2容量、部署配置保持；3个新Flow通过18080反代API可读，前端HTTP200、后端健康UP。本批只在现有CEA执行实验，不需重建或重启前后端。

正式Execution：

- 1客户端：`28595fa5-bebd-4512-b9c8-c7434ee917dd`、`e0d4c81c-d38e-45da-b319-119fd5b509c3`、`afd911e9-a1ef-4ca0-a48c-562f3848bf81`。
- 2客户端：`68e41cf0-f8ff-46db-a7b4-9ecb7bf6df88`、`d08f346e-1b08-4f66-bd14-8ef6a43242f9`、`6c27d244-ce1f-4398-a768-3b8e56720cb7`。
- 3客户端：`bcd189d3-5841-4c77-955c-e4dec45e1cfa`、`cec858fc-0a60-44f2-a79c-515f608d10d3`、`77e81125-d656-4583-8500-2a06764d3acd`。

## 复测与证据

工具：[low-clients.mjs](../../examples/federated/optimization/low-clients.mjs)、[测试](../../examples/federated/optimization/low-clients.test.mjs)、[数值复核](../../examples/federated/optimization/verify_low_clients.py)。证据保存在忽略目录`.local/cea/par12/`，不提交凭据、数据、模型或运行缓存。

```powershell
node --test examples/federated/optimization/low-clients.test.mjs
node examples/federated/optimization/low-clients.mjs capture
node examples/federated/optimization/low-clients.mjs register
node examples/federated/optimization/low-clients.mjs run
node examples/federated/optimization/low-clients.mjs summary
node examples/federated/optimization/low-clients.mjs audit
./examples/federated/optimization/audit-low-clients.ps1
node examples/federated/optimization/low-clients.mjs verify
```

首次capture拒绝覆盖基线；`run`断线后可使用同一accepted执行继续收集。已完成批次不能通过删除证据复测，需另建明确批次。本批不修改Execution/Worker/Runner/Binding主链，无新增Java类、表、字段、SPI，不涉及新的Kestra执行语义。
