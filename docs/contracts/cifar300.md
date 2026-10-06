# FL-CIFAR-300模型与执行契约

新八角色版本cifar300-v1使用同一不可变镜像；MODEL允许lenet。lenet仅适用cifar10，FedAvg构造普通LeNet，FedCADS构造FusionLeNet；data引用仍cifar10-train/strong-noniid-v1与cifar10-test/v1，不增加数据版本。文件接口model.pt/metrics.json及global_model反馈不变。

普通state键conv1/conv2/fc1/fc2/fc3；Fusion state为base前缀的主网络及fuse_conv参数，融合与主网络共享fc3。model_state_shapes在FedAvg聚合验证实际参数形状。CADS原教师/双蒸馏/历史聚合核心保留，image构建时enable_lenet.py只扩展原DistillationModel两个构造调用为按名称选择，不覆盖尚未提交的工作区CADS算法核心。

两新Flow默认rounds300/local_epochs5/model lenet/seed31；CADS初始化ROUNDS绑定本次rounds，三个客户端全部参与，实际样本数2500/10000/37500。其它数值参数保持上批，叶任务timeout30分钟只是训练时间预算，不改变Pod资源。失败不生成完整300轮成功结论，不自动以更少轮替代。

首次执行发现运行时Repeat硬上限100，进入循环前FAILED；为实际300轮将该校验最小改为1..300，控制状态/反馈/重试等语义不变，301及非法数仍拒绝。只改已有FlowExecutor及边界回归测试，不新增Java类/API/表/SDK/权限。[实现与运行](../../examples/federated/cifar300/README.md)。
