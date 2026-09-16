# FLPAR-22：固定总负载，六客户端对照三个大客户端

基于已部署的FLPAR-21线性分类器；不改算法镜像、SDK、线程、batch1024、epoch1或现有业务Flow。A为六客户端，每边缘两个；B为三个客户端，每边缘一个，将同一边缘原先两份负载拼成一份真实文件。累计处理均100000样本、唯一均50000样本；每个原始样本使用两次，不是新增独立数据，也不通过epoch或计数字段放大字节。

B三分片33334/33334/33332条。客户端数据量和SGD更新序列变化，不能要求A/B模型相同；分别用原SGD、普通DataLoader独立重训核对。两者完整评估10000条。模型/文件头数量不同，按真实SDK文件字节重算，不强行令分子相等。

## 复测工具

依赖CEA私有配置、已有`par21-candidate` Flow、`.local/cea/par13/raw`原均分uint8分片、CIFAR10测试集，以及本地`cea/federated:par07-v1`独立参考镜像。证据仅写入忽略目录`.local/cea/par22`，既有证据拒绝覆盖；再次实验须明确新编号，不能清空旧结果。

1. `node --test examples/federated/coarse-benchmark/run.test.mjs`。参考镜像中运行`test_prepare.py`。
2. `node examples/federated/coarse-benchmark/run.mjs capture`，冻结原对象、应用和服务状态。
3. 在参考镜像运行`prepare.py prepare`：挂原par13目录到`/reference:ro`、新par22目录到`/audit`。生成真实双份张量及数据清单。
4. `./examples/federated/coarse-benchmark/storage.ps1 upload`，仅写新对象路径，并下载回读副本。运行同一`prepare.py readback`，逐值验证每个样本/标签/原始索引均出现两次，无遗漏或额外唯一数据。
5. `node examples/federated/coarse-benchmark/run.mjs register`：新增数据集版本`cifar10-raw-train/par22-double`、同镜像新契约`fl-preprocess/par22-v1`及`par22-baseline/candidate`两份Flow。不重启服务。
6. `run.mjs run`：各一次预热，正式AB/BA/AB，共八个执行上限。失败留档、停下读日志；环境可用后`review-failure`再续剩余计划，不替换失败。请求先保存幂等键，超时续查同一执行，不盲目新增。
7. 全部计时结束后`run.mjs audit`、`storage.ps1 models`；在par07参考镜像运行`verify_models.py`，挂par22到`/audit`、par13到`/reference:ro`、CIFAR10测试文件到`/test.pt:ro`。逐值核对每个成功执行的初始、客户端、聚合模型及完整评估。
8. `run.mjs verify`：检查18080实际计量API、后端健康和所有原对象/19个常驻服务未改。

本轮首批结束后发现旧观察器只退出本地Docker客户端，远端watch仍运行。首批不作干净性能结论，所有数据保留。公共`thread-benchmark/observe.mjs`现记录远端PID和启动tick，退出前按这两个身份核对并发送TERM，等待真正结束；不按进程名批量杀任务。`verify-observer.mjs`在真实四集群连续三轮启停，检查观察器退出后Docker exec零残留。修复仅属于测试工具，不改变执行服务。

独立干净批次：PowerShell设置`$env:FLPAR22_CLEAN='1'`后执行`run.mjs capture`、`run.mjs run`、`run.mjs audit`；复用已部署两Flow，不再register或上传。证据写`par22-clean`，仍严格八次上限，每次前后检查零遗留观察器。`storage.ps1 models -Clean`下载新批次模型，`verify_models.py`改挂par22-clean到`/audit`，最后同一环境变量下`run.mjs verify`。初批结果、失败和干净批次分别报告，不拼接成功率或挑选最好样本。

实际结果见[验证记录](../../../docs/verification/VER-FLPAR-22-coarse.md)。不增加Java、表、API、Runner或调度状态；仍沿原执行链。本次是应用负载实验，不改变Kestra通用概念。
