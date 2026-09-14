# OFF-04：边缘决策与五基线比较

依赖 OFF-01/02/03。用户授权第4步，状态以 [进度](../04-progress.md) 为准。

真实能力：所属网关执行六维网络推理，Offloading只选层；Placement/Runner继续复用。PyTorch离线Double DQN消费真实转移，模型版本不可变，显式探索与冻结评估分开。现有卸载详情显示固定模型与实际目标层，不新建研究状态机。

验收：模型维度/有限值、合法动作掩码、在线选择/目标评价的数值测试、回放及目标网络同步、缺测拒绝、可信内部控制认证、真实终端/边缘/云路径、普通执行链回归、前端模型展示、同负载五策略比较和失败分母。发布仅更新backend/frontend/gateway，保持原对象及其余16个服务不变。

代码与字段消费者：见 [Java索引](../01-code-architecture.md)；新增Python网关`dqn.py`、训练/实验脚本，新增DSL `offload.exploration`由网关epsilon-greedy实际读取；没有新生产Java文件、DB表列、SPI或平台API。旧Java单步预测及旧13维训练被替换，不保留兼容执行逻辑。

不是完整研究结论：当前不做在线训练、能耗/成本/多核优化、自动模型晋升、多机器时钟对齐、正式性能达标或DQN优于基线的保证。当前状态来自真实采集的近似观测，并非证明完整马尔可夫状态。协议见 [OFF-04](../contracts/off04-double-dqn.md)，结果见 [验证记录](../verification/VER-OFF-04-double-dqn.md)。
