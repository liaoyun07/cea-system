# FL-EQUAL-95：等量三客户端准确率试验

将原 MNIST 全部 60000 训练样本重新按标签稳定排序，等量切成 edge-a/b/c 各 20000 条，仍是非 IID，不随机混合类别。原文件保持，新文件写到 `.local/cea/conv04/run-1/mnist-equal`。完整训练，独立官方测试 10000 条；不留验证集，不使用测试数据训练。

固定原 `cea/federated:fedcads-v2` 镜像和原数值核心、MLP784→128→10、lr0.1、batch128、epoch1、CADS alpha0.001/rho0.1/schedule12。等量后实际样本权重都是20000，CADS规范化clientWeights都是1。种子31/41/51，各算法每次40轮，保留全部曲线，包括首次达标后回落。

这只是 Docker 内缓存数据的顺序数值准确率实验，不是三 Kubernetes 集群实际并行 Flow、不统计完整流程速度或25%提升；不发布新数据集版本或改变现有 Flow 默认数据。此前95%预筛用54k/6k验证集，本次60k/10k官方测试，不能把两次准确率差直接归为等量划分的因果效应。

```powershell
docker run --rm --mount "type=bind,source=$PWD/examples/federated/equal95/probe.py,target=/app/equal95.py,readonly" --mount "type=bind,source=$PWD/.local/cea/mnist,target=/data,readonly" --mount "type=bind,source=$PWD/.local/cea,target=/evidence" cea/federated:fedcads-v2 python /app/equal95.py --source /data --output /evidence/conv04/run-2
docker run --rm --mount "type=bind,source=$PWD/examples/federated/equal95,target=/experiment,readonly" -e PYTHONPATH=/experiment:/app cea/federated:fedcads-v2 python -m unittest test_probe
```

输出目录必须不存在，拒绝覆盖。重划分断言60000原始样本ID恰好出现一次，保存回读像素/标签完全相同，独立测试保持。测试另用可核对的样本值验证等量、不重不漏、测试数据与源文件不变。结果见 [验证记录](../../../docs/verification/VER-FL-EQUAL-95.md)。
