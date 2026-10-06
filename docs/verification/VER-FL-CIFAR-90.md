# FL-CIFAR-90

2026-10-06，基于c86c84a；用户授权CIFAR-10同样两种划分并比较两算法90%耗时。数据/契约/Flow已接通，正在执行。已有CNN较小，不保证达到目标，未达标不得推算达标时延。

范围及口径见[使用](../../examples/federated/cifar10-partitions/README.md)。先四组seed31×40轮；不加模型/优化器/数据增强，不调参数，无独立预热，四K3s共享同一宿主。此初批如果未达90%，下一步模型/训练方案需说明后再做。

## 已验证的接入

- 两版各完整50000原始训练样本，像素标签逐张不变；等量16667/16667/16666，强2500/10000/37500，类别分布见.local/cea/cifar10-partitions/manifest.json。原v1/test保持，两版六对象上传后独立读回完全相同。
- 首次离线准备普通torch.load在宿主内存不足时失败，失败目录移到.local/cea/cifar10-partitions-failed-memory可恢复；改离线准备用mmap。第二次因PyTorch mmap只接受字符串路径失败，随后转str成功；训练/计时加载方法没有修改。
- 镜像cea/federated:cifar-part-v1继承本批前已发布mnist-part-v1，仅替换model.py的一行版本识别。发布registry-center:5000/lab/cea-federated@sha256:35f03d42e4f8b1600654fa4831961939c47600ca8bbf3dc460557705854be9d5。
- 新镜像19Python原算法及引用测试、1Python分区测试通过；4Node新旧Flow转换测试通过，结构检查通过（不代表Java业务测试）。本批无Java/API/表/SDK/引擎/权限/资源修改，后端前端/K3s未重启。
- 八角色新cifar-part-v1契约与四r1 Flow已API验证发布，原conv01-v1契约读回完全相同。新Flow：cifar10-equal-fedavg/fedcads、cifar10-strong-fedavg/fedcads。用原conv02入口脚本，不增加内部SDK时钟报告。
- 已启动等量FedAvg b186856d-7015-45bc-a76d-473f9d3eafda，后续等量CADS/强Avg/CADS按顺序执行，任何失败保留证据并停止后续自动提交。每轮10000测试；当前没有最终结果或90%提升结论。

原始执行证据.local/cea/cifar10-partitions/flow-equal和flow-strong；已有accepted ID不重复提交。运行结束后audit.ps1复查真实初始/客户端/最终模型及402Job，每一对完成后才能核算90%时间，未达标值为null。

本轮主命令仍在运行，按等量Avg/CADS→强Avg/CADS顺序。strong运行器结束后自动执行finish.mjs的两组audit并生成comparison.md/json；这是本次实验程序的收尾步骤，不是新定时任务或持续监控。当前训练和收尾尚未完成，不能将报告模板中的通过条件当作已通过。
