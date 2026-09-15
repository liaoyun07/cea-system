# FLPAR-02 重复数据扩量测试

已在CEA完成，12次中11成功，四档第一次成功执行数值审计PASS。平均216.5/257.8/315.5/291.0MB/s；12客户端有一次失败，不补替代样本。原配置及原业务对象保持，详见[全部结果与失败边界](../../../docs/verification/VER-FLPAR-02-repeated-load.md)。

用户明确允许重复数据，本批将每个原边缘分片交给多个独立客户端完整读取并训练。不是FLPAR-01的固定总量切分，也不是扩大独立数据集；唯一训练样本一直为50000。只测试FedAvg/CIFAR10，沿用当前cf01-v1、MLP、2轮、epoch1、batch32、学习率0.01、seed13。每档3次，共12次；不同档轮换顺序，不补成功样本替代失败。

| 客户端 / 并发 | 每边缘客户端 | 每轮累计训练样本（含重复） | 唯一样本 |
|---|---|---|---|
| 3 | 1 | 50000 | 50000 |
| 6 | 2 | 100000 | 50000 |
| 9 | 3 | 150000 | 50000 |
| 12 | 4 | 200000 | 50000 |

同一边缘每个客户端读取同一个完整原数据版本对应文件，分别执行真实的读取、训练、模型输出；不创建复制文件、不修改DatasetRule或SDK、不乘计数系数、不增加epoch。SDK原协议允许跨真实调用重复处理再次累计文件字节，但同一调用内不会因epoch重复计数。报告显式区分唯一数据与含重复的累计处理量，不能把本结果称为独立大数据集、唯一数据摄入速率或物理网络带宽。

16CPU/约15.39GiB单宿主不扩容，暂调Worker14、每边缘槽4、cloud仍2，让四档共用同样资源上限；仅在无活动执行时重启backend。失败时工具保存失败记录并停止，先检查节点/内存/任务再决定是否继续原定剩余次数，不替换失败。数据集在OS/存储缓存中可命中，不清现有缓存，不声称冷数据测试。所有结果保持原计量：实际业务文件输入输出之和÷完整算法活动区间并集，另核对实际重叠与完整业务结果。

```powershell
node --test examples/federated/parallel-benchmark/run.test.mjs
node examples/federated/parallel-benchmark/run.mjs --register --replicated
# 确认空闲、保存配置、暂调Worker14/边缘槽4并仅重启backend，健康UP后再运行。
node examples/federated/parallel-benchmark/run.mjs --run --replicated
node examples/federated/parallel-benchmark/summary.mjs --replicated
# 全部计时结束后才做数值审计，避免审计CPU工作污染计时。
./examples/federated/parallel-benchmark/audit.ps1 -Replicated
# 空闲时恢复Worker4/边缘槽1，仅重启backend后核对。
node examples/federated/parallel-benchmark/run.mjs --preserved --replicated
```

证据保存在`.local/cea/par02/`。只新增4个独立`par02-*` Flow，不新增数据集/契约版本；生产算法、Java、前端、数据库结构和Execution主链不变。数值审计重算每边缘完整分片，检查每个重复客户端的输出及累计样本、独立加权聚合和评估。不能套用要求“所有客户端索引互不重复”的FLPAR-01审计，也不能直接删掉其检查来混淆实验。
