# OFF-04：边缘 Double DQN

本协议覆盖 OFF-03 之上的决策和训练增量；六维原始量、传输估计、奖励、反馈认证仍以 [OFF-03](off03-measurement.md) 为准。实际测试、发布和比较结果见 [验证记录](../verification/VER-OFF-04-double-dqn.md)。

## 原链上的决策

```text
终端元数据请求 → 所属网关 → 原策略 Flow / Execution / Worker
  → OffloadingTaskAdapter / Resource 接纳锁
      冻结真实六维状态和合法动作
      → 所属网关 offloading/decide：6→32→3 网络，返回层及模型推理毫秒数
      → OffloadingService：固定模型版本、动作、状态和推理时延
  → 原 JobPlacementService 在该层合法范围内选具体位置
  → 原 Runner / 文件助手 → 原结果授权 → 网关 → 终端反馈
```

网关不选 cluster，不拥有 Execution 状态。平台不连接终端 Docker，沿用 OFF-02 网关通路；普通 CLUSTER Flow 不进入此路径。控制请求沿用既有独立控制凭据、网关/终端路由校验，终端 Bearer 不能调用决策操作。推理 HTTP 总超时3秒；故障使本次任务失败，不回退 RULE。

`offloading/decide` 的 `inferenceMs` 是网关单调时钟围住一次模型前向预测的非负毫秒值，与 `action` 一同返回并写入 `off_task_observation.inference_ms`。不包含网关 RPC、请求解析、合法动作选择、任务排队/部署/执行。FIXED/RULE 不推理，字段为 `null`，详情不展示推理耗时；升级前的历史 DQN 记录保持 `null`，详情显示“未采集”。

`GET /api/namespaces/{namespace}/offloading/samples` 的每条记录另有可空 `decisionMs`。后端以单调时钟从 `OffloadingTaskAdapter.decide` 入口计至目标层选定、持久化之前；包括模型/资源查询、状态准备、DQN 网关往返及其前向推理，也包含当次 Resource 接纳锁等待，但排除此前 Worker 队列等待、后续观察落库、具体位置放置、文件与任务执行。FIXED/RULE/DQN 成功选层均记录，历史为 `null`。此值不等于终端请求到结果的系统总时延；与旧系统后端内推理路径也不构成同环境性能对照。重复决策沿用首条记录，不重新计时。

## DSL 与模型

```yaml
execution: TERMINAL
offload:
  strategy: DQN
  modelVersion: off04-trained-example
  exploration: 0
```

以上为 Application Task 的 `container` 内片段；其余显式参数/文件绑定不变。`modelVersion` 必填且固定；原 OFF-04 的唯一新增 DSL 字段 `exploration` 可省略，默认0，取值0..1，仅 DQN 可用。1用于收集探索样本，0用于冻结模型评估。不可变模型继续通过既有 `PUT /api/namespaces/{namespace}/offloading/models/{version}` 登记；此次计时增量不新增后端API、表或SPI，只增加上述可空计时列与响应字段。

模型 JSON `stateSchema=measured-offload-log1p-v1`，`weights1` 为32×6，`bias1` 32，`weights2` 3×32，`bias2` 3。接口允许隐藏层1..128，当前训练器固定32。状态为 OFF-03 六项非负真实量逐项 `log1p`，无虚构缺测值。合法动作索引固定0=TERMINAL、1=EDGE、2=CLOUD；非法动作在探索和贪心时均屏蔽。历史13维模型仍可查询，不能登记为新模型或用于推理，不保留旧网络预测路径。

当前 DQN 只接受 OFF-03 可测资格：单个终端计算任务、单份原始文件、无重试、首次 Attempt、可信来源、单一中心云、同画像工作量及完整六维标定。未标定、混合画像和不可测输入明确失败；固定动作/RULE仍可用于先收集标定。具体位置继续由 Resource/Placement 决定。

## 真实训练

`algorithms/offloading/train.py` 用 PyTorch 实现在线网络、目标网络、经验回放和 Double DQN 目标：

```text
a* = argmax_合法动作 Q_online(next_state, a)
y  = reward + 0.95 × Q_target(next_state, a*)
loss = Huber(Q_online(state, action), y)
```

Adam学习率0.001，梯度范数上限10，每50次更新同步目标网络，固定1000次更新、种子17；回放容量最多10000，batch=min(32,真实完整转移数)。需要三种动作都有完整样本，不凭空补样本。训练集与评估集按执行ID隔离。

下一状态来自同一网关/策略/算法画像下一次接纳的请求，不按完成先后关联。训练器逐项核对状态变换、实际奖励、合法动作、next关联及对应下一条记录。当前是持续请求流的有界离线回放，不创建假的episode终态：只接受同一导出批次内已完整关联的转移，尾部/缺测剔除，不将尾部伪造为 `done=true`，不跨导出边界借用未知请求。没有在线持续训练或自动替换模型。

## 比较口径

实验先落盘计划，再收集探索数据、训练和冻结模型。五方法使用同一镜像、文件规模序列、两请求到达间隔和资源配置；使用独立新策略，不改变原策略或旧样本的下一状态。平均/P95统计成功且终端计量完整的请求；P95用nearest-rank。成功率以所有已提交请求为分母，失败和缺测单独列出，不把快速失败算作更低时延。

计时是终端发元数据前到解析最终结果，含排队、决策、传输、容器启动、算法和回传。当前到达模式是两请求一组、相隔0.25秒、整组完成后才发下一组的闭环比较；各方法输入序列和组内间隔相同，不等于相同绝对时刻的固定RPS回放。CEA为同机容器模拟多位置；小样本和0.5秒结果轮询分辨率限制必须公开。奖励下降或训练损失下降不能替代实际时延改进结论。依据与有意简化见 [ADR-0028](../decisions/ADR-0028-edge-double-dqn.md)。
