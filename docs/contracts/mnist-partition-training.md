# MNIST分区版本训练接入（FL-MNIST-RUN）

不新增Java/API/表字段，沿用DatasetVersion、ApplicationVersion和Flow revision。`model.dataset_from_refs`仅增加两个实际消费者需要的MNIST训练引用：`mnist-train/equal-noniid-v1`、`mnist-train/strong-noniid-v1`，均必须配`mnist-test/v1`。原MNIST/CIFAR10/CIFAR100的v1支持不变，未知训练版本/测试版本或跨系列组合继续拒绝。

沿原FedCADS-v2不可变数值镜像，仅覆盖model.py中的引用识别；发布新digest，不覆写旧应用镜像引用。八新角色契约版本`mnist-part-v1`复用原参数结构，train.DATASET.allowed增加两版。init.TRAINING_DATASET仍是普通引用、只判断模型维度，不下载数据；train.DatasetRule真实准备新训练分片，evaluate仍用官方测试v1。

四新Flow固定各自分区：`mnist-{equal,strong}-{fedavg,fedcads}`；training_dataset的SELECT只含该Flow对应版本，clients默认a/b/c权重分别1:1:1或1:4:15。用户仍能显式修改clients输入，但本次实验使用原默认，手动自定义权重属于新的算法配置。FedAvg按真实训练产物samples加权，不以clients.weight代替样本数；FedCADS规范化weights用于本地正则，strong为0.15/0.6/2.25。

默认rounds40，FedCADS init.ROUNDS引用同一rounds输入，内部蒸馏schedule与Repeat预算一致。原conv02 Flow仍使用旧schedule12，未覆盖。复用既有固定Namespace实验入口，不输出内部计时报告，整体耗时以Execution.startedAt/endedAt计；不存在新增自动早停、伪造SDK报告或调度接口。

新版本/流程的完整定义在[示例目录](../../examples/federated/mnist-partitions/README.md)，测试/执行结果在[验证记录](../verification/VER-FL-MNIST-RUN.md)。
