# ADR-0012 FedAvg/FedProx是应用与Flow数据，不是执行器特例

2026-09-10，ACCEPTED；本批用户只授权迁移FedAvg和FedProx。基线b59a17a。

参考旧工程fedavg-dataflow-images中的common/fedavg_torch.py、init/app.py、client-train/app.py、fedprox-client-train/app.py、aggregate/app.py、evaluate/app.py：保留SGD、MLP/CNN、按客户端样本数加权、FedProx近端项与独立全局评估，不迁移存储/遥测兼容层或吞吐特化任务。

已阅读本地Kestra提交0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4的core/src/main/java/io/kestra/core/models/tasks/InputFilesInterface.java和OutputFilesInterface.java。遵循运行上下文准备输入文件、任务产出本地文件后由平台存储的边界。当前已有S4显式文件路径及S5 Repeat足够，不新增Runner/SPI/Binding来源；不照搬Kestra的glob、nsfile/file协议或更多表达式能力，这是当前阶段有意简化。

算法原理参考[原始FedAvg论文](https://proceedings.mlr.press/v54/mcmahan17a.html)及[FedProx作者实现](https://github.com/litian96/FedProx)。这不是论文实验完整复现，不承诺FedProx在所有参数下更优。

算法逻辑位于algorithms/federated的Python镜像；五个应用角色复用一个构建产物。Flow、应用契约、DatasetVersion在运行前经既有API登记为数据库数据，不加入启动seed或Java模板常量。注册脚本不自动发起训练。

无需生产Java/表/列/API变更。新增checkpoint中的algorithm/dataset/model/state/round由训练/模型恢复/聚合/评估读取；客户端的baseRound/clientId/samples参与轮次与重复客户端校验及加权计算。没有hash、无消费者元数据或第二套执行状态。执行的真实TaskRun/Attempt仍归runtime，模型round是算法数据不是调度状态。

本批只迁移MNIST契约与两轮可验证闭环；旧权重JSON和旧Flow不自动兼容/转换。S7历史数据切换、S5-03/04/05及其它流任务不在本次范围。

数据下载实测遇到TLS中断，因此验收在target中复用官方MNIST压缩文件；seed按官方MD5拒绝错误下载/缓存。这是明确的内容完整性判断，无数据库hash列、不参与Flow版本或任务幂等、不缓存算法输出。
