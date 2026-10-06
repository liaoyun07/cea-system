# GFed-HSAM 云边联邦学习

在18080“数据流编排”选择 `gfed-hsam`，默认强非IID MNIST、三个边缘客户端、MLP、本地epoch1、两轮。数据划分/训练参数仍由本系统控制，可选已有MNIST/CIFAR10等量或强非IID分区；测试引用须匹配。CIFAR100支持v1，LeNet只适用CIFAR10。

主要过程：云端初始化模型及状态 → 三边缘同批四梯度HSAM训练 → 云端动态状态修正聚合 → 独立测试集评估 → 下一轮。

参数：rho_0/rho_1是两种扰动半径；phi是动态正则强度；hsam_alpha/hsam_beta是混合系数；hsam_gamma控制负向梯度项。默认值仅为平台演示约定，未验证优于FedAvg。完整 [算法与实现约定](../../../docs/contracts/gfed-hsam.md)。不设置参与率，不随机跳过客户端。

源码/测试：`algorithms/federated/gfed_hsam.py`、`gfed_hsam_app.py`、`test_gfed_hsam.py`。扩充现有CPU镜像能力，保留原app.py入口；只给四个新应用使用新版本，不覆盖旧契约/Flow。

```powershell
docker build -f algorithms/federated/Dockerfile.gfed-hsam -t cea/federated:gfed-hsam-v1 .
docker run --rm cea/federated:gfed-hsam-v1 python -m unittest -v test_gfed_hsam test_federated test_fedcads
node --test examples/federated/gfed-hsam/definitions.test.mjs
```

完成镜像向中心Registry的既有上传流程后，注册：

```powershell
node examples/federated/gfed-hsam/register.mjs registry-center:5000/lab/cea-federated@sha256:实际digest
```

注册脚本读取本地CEA配置但不输出凭据；只新增四个v1和gfed-hsam r1，拒绝覆盖冲突定义，完全相同的部分注册可续接，不自动执行。定义在definitions.mjs，复用现有四阶段模板；门户中的YAML/参数可按原修订机制编辑。

CEA已发布并完成两轮全量强非IID MNIST验收（11Job/9模型和独立数值复算通过），第二轮89.23%；未进行收敛优势实验。可运行 `node examples/federated/gfed-hsam/smoke.mjs before/run/after` 的对应单个命令与 `audit.ps1` 复验；证据固定写入.local/cea/gfed-hsam，已有证据不自动覆盖。验证记录见 [FL-HSAM-01](../../../docs/verification/VER-FL-HSAM-01.md)。
