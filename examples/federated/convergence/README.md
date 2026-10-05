# FedAvg / FedCADS 达到90%准确率的对照

FL-CONV-01：同一MNIST非IID三个客户端和MLP主模型，同一镜像/资源，固定batch128、epoch1、lr0.1；CADS alpha0.001/rho0.1。达到同一官方测试准确率所需的实际流程时间，不是GB/s。

先运行验证集筛选，再固定配置，最后五种子配对。筛选仅使用训练分片各10%的留出集，官方test.pt不用于调参；正式恢复原完整训练集、使用独立测试集10000。种子31/41/51/61/71，两个算法先后次序交替。最多12轮，每轮都有真实客户端Job/聚合/评估。

从Execution.createdAt到首次accuracy≥90%的evaluate.endedAt，计入调度、读取、通信、训练、聚合和评估。额外保存每轮曲线、是否持续达标、全部失败；不挑最快时间、补成功替换失败或用轮数充当总耗时。效率提高=Avg平均达标时间/CADS平均达标时间−1，耗时降低另报。五对每对≥25%且CADS首次达标后始终≥90%才称本机有限样本稳定；不代表所有设备/负载或论文复现。

```powershell
# 数值预筛；官方测试数据不加载。输出只放.local，不要覆盖原screen-1。
docker run --rm --mount "type=bind,source=$PWD/examples/federated/convergence/probe.py,target=/app/probe.py,readonly" --mount "type=bind,source=$PWD/.local/cea/mnist,target=/data,readonly" --mount "type=bind,source=$PWD/.local/cea,target=/evidence" cea/federated:fedcads-v2 python /app/probe.py --data /data --output /evidence/conv01/screen-2
# register仅用于本批首次发布，已存在Flow会拒绝覆盖。
node examples/federated/convergence/run.mjs register
node --test examples/federated/convergence/run.test.mjs
node examples/federated/convergence/run.mjs run
# 出现失败后先检查；此模式只继续尚未尝试的预定样本，失败不会替换。
node examples/federated/convergence/run.mjs continue-planned
# 故障暂停时只读汇总已完成样本和未尝试项，不启动执行。
node examples/federated/convergence/run.mjs report
# 暂停或全部终结后回读已执行初始模型和脱敏Job规格，独立核对。
./examples/federated/convergence/audit.ps1
```

`observe.mjs` 是本批遇到失败后使用的只读Pod日志跟随器；日志保留在.local，不改业务或资源配置，结果必须注明诊断观察器带来的干扰可能。历史已清理失败Pod不保证能补回日志。

两新流程为conv01-fedavg-mnist和conv01-fedcads-mnist，八个conv01-v1契约使用原fedcads-v2镜像；原流程/数据/版本保持、无需服务重启。FedCADS有额外辅助头和教师运算，只要求主分类网络相同并核对相同初始权重，不能声称完整训练结构完全相同。

[实验定义](../../../docs/features/FL-CONV-01-time-to-accuracy.md)、[实际进度与结果](../../../docs/verification/VER-FL-CONV-01.md)。
