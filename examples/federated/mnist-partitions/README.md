# FL-MNIST-PART：两种非IID训练数据版本

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

边界：这次只准备、上传、登记数据。现有init镜像识别与train DatasetRule允许值仍仅旧v1，原Flow SELECT亦未添加这两版本，因此不能直接在旧联邦Flow中选择新版本执行。后续接入需要同步init版本识别、训练契约和Flow选项；本批不偷偷改镜像、契约、流程或训练。见[验证](../../../docs/verification/VER-FL-MNIST-PART.md)。
