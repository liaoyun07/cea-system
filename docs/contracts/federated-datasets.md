# 联邦图像数据集契约（FLDATA-01）

适用：同一FedAvg/FedProx执行链上的MNIST、CIFAR-10、CIFAR-100。实际发布/测试以[验证记录](../verification/VER-FLDATA-01-cifar.md)为准。

## 选择与执行

Flow保留两个显式SELECT：`training_dataset`与`test_dataset`。选项分别为`mnist/cifar10/cifar100`加`-train/v1`、`-test/v1`；默认仍为MNIST。没有新增第三个数据系列开关，也没有隐式派生Flow Input。

- init：普通STRING参数`TRAINING_DATASET`和`TEST_DATASET`引用上述输入。算法校验同系列、受支持版本，确定模型形状；不声明DatasetRule、不下载/统计任何数据文件。不匹配在init失败，后续train不运行。删除新契约里的旧`DATASET_NAME`，旧镜像/契约仍保留作为历史，不在新代码中兼容旧环境变量。
- train：`DATASET`沿现有DatasetRule检查格式/允许版本，并经Placement选择有相应Location的集群。文件助手准备`/cea-work/in/dataset-DATASET`，注入`DATASET_PATH`。
- evaluate：`TEST_DATASET`声明DatasetRule，选cloud Location，助手注入`TEST_DATASET_PATH`。此参数在init是普通引用，在evaluate是实际文件依赖，角色契约明确不同。
- aggregate：仍按客户端samples加权，不读取数据集、不改变Loop/Repeat状态或Binding。

`dataset_from_refs`是算法镜像内受支持数据文件协议的校验函数，不是平台通用表达式或映射服务。若未来增加新版本，需同步算法支持与角色契约，不能只登记一个新名称。

## 数据实物

| 系列 | 输入形状 | 分类数 | 训练分片a/b/c | 独立测试 |
|---|---|---|---|---|
| MNIST | 1×28×28 | 10 | 10000 / 20000 / 30000 | 10000 |
| CIFAR-10 | 3×32×32 | 10 | 8333 / 16667 / 25000 | 10000 |
| CIFAR-100 | 3×32×32 | 100个fine类 | 8333 / 16667 / 25000 | 10000 |

以上是默认全量；小样本仅用于明确标注的测试。种子13选择训练索引，按标签稳定排序，再按1:2:3切成不重叠分片；不把测试样本混入训练。沿既有pt文件结构：dataset、split、indices、x、y。x为float32；y为long；CIFAR归一化固定为[-1,1]，MNIST原归一化不变。当前训练一次性载入本客户端分片，再按batch遍历内存；没有流式数据加载/数据增强/跨轮持久缓存。

官方来源：[CIFAR作者页面](https://www.cs.toronto.edu/~kriz/cifar.html)，Alex Krizhevsky, *Learning Multiple Layers of Features from Tiny Images* (2009)。CIFAR-10 binary MD5为`c32a1d4ab5d03f1284b67883e8d87530`，CIFAR-100 binary为`03b5dce01913d631647c71ecec9e9cb8`。checksum只服务真实下载/缓存内容完整性检查，不新增领域hash。按预期成员读取tar，不使用pickle或任意路径解压。

CEA原始数据沿现有中心MinIO的`datasets/{dataset}/v1/{edge-a,edge-b,edge-c,test}.pt`保存；Location的clusterId表示使用分片的逻辑位置，不代表数据已物理落在边缘。任务产物仍写本执行位置存储，算法文件助手和计量SDK不变。数据不加入镜像/Git。

## 变更边界

新增四条DatasetVersion记录及八条Location；五个角色新增不可变ApplicationVersion；两个Flow新增修订。无新Java文件、数据库表/列/API/SPI，数据接入本身不要求重建或重启前后端程序。此次现场另因Docker重启导致存储IP过期，刷新原配置并只重启backend，见验证记录。沿既有契约/文件/执行链，没有新增联邦专用调度器。对Kestra参考仅沿用项目既有显式Flow定义与任务参数边界，不扩展通用工作流语义。
