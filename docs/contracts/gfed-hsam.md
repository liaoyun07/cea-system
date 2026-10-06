# GFed-HSAM 核心接入协议（FL-HSAM-01）

依据用户提供的 ICASSP 2025 原文《General Dynamic Regularization Federated Learning with Hybrid Sharpness-Aware Minimization》，DOI 10.1109/ICASSP49660.2025.10890601，第2页公式7–13、第3页 Algorithm 1。实现属于核心机制接入，不宣称复现作者源码或论文精度。数据划分、模型、完整本地 epoch、batch、学习率、客户端列表和轮数沿用平台定义。

## 本地 HSAM 和实现约定

同一 mini-batch 上计算四次真实交叉熵梯度，所有扰动均以当前未更新模型 x 为基点：

```text
g0 = ∇L(x)
s0 = rho_0 · unit(g0 - mu_i - s_global)
g1 = ∇L(x + s0)
s1 = rho_1 · unit(g1 - g0 - mu_i - s_global)
g2 = ∇L(x + s1)
s2 = rho_1 · unit(g2)
g3 = ∇L(x + s1 + s2)
h+ = alpha · g1 + (1-alpha) · g3
h- = beta · g0 + (1-beta) · g2
g_corrected = g3 + beta · (h+ - gamma · h-)
s_local = s0 + s1
mu_i = mu_i + s_local - s_global
x_next = x - lr · [g_corrected + phi · (x - x_global + lambda_i)]
```

原文存在歧义，明确约定如下，不静默声称与作者实现相同：

- 最终梯度使用公式12的明确表达式。正文提及平行/正交分解但未提供操作式，本版不额外杜撰投影。
- Algorithm 1 第7行引用的公式9/11不是扰动定义；零阶/一阶局部扰动分别采用公式8/7，并将总扰动定义为二者之和。
- 原文指定全局/局部扰动更新参考文献17，采用其 FedSMOO Algorithm 1 的 `gradient - mu_i - s_global` 方向修正；对两个局部方向应用同一修正是本版 HSAM 扩展约定。第一次无历史状态时退化为公式8/7。
- 第4行下发后又置零与全局一致性目的冲突：仅初始化时置零，此后使用云端下发的实际全局扰动；`mu_i` 跨轮保留。
- 使用公式12和10中的 rho_1，不根据未明确的文字推导另一组半径；不用公式9/11再次构造一个并行优化器。
- alpha/beta 为混合系数，平台约束0..1；gamma、phi及半径非负。默认 alpha=beta=0.5、gamma=1、rho_0=rho_1=0.05、phi=0.001，是演示配置，不是论文实验参数。没有梯度裁剪、额外衰减或模拟准确率。
- 本地 epoch 是对本地完整数据迭代一次，不是仅一个 mini-batch。四次梯度使用同批数据。当前复用平台 MLP/CNN/CIFAR10 LeNet，无BN/Dropout状态问题；不新增任意模型加载入口。
- unit(0)=0（分母最小1e-12）。双半径为零、phi=0、gamma=1时本地更新退化为原简单SGD；服务器动态修正仍是独立机制，不能将整个算法称为FedAvg等价。

文献17：[Dynamic Regularized Sharpness Aware Minimization in Federated Learning](https://proceedings.mlr.press/v202/sun23h.html)，ICML 2023，Algorithm 1，第5页。只参考扰动一致性机制，参数漂移和聚合使用GFed-HSAM原文的符号/更新式。

## 跨轮状态与云端聚合

初始化保存每个实际客户端的 lambda_i、mu_i 及全局 lambda、s。客户端只读取自己的两个向量，输出模型、更新后的状态和扰动残差：

```text
lambda_i_next = lambda_i + (x_global - x_local)
residual_i = mu_i - s_local_last
lambda_next = lambda + mean(x_global - x_local)
s_next = rho_0 · unit(mean(residual_i))
x_global_next = mean(x_local) - lambda_next
```

对应 Algorithm 1 第12–17行。当前显式配置客户端每轮全部训练，N等于参与客户端数量；不用 participation_rate 或随机跳过。按论文均值聚合，不按样本量加权，CLIENTS不定义无消费者的weight字段。不均等分片仍是真实平台数据，不代表改成FedAvg加权公式。缺失、重复和混轮结果拒绝聚合。

所有跨轮状态由云端聚合产物持有，通过既有Repeat的global_model反馈传递，不依赖训练Pod存活或客户端本地磁盘。算法镜像不直连数据库/MinIO/API，不新增表、Java字段或第二套执行链。

## 四个应用

同一新镜像的 `/app/gfed_hsam_app.py` 接收 init/train/aggregate/evaluate 子命令，注册应用 `gfed-hsam-init/train/aggregate/evaluate` 的v1。

| 阶段 | 输入与参数 | 输出 |
|---|---|---|
| init（cloud） | MODEL、CLIENTS、SEED、匹配TRAINING_DATASET/TEST_DATASET引用 | model.pt（模型及零状态） |
| train（各edge） | global_model、契约DATASET准备出的DATASET_PATH、CLIENT_ID、LOCAL_EPOCHS/BATCH_SIZE/LEARNING_RATE/SEED、PHI/RHO_0/RHO_1/HSAM_ALPHA/HSAM_BETA/HSAM_GAMMA | model.pt（本地模型及状态） |
| aggregate（cloud） | 原global_model、client_models集合manifest、RHO_0 | model.pt（下一轮模型及全部状态） |
| evaluate（cloud） | 新global_model、TEST_DATASET准备出的TEST_DATASET_PATH、BATCH_SIZE | metrics.json（真实loss/accuracy/samples/round） |

CLI沿用原SDK发布cea-measurement.json，不改变计量区间或失败处理。新模型产物不能与FedAvg/FedProx/FedCADS混用。训练/测试版本必须匹配；LeNet只用于CIFAR10，与既有模型限制一致。

定义、契约、注册及选择项见 [示例](../../examples/federated/gfed-hsam/README.md)。默认强非IID MNIST，支持已有等量/强非IID MNIST和CIFAR10以及CIFAR100 v1。只引用现有数据，不生成新划分。
