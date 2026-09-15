# FLPAR-03 单轮训练 batch 对照

已在CEA完成：12/12成功，四档平均376.6/454.3/484.3/444.1MB/s；1024较32提高28.6%，但accuracy降至21.24%。144份SDK及四档模型审计通过、配置已恢复，未达2GB/s。[完整结果](../../../docs/verification/VER-FLPAR-03-batch.md)。

用户要求增大batch并只跑一轮。本批固定FedAvg、CIFAR-10、MLP、9客户端/并发9、1轮、epoch1、学习率0.01、seed13；训练batch分别32/256/1024/16384，每档3次，顺序轮换。评估batch固定32，保持训练外开销一致。每轮150000条累计训练样本来自原50000条唯一数据的三次实际处理，不新增数据文件或改变计量口径。

大batch会减少每轮SGD更新次数；报告同时保留测试集accuracy/loss，不能把相同epoch当作相同优化次数或相同训练质量。仍完整读取数据、执行所有batch、输出模型并真实加权聚合/评估。不是颜色均值模型，不加入预处理，不调整算法计时边界。

复用FLPAR-02的公共实验工具，仅新增`--batch`分支；实际消费`rounds/batchSize`配置的是提交API、实例数量校验、数值审计和汇总，不新增生产字段/表/接口/执行链。沿既有显式Binding/Application，不实现新的Kestra通用能力。

CEA同一16逻辑CPU/约15.39GiB宿主、算法cf01-v1不变；确认无活动执行后保存配置，暂用与FLPAR-02相同Worker14/每边缘槽4/cloud2，仅重启backend。完成或故障处理后在空闲时恢复Worker4/边缘槽1，不重启其它常驻服务。保留所有尝试，失败先停查，不补成功样本替代失败；不清缓存，不声称冷数据结果。

```powershell
node --test examples/federated/parallel-benchmark/run.test.mjs
node examples/federated/parallel-benchmark/run.mjs --register --batch
# 确认空闲后临时配置上述容量，仅重启backend并等待健康。
node examples/federated/parallel-benchmark/run.mjs --run --batch
node examples/federated/parallel-benchmark/summary.mjs --batch
# 全部计时后才独立重算每档第一次成功执行，避免污染计时。
./examples/federated/parallel-benchmark/audit.ps1 -Batch
# 恢复配置、确认健康。
node examples/federated/parallel-benchmark/run.mjs --preserved --batch
```

本地证据位于`.local/cea/par03/`；四个独立`par03-fedavg-cifar10-c9-b*`测试Flow保留在CEA，原FedAvg/FedProx修订不修改。实验结果见[验证记录](../../../docs/verification/VER-FLPAR-03-batch.md)。
