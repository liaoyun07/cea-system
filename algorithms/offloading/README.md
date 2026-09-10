# 终端卸载单步 Q 网络

仅针对Flow显式允许卸载的TERMINAL任务，优化一次任务从决策到完成的耗时。每次决策是一个结束episode；训练目标为实际reward，不伪造next_state或未执行动作的回报。这是DQN方向的单步有意简化（contextual bandit），不是多步长期拥塞优化或已证明优于规则的策略。

流程：先用RULE执行真实任务，分页导出同一namespace的样本，训练并注册不可覆盖模型版本，再将Flow改为DQN并显式指定版本。没有后台自动训练或生产随机模型。

1. 用具备READ权限的账号GET `/api/namespaces/lab/offloading/samples?limit=100&offset=0`，继续分页并合并JSON数组。生产样本可能含参数，按同namespace权限管理，不上传真实业务数据到公开仓库。
2. 在安装PyTorch的Python环境中执行 `python train.py samples.json model.json --updates 1000`。训练器要求三个动作均有真实已完成样本；排除普通选址、取消、未启动样本，拒绝重复Attempt。不会补造缺少的样本。
3. 用WRITE账号PUT `/api/namespaces/lab/offloading/models/cost-v1`，请求体为model.json。相同版本不可覆盖；相同内容重复注册可以成功。
4. Flow的offload设置`strategy: DQN`、`modelVersion: cost-v1`及候选集群。模型缺失、维度错误直接失败，不静默回退RULE。

数值单元测试：`python -m unittest test_training.py`。其中小型人工数值fixture只验证实现；真实三位置采样→训练→注册→执行另在ImageDistributionTest中验证。训练器与FedAvg/FedProx验证复用已有PyTorch环境，不要求业务镜像携带训练/反馈代码。

协议、状态特征和限制见[卸载协议](../../docs/contracts/s5-terminal-offloading.md)；实际验收见[验证记录](../../docs/verification/VER-S5-006-terminal-offloading.md)。
