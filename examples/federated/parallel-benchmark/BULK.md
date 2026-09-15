# FLPAR-04 整批取样对照

已完成真实CEA：2次预热＋6次正式均成功，正式原/候选均值358.2/362.6MB/s，但平均算法时间均5.638秒，未测出稳定提升或达到2GB/s。实际输出模型逐值一致，原业务Flow与容量配置保持，候选仅留隔离实验。[完整结果](../../../docs/verification/VER-FLPAR-04-bulk.md)。

固定FedAvg/CIFAR10/MLP、9客户端、单轮/epoch1、训练batch1024、评估batch32、学习率0.01、seed13。原三分片各完整处理三次：累计150000条，独立样本仍50000条。沿原SDK统计完整读入/校验/训练/写出区间，不新增公开指标，不改变算法质量或计量分子来提高速率。

原PyTorch2.2.2的DataLoader逐个调用TensorDataset取样，再拼成batch。实验用同一个DataLoader/RandomSampler，通过`__getitems__`一次接收该batch的索引，用`index_select`取出整批张量；保留原随机数消费、尾批和优化器更新次数。不是增加DataLoader进程，也不是换成更简单的模型。

## 文件与边界

- `bulk_loader.py`：实验数据集整批读取和已经成批的数据直通函数；只有shuffle=True的训练使用，评估不变。
- `bulk_app.py`：隔离入口，仅替换原model模块的DataLoader工厂；原app/model/SDK代码继续执行。
- `Dockerfile.bulk`及对应dockerignore：从本机已验证的`cea/federated:cf01-v1`构建，只加入上述两个文件。
- `test_bulk.py`：批次、RNG、FedAvg/FedProx及三数据集两模型的权重逐值一致性检查。
- `profile_bulk.py`：本地阶段诊断；不复制到CEA实验镜像，也不用于正式速率测量。
- `run.mjs --bulk`/`summary.mjs --bulk`/`audit.ps1 -Bulk`：复用现有提交、报告复算和数值审计；原FedAvg/FedProx不修改。

没有新增Java、DB、API、Binding或执行链，也没有修改Kestra式工作流语义。实验应用`fedavg-train/par04-bulk-v1`及两个`par04-fedavg-cifar10-c9-*`流程是测试消费者，不默认替换生产版本。

## 执行顺序

1. 用原cf01-v1镜像挂载本目录运行`test_bulk.py`；再对已保存的init模型和原三个完整数据分片运行`profile_bulk.py`。后者输出保存到忽略目录`.local/cea/par04/profile.json`。挂载路径为`/benchmark`、`/datasets`、`/audit/init.pt`，PYTHONPATH包含`/app:/benchmark`。
2. 构建`cea/federated:par04-bulk-v1`，在此镜像上运行原`test_federated`回归。沿现有CEA image-tool发布至`lab/federated-bulk:par04-bulk-v1`；将Registry实际解析的digest地址保存到`.local/cea/par04/image.json`，格式为`{"image":"registry-center:5000/lab/federated-bulk@sha256:..."}`。不要把Docker构建的index digest当作发布转换后的manifest digest。
3. 运行以下命令。register只执行一次，拒绝覆盖已有before快照；复测应先明确新批次/命名，不覆盖原证据。

```powershell
node --test examples/federated/parallel-benchmark/run.test.mjs
node examples/federated/parallel-benchmark/run.mjs --register --bulk
# 分页确认无活动执行并备份配置，临时Worker14、每边缘槽4、cloud2。
# 只重启backend，确认/health为UP后开始。
node examples/federated/parallel-benchmark/run.mjs --run --bulk
node examples/federated/parallel-benchmark/summary.mjs --bulk
# 全部计时结束后才重算，避免与实验争用CPU/内存。
./examples/federated/parallel-benchmark/audit.ps1 -Bulk
# 确认空闲、恢复Worker4/边缘槽1及原配置，重启backend并检查健康。
node examples/federated/parallel-benchmark/run.mjs --preserved --bulk
```

两方式先各预热一次（r0），正式三轮顺序AB、BA、AB。保留预热和全部正式尝试，summary只统计r1–r3；失败停止检查，不补成功样本替换失败。三次均值不等于统计显著性，首次拉取和本地诊断不作为收益结论。Windows绑定目录上的串行诊断不能直接代表Pod内并发阶段占比。

原始证据留`.local/cea/par04/`，不上传数据/模型/凭据。真实结果、精度、限制及恢复证据见[验证记录](../../../docs/verification/VER-FLPAR-04-bulk.md)。
