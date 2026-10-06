# FL-HSAM-40：六组强非 IID 对比验证

状态：DONE（2026-10-07）。用户指定的六组实验全部 SUCCESS，各 40 rounds、1 完整 local epoch；模型 MNIST=MLP / CIFAR-10=CNN。训练与评估正常结束不代表算法收敛良好，尤其 CIFAR-10 HSAM 在本配置下严重不稳定。

实验范围/运行方式见 [README](../../examples/federated/three-way-strong/README.md)。新增六个 compare40-* 流程及一个 HSAM 实验文件入口；不覆盖旧 Flow/Application、不修改生产 SDK、不重启服务。

源码定义版本：98f4c62；Node 定义测试 6/6、六份 CEA 定义校验/修订发布通过。证据位于 `.local/cea/three-way-strong-40/`：六份方法结果 JSON、summary.json、audit.json、实际使用的 YAML 与接受的执行 ID。新增审计脚本见 [audit.mjs](../../examples/federated/three-way-strong/audit.mjs)。

## 六组结果

耗时为 Execution.startedAt → endedAt，包含文件准备、调度、训练、聚合和评估。运行顺序为表格顺序；所有方法共用既有强非 IID 分片、batch128/lr0.1/seed31，每轮三个真实客户端全参与。MNIST 训练量 3000/12000/45000，CIFAR-10 2500/10000/37500，官方测试各10000。不同算法保留自身聚合规则和训练机制。

| 数据集 | 方法 | 第40轮准确率 | 最高准确率（轮） | 完整耗时 |
|---|---|---:|---:|---:|
| MNIST | FedAvg | 96.30% | 96.49%（32） | 819.879s / 13.66min |
| MNIST | FedCADS | 94.93% | 96.19%（13） | 864.600s / 14.41min |
| MNIST | GFed-HSAM | 96.99% | 97.16%（31、34） | 919.573s / 15.33min |
| CIFAR-10 | FedAvg | 59.90% | 59.90%（40） | 1496.702s / 24.95min |
| CIFAR-10 | FedCADS | 52.90% | 57.86%（20） | 1726.944s / 28.78min |
| CIFAR-10 | GFed-HSAM | 10.18% | 50.73%（10） | 2868.254s / 47.80min |

总运行跨度约 2h26min（北京时间 2026-10-07 03:01:25 → 05:27:03）。未重跑、替换失败/差结果，未在本批改变学习率或算法实现。

## 相同准确率的累计耗时

时间终点为首次满足阈值那一轮的 evaluate TaskRun.endedAt，起点仍为 Execution.startedAt，不是单轮训练时间，不是假设提前终止的新执行耗时。

| MNIST 方法 | 首次≥90%（轮 / 累计秒） | 首次≥95%（轮 / 累计秒） |
|---|---:|---:|
| FedAvg | 7 / 147.965 | 21 / 432.508 |
| FedCADS | 4 / 90.725 | 8 / 177.017 |
| GFed-HSAM | 4 / 94.669 | 4 / 94.669 |

相对 FedAvg 首次95%：FedCADS累计耗时降低59.07%、达到阈值的速度提高144.33%；GFed-HSAM累计耗时降低78.11%、速度提高356.86%。公式分别为 `1−T_method/T_avg` 和 `T_avg/T_method−1`，两个百分比不可混用。三种方法的 CIFAR-10 在40轮内都未达90%/95%，没有这两个阈值的速率提升结果。

## 解释与限制

MNIST 的 HSAM 首次95%更早、40轮最终准确率略高，但40轮完整耗时也更多；其测试 loss 从第4轮0.1823上升到第40轮3.9700，不能仅凭准确率说优化稳定。FedCADS 达标后回落，第40轮低于95%。CIFAR-10 HSAM 波动严重，第40轮loss=20261.7497、准确率接近随机猜测；这次统一学习率0.1及默认HSAM参数没有体现优势，不能把MNIST优势外推到CIFAR-10，也不能用最高点代替最终模型。

本批仅seed31，不是重复实验或稳定性证明，也不是作者原始模型/超参数的精确复现。没有调参、早停、模型选择或重跑筛选；后续优化需另行授权。这里只报告已有实现和固定配置的实际表现，不把劣化原因未经核实归结为硬件或某个具体公式。

## 执行 ID 与验收

| 数据集 / 方法 | executionId |
|---|---|
| MNIST / FedAvg | a6a60e83-a8c7-4ef9-8437-d03230946552 |
| MNIST / FedCADS | 1c71fd9c-79cb-4469-bf68-7c213efe248d |
| MNIST / GFed-HSAM | 2389f5f4-4fbb-4674-b95d-57c52c607500 |
| CIFAR-10 / FedAvg | e7b5df80-ee6d-437e-862b-70e144f3c648 |
| CIFAR-10 / FedCADS | a67f486e-2539-4aa3-b936-56452c5d356d |
| CIFAR-10 / GFed-HSAM | 429827e6-f3a3-404f-ae92-bc0aa368352b |

实际审计通过：六组实际API执行SUCCESS；每组1 init/120 train/40 aggregate/40 evaluate均SUCCESS，共1206个Application TaskRun；240份官方评估逐一与API输出核对，round1–40完整，samples=10000，准确率/loss与结果文件一致且有限；真实起止时间一致；原75个流程保持不变。此次无Java/前端/接口/表/工作流运行时修改，不重启服务、不运行与纯实验无关的完整Maven验证。

结果归档时重跑定义测试6/6通过；结构检查通过（8模块、109 Java索引、32既有feature IDs、1288本地链接）。结构检查只验证文档/架构结构，不替代上述实际训练审计。
