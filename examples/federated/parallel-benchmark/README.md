# FLPAR-01 并行客户端对照

只做现有执行链的真实对照，不修改算法、SDK、Java、数据库结构或原FedAvg/FedProx。结果见[验证记录](../../../docs/verification/VER-FLPAR-01-parallel-clients.md)。

## 固定条件与变量

- 当前CEA四个K3s仍共享同一台Docker Desktop：16CPU/约15.39GiB，边缘K3s服务容器配置仍为3CPU/2GiB。这是服务容器配置，不据此断言其所有算法Pod都受同一个父cgroup配额约束。测试不扩容硬件或集群。
- 两算法分别使用完整CIFAR-10/CIFAR-100：50000训练、10000测试，MLP、2轮、epoch1、batch32、learning_rate0.01；FedProx mu0.1。镜像仍cf01-v1。
- 三客户端基线：原edge-a/b/c分片8333/16667/25000，各一个客户端。
- 六客户端：每个原分片再切为两份（4166/4167、8333/8334、12500/12500）；每集群仍处理原来的样本，数据并集不变且不重复。张量切片必须clone，避免pt文件把未消费的原始底层storage也保存进去。
- 对照3客户端/并行3与6客户端/并行6，每组合3次交错顺序；另测FedAvg/CIFAR10的6客户端/并行3，区分并行度与分片/算法客户端数变化。
- 增加客户端会增加模型输入输出与聚合开销，不能声称总业务文件字节完全一致。六客户端的模型也不要求与三客户端训练结果相同；改变分区会改变局部SGD轨迹。额外对照的6客户端/并行3与6客户端/并行6才保持相同客户端划分。
- 六客户端均按a1/a2/b1/b2/c1/c2排列；并行3的额外对照前一批是a1/a2/b1，并非每边缘一个。它隔离了客户端划分但不是最优均衡调度基线，不为改善结果而在重复测试之间改变顺序。
- 比较原`/measurement`数据处理速率；另读取SDK小报告独立合并纳秒区间、核对实际训练峰值/平均重叠。配置并发不等于算法实际重叠，不能拿TaskRun含启动/传输的持续时间替代。

## 工具职责

- `prepare.py`：从已验证的本地全量三分片生成六份独立pt，逐张量比对与索引并集检查；不写原数据、不重复下载。
- `upload.ps1`：只上传`datasets/par01/`新文件，逐文件核对长度。凭据读取现有私有配置，不进入Flow或Git。
- `run.mjs --register`：保存原定义/服务快照，登记四个新分片DatasetVersion、两个训练契约par01-v1（镜像不变）、九个独立par01 Flow；原业务Flow不变。
- `run.mjs --run`：逐个运行27次固定条件测试，保存全部Execution/TaskRun/报告/测量结果；已有accepted记录复用相同执行ID。失败保留并计入失败率，不补成功样本替换；超时或测量不一致停止，不自动删除/取消记录，不把失败当零速率。
- `summary.mjs`：要求27次均有记录，输出成功/失败数、成功样本三次（不足三次时明确数量）的速率算术平均/范围，以及实际并行程度。不是仅挑最快一次，也不是失败耗时被计入的系统吞吐量。
- `audit.ps1`：仅在计时全部结束后执行。对五种六客户端配置的第一次执行核对17个Job、输出存储、模型与评估独立数值重算，避免审计CPU工作污染计时试验。
- `run.mjs --preserved`：核对原业务Flow、数据目录、策略和服务身份/资源限制；只有backend允许启动时间改变。

本工具面向这次已有CEA环境，不是无配置通用基准平台。新增数据引用仍是普通DatasetRule和ITEM Binding；没有新增分片API、Runner、客户端调度器或幂等模型。复用项目既有[Loop语义](../../../docs/contracts/s5-loop.md)。

## 运行与恢复

在backend目录，先确保原始`.local/cea/{cifar10,cifar100}`全量数据及`cea/federated:cf01-v1`已存在。需`frontend/node_modules`中的现有yaml依赖。数据及证据统一位于`.local/cea/par01`，首次登记/数据准备拒绝覆盖既有本批基线；已有测试可直接续跑`--run`。

```powershell
node --test examples/federated/parallel-benchmark/run.test.mjs
$taskData=(Resolve-Path .local/cea).Path
$taskScripts=(Resolve-Path examples/federated/parallel-benchmark).Path
docker run --rm --memory 2g --mount "type=bind,source=$taskData,target=/data" --mount "type=bind,source=$taskScripts,target=/benchmark,readonly" cea/federated:cf01-v1 python /benchmark/prepare.py --root /data
./examples/federated/parallel-benchmark/upload.ps1
node examples/federated/parallel-benchmark/run.mjs --register
```

确认没有其它活动Execution；暂将`deploy/cea/application.yaml`的`platform.worker.concurrency`从4改8，`platform.jobs.slots.lab`的edge-a/b/c分别从1改2，cloud仍2。仅重启backend并确认18085 `/health`为UP。不调整Docker资源限制，也不重启K3s/MinIO/Registry。

```powershell
node examples/federated/parallel-benchmark/run.mjs --run
node examples/federated/parallel-benchmark/summary.mjs
./examples/federated/parallel-benchmark/audit.ps1
```

结束后确认本批无活动执行，恢复Worker4、边缘槽各1并仅重启backend；执行`--preserved`及健康检查。保留测试Flow/版本、数据、执行历史与失败证据；本批测试Flow若以后重新执行，需要重新确认并行槽配置，不能把恢复后的运行当作同条件复测。前后端生产源码没有变化，不需重建镜像。
