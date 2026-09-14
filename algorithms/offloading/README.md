# 终端卸载 Double DQN

当前为 OFF-04 六维真实状态训练器，替代旧13维单步Q；不是FedAvg/FedProx算法的一部分。详细计算和边界见[协议](../../docs/contracts/off04-double-dqn.md)，实际结果见[验证](../../docs/verification/VER-OFF-04-double-dqn.md)。

网关执行数值推理，只返回TERMINAL/EDGE/CLOUD；平台原Placement决定位置、原Runner执行。训练器离线消费真实样本，不拥有队列或任务状态，不自动上线模型。

## 训练与使用

1. 先用固定动作/RULE跑真实路径，获得六维所需传输标定。尚未标定时DQN明确失败。
2. `python train.py init exploration.json` 生成明确未训练的探索模型；用已有模型PUT接口登记独立版本，仅用于 `exploration: 1` 的新研究策略收集真实反馈。
3. 分页GET `/api/namespaces/lab/offloading/samples?limit=100&offset=0`，只导出同一采集批次完整记录（包含其下一状态引用的记录），保存JSON数组。不能重复Attempt或编造缺失动作。
4. `python train.py fit samples.json trained.json --updates 1000 --seed 17`。要求三种动作均有真实完整转移，输出模型及训练报告；报告中的loss不是时延收益。
5. 将trained.json登记为新的不可变版本，评估策略设置 `offload: {strategy: DQN, modelVersion: 实际版本, exploration: 0}`。执行集不能再送入本次训练。

使用PyTorch，6→32→3网络、实际next_state、Double DQN Bellman目标、随机回放、目标网络50次同步。持续流批次尾部是截断，不伪造done；当前没有在线训练、自动模型晋升或通用episode管理。

## CEA受控比较

已部署OFF-03的CEA可先运行 `deploy/cea/release-offloading-dqn.ps1 -Capture` 保存旧对象/镜像；测试通过后 `-Publish` 仅更新backend/frontend/gateway。不要重复捕获覆盖原基线。

`deploy/cea/run-offloading-dqn.ps1` **会创建真实业务对象和请求**，不是只读校验：新增6个OFF-04专用策略、探索/训练模型和114次请求，使用已有振动统计镜像与合成数据的1/4/16倍文件。6次暖机、48次探索、训练1000更新，最后每种方法12次比较。输出固定计划、原始回执、训练/评估样本、模型与comparison.json，位于忽略的 `.local/cea/off04/pilot-时间/`。遇错保留失败证据，不自动重启试验或覆盖策略。

算法数值需要和独立已知结果一致；五方法相同文件序列、请求间隔、原资源配置。mean/P95统计成功且计量完整请求，成功率分母为全部提交，另外报告失败/缺测。本地试验不是物理多云，不能据此承诺DQN更快或性能达标。完成后 `release-offloading-dqn.ps1 -Verify` 校验原对象及其他服务未改。

## 测试

`python -B -m unittest discover -v`：训练目标、目标网络同步、真实next引用/边界、无效样本和比较口径。网关推理/合法掩码另见 `deploy/edge-gateway/test_dqn.py`；Java集成测试通过真实网关和三种Runner验证边界。人工数值fixture仅用于测试，不登记进CEA或用于性能数据。

样本/回执可能含业务参数、URI和运行身份；只保存在本地受控证据目录，公开仓库仅提交去敏汇总，不上传凭据、原始采样或构建产物。
