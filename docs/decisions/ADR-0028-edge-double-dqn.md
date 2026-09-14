# ADR-0028：边缘网关Double DQN与真实负载比较

状态：ACCEPTED/IMPLEMENTED，2026-09-14，用户授权OFF第4步。依赖OFF-03；原六维、传输估计和终端端到端奖励不换口径。已发布CEA并完成真实比较，结果与限制见[验证](../verification/VER-OFF-04-double-dqn.md)；核心闭环完成不代表DQN优化优势。

## 最小实现

后端Resource在接纳事务内冻结六维，Dataflow通过已有可信网关控制连接发送状态、合法层、固定模型和探索概率；所属边缘网关执行6→32→3的Linear/ReLU/Linear推理，只返回层动作。平台记录已返回动作后，原Placement和Runner执行。网关不选cluster，不拥有Execution或资源台账。不新增常驻服务、Java类、数据库表或SPI。

替换旧13维单步Q训练器/模型执行契约，不转换旧模型或观测；旧JSON记录仍可读取，新登记/执行只接受六维模型。DQN缺失状态、错误模型、网关失败均明确失败，不回退RULE。模型随受认证的有界控制请求传入，不新建模型缓存/同步状态。状态接纳锁包含一次限时3秒的推理请求；这是当前最小闭环取舍，不是高并发性能结论。

`offload: {strategy: DQN, modelVersion: measured-v1, exploration: 0}`：新增一个实际被网关动作选择消费的可选探索概率，默认0，仅DQN允许，范围0..1。研究采集使用单独策略、明确标注未训练初始模型和exploration=1；用户现有策略不变。正式评估固定训练模型并关闭探索。

## 训练与实验边界

Python/PyTorch离线训练消费真实完成样本与不可变next关联。经验回放、在线网络选next action、目标网络评next Q、折扣gamma=0.95、Huber loss、梯度裁剪、每50更新同步目标网络；不把reward直接当Q监督标签。只使用实际选择动作的回报，不补造反事实奖励。

样本属于连续决策流。每个实验文件显式限定采集批次及样本key，训练只接收next也在该批次中的完整转换；批次结束是观测截断，不是环境吸收终态，尾项排除且不补done=true。不跨训练/评估边界拼样本，不训练评估集。当前没有服务端episode管理表或自然终止MDP，因此不以“关闭实验文件”冒充环境终止。

比较同一合成振动算法、同输入大小序列/到达计划、相同资源/暖机条件下的全本地、全边缘、全云、RULE、DQN。每种方法保留全部请求及失败，不挑最好一次；报告成功完成请求平均时延、nearest-rank P95、成功数/提交总数，另列缺测/失败。这是小规模单机多层基线，不保证DQN获胜或30ms达标。

## 参考

2026-09-14核对[Double DQN原论文](https://arxiv.org/abs/1509.06461)、[PyTorch DQN教程](https://docs.pytorch.org/tutorials/intermediate/reinforcement_q_learning.html)及[Tang作者训练代码](https://github.com/mingt2019/Deep-Q-learning-for-mobile-edge-computing/blob/main/train.py)。沿用Double Q的选择/评估分离和回放/目标网络，不复制仿真时隙或设备本地决策。六维/延迟奖励关联沿用[ADR-0027](ADR-0027-offloading-measured-state.md)；Kestra的Executor/Worker状态边界不变，边缘推理是本项目业务差异。
