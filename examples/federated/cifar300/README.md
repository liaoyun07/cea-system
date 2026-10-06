# FL-CIFAR-300：LeNet/Fusion、5 epoch、300轮

用户要求取代旧40轮试验，仅强非IID CIFAR-10。保留50000训练（2500/10000/37500）和原10000官方测试。FedAvg使用作者普通LeNet，CADS使用作者Fusion结构：64/64通道5×5卷积、1600→384→192→10；融合分支将两卷积特征双线性缩放拼接，128→192的1×1卷积、全局均值池化，复用主fc3。两主初权重相同。参考[作者模型](https://github.com/FL-boop-blip/FedCADS-main/blob/main/utils_models.py)。

本地epoch5、总rounds300、seed31。仅对齐上述模型和epoch；batch128/lr0.1/alpha0.001/rho0.1、无动量/权重衰减/学习率衰减、每轮三个客户端全部参与均保持，不冒充作者完整实验。CADS内部schedule跟随300。新版本cifar300-v1、两独立Flow cifar300-strong-fedavg/fedcads，不覆盖旧镜像/角色/Flow。

大模型5epoch可能长时间运行；叶任务timeout改30分钟容纳训练，不扩大资源/权限或重启K3s。顺序执行两方法，无早停，不混入旧CNN时间。90%耗时仍从Flow启动到首次达标评估结束，未达标则不计算提升。执行证据仅.local/cea/cifar300，接受ID保留、不重复提交，失败保留并停止下一方法。

```powershell
docker build -f examples/federated/cifar300/Dockerfile -t cea/federated:cifar300-v1 .
node examples/federated/cifar300/run.mjs register <immutable-registry-image>
node examples/federated/cifar300/run.mjs run
```

首次执行遇到Repeat硬上限100，因此最小调整为300并更新后端；无新Java类/API/表/SDK，主调用链仍Flow→角色契约→容器→文件产物。[验证与实际状态](../../../docs/verification/VER-FL-CIFAR-300.md)。
