# FL-HSAM-40：六组强非 IID 对比验证

状态：IN_PROGRESS（2026-10-07）。用户指定 FedAvg、FedCADS、HSAM；MNIST/CIFAR-10 既有强非 IID，40 rounds、1 local epoch。未结束前不填最终性能结论。

实验范围/运行方式见 [README](../../examples/federated/three-way-strong/README.md)。新增六个 compare40-* 流程及一个 HSAM 实验文件入口；不覆盖旧 Flow/Application、不修改生产 SDK、不重启服务。

已通过：Node 定义测试 6/6；六份 CEA 定义校验与修订发布。首组 MNIST FedAvg executionId：a6a60e83-a8c7-4ef9-8437-d03230946552。逐轮准确率/真实累计耗时和后续执行 ID 保存于 `.local/cea/three-way-strong-40/`；失败保留并停止后续实验。

完成后核验：每组 SUCCESS，评估轮数 1–40 完整、每轮 samples=10000；比较最终/最好准确率、完整耗时、首次 90%/95% 的真实累计耗时；核验旧流程未修改。单随机种子仅做探索，不能证明稳定提升。此次不修改 Java/前端，也不以定义测试代替真实训练验收。
