# FL-MNIST-PART：两种非IID训练数据版本

## 已接通的训练流程（FL-MNIST-RUN）

新 `mnist-part-v1` 镜像识别两版训练引用，新增八个同名角色的 `mnist-part-v1` 契约。新流程默认40轮：`mnist-equal-fedavg`、`mnist-equal-fedcads`、`mnist-strong-fedavg`、`mnist-strong-fedcads`。各流程固定一种数据选项，客户端权重默认分别1:1:1或1:4:15，避免切数据但忘记切权重。原业务/实验流程及旧契约不覆盖。

参数保持MLP、batch128、epoch1、lr0.1、seed31，CADS alpha0.001/rho0.1，内部schedule跟随实际rounds（本次40，不沿用旧实验的12）。沿用conv02固定Namespace脚本revision1调用原app.run、不采集内部SDK时钟报告；只看真实Flow startedAt→endedAt和每轮官方测试评估。没有自动早停或平台新语义。

```powershell
docker build -f examples/federated/mnist-partitions/Dockerfile -t cea/federated:mnist-part-v1 .
node --test examples/federated/mnist-partitions/flows.test.mjs
# register需要已上传的新镜像不可变registry digest；首次建立八契约/四Flow，拒绝覆盖。
node examples/federated/mnist-partitions/run.mjs register registry-center:5000/lab/cea-federated@sha256:71768d8fc05aaa34c2b97f657f08d2d31b5a1384bfa3e614b3fa5bdbe01df47b
# 一次种子31配对，每方法40轮；按顺序运行避免互相争抢同一宿主。
node examples/federated/mnist-partitions/run.mjs run
# 仅在用户指定等量版实验时使用。
node examples/federated/mnist-partitions/run.mjs run --equal
```

运行证据保存`.local/cea/mnist-partitions/flow-{strong,equal}`；失败保留，已有accepted ID只跟踪、不重新提交，不用测试集选最优种子。两算法同主初权重，FedCADS另有辅助头/教师开销；不称完整网络架构一样。结果见[40轮实际记录](../../../docs/verification/VER-FL-MNIST-RUN.md)。

## 前批数据准备（保留历史）

本次强非IID seed31两Flow各40轮已SUCCESS：FedAvg最终96.30%、最高96.49%，FedCADS最终94.93%、最高96.19%；首次95%分别21/8轮，后者后期回落。独立audit复评实际最终模型并核对402个Job/首轮样本数/主初权重。单组实验且顺序运行、不预热，不宣称稳定提升。可在完整运行后执行 `./examples/federated/mnist-partitions/audit.ps1` 复核。

同一个 `mnist-train` 下新增两个命名版本，共用原 `mnist-test/v1` 的10000条独立测试。每版均含全部60000条训练数据，互不重复、不遗漏，不改归一化、像素、标签或模型。

| 版本 | edge-a | edge-b | edge-c | 分布 |
|---|---:|---:|---:|---|
| equal-noniid-v1 | 20000 | 20000 | 20000 | 与等量95%实验完全相同，类别集中，非IID |
| strong-noniid-v1 | 3000 | 12000 | 45000 | 数量1:4:15，类别集中，非IID |

强非IID版按标签稳定排序：a只有数字0；b是剩余0、全部1、部分2；c是剩余2和全部3～9。这里“强”具体指数量失衡叠加类别偏斜，不宣称在所有非IID度量上都比等量版更强。

```powershell
docker run --rm --mount "type=bind,source=$PWD/examples/federated/mnist-partitions/prepare.py,target=/app/prepare_partitions.py,readonly" --mount "type=bind,source=$PWD/.local/cea/mnist,target=/data,readonly" --mount "type=bind,source=$PWD/.local/cea,target=/evidence" cea/federated:fedcads-v2 python /app/prepare_partitions.py --source /data --output /evidence/mnist-partitions
docker run --rm --mount "type=bind,source=$PWD/examples/federated/mnist-partitions,target=/experiment,readonly" -e PYTHONPATH=/experiment cea/federated:fedcads-v2 python -m unittest test_prepare
./examples/federated/mnist-partitions/register.ps1
```

仅首次注册，不覆盖存在的目录或版本。新对象在中心MinIO `datasets/mnist/{version}/edge-{a,b,c}.pt`；Location分别为三个边缘集群，物理存储沿用原中心桶/文件助手，不声称已物理落边缘。生成文件、类别计数manifest与发布读回文件只在.local，不提交数据。

前批仅准备、上传、登记数据，当时尚未接入训练。现在上节新增独立版本/流程接通，但原旧联邦Flow仍保留历史版本和选项。见[前批验证](../../../docs/verification/VER-FL-MNIST-PART.md)。
