# 三算法强非 IID 对比（FL-HSAM-40）

MNIST（MLP）、CIFAR-10（CNN）均使用既有 strong-noniid-v1：训练集分别 60,000（3,000/12,000/45,000）和 50,000（2,500/10,000/37,500）；官方测试集各 10,000。FedAvg、FedCADS、GFed-HSAM 每组 40 轮，每轮所有三个实际边缘客户端完整训练 1 epoch；batch 128、学习率 0.1、seed 31。FedCADS 增加其算法自身辅助蒸馏分支；HSAM 使用既有核心默认参数。保持各算法自身聚合规则，不把 HSAM 强行改成样本加权。

六组顺序执行，避免实验互相抢资源；新增独立 compare40-* Flow，不覆盖旧流程/执行。统一使用不采集文件读写时间的实验入口，原训练代码不变，以 Execution.startedAt → endedAt 为完整耗时（包括调度、文件准备、训练、聚合、评估）。记录逐轮准确率、最终/最高准确率、首次 90%/95% 的轮数和完整累计耗时；单 seed 探索结果不能证明稳定提升。

运行 `node examples/federated/three-way-strong/run.mjs prepare`，然后 `... run`；`... report` 只读取当前记录。证据写入 `.local/cea/three-way-strong-40/`。接受的 executionId 和提交幂等键持久保存，恢复时继续等待原执行；失败保留并停止，不重跑筛选好结果。未完成组不可记为完成。
