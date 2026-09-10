# ADR-0016：终端卸载资格、单次放置决策与真实反馈

状态：已实施并通过最小闭环验收，见[VER-S5-006](../verification/VER-S5-006-terminal-offloading.md)。用户授权继续S5-04剩余部分；基线fd4e768。仅新backend，不进入S5-05或修改旧服务。当前单步Q简化不代表长期DQN已完成。

## 边界与最小闭环

- 仍用同一Application/Flow/Binding/TaskRun/Attempt/Worker。仅`execution: TERMINAL`可声明`offload`；没有offload即本地执行。普通CLUSTER任务拒绝offload，来自终端的普通集群任务也不会自动用DQN。
- offload显式声明RULE或DQN、候选集群Binding；DQN另指定不可变模型版本。终端身份仍来自可信接入回执。无第二套参数模型、执行器或Worker协议。
- resource通过公开服务提供健康/数据本地性、平台槽占用和终端持久FIFO；本地队列以网关集群资源行串行化准入，复用已有集群锁，不为锁新增空管理表。名额不是CPU/内存物理预约。
- offloading拥有模型与任务观测，不拥有Execution状态。dataflow的Application适配器调用公开服务；新增dataflow→offloading依赖，无反向依赖或跨模块Repository访问。
- 决策按Attempt持久保存；接管不能重新选位置。取消/超时必须实际停止后释放槽；等待不消耗新Attempt。规则/DQN只决定位置，不另造调度线程。

## 画像与模型

普通Application与终端Application都记录实际执行观测。画像比较同namespace、ApplicationVersion、命令/已解析参数、输入字节规模和目标位置；不能用Flow/节点名字或不同应用的样本混算。成功样本服务耗时从容量准入且实际输入选择/尺寸读取后、镜像准备前开始，到实际结果确认结束，含镜像准备/传输/容器运行；卸载总成本另含决策后的等待。不是S5-05算法时间或数据处理速率。

规则使用log归一化画像成本加槽负载，分数不是毫秒预测；冷启动只按真实槽负载排序，不把缺失画像填成伪造耗时。DQN使用13维状态：输入规模，以及TERMINAL/EDGE/CLOUD各自的可用标志、槽负载、服务耗时、画像存在标志。每层若有多候选，按同一规则选代表；层级动作始终屏蔽不可执行目标，不固定集群名称或数量。首位置数据集尺寸仅用于决策前估计，实际画像在准入时按选中对象尺寸记录，详见协议。

模型按版本登记、严格校验状态语义/形状/有限数值，缺失模型报错，不静默随机或规则回退。离线训练使用真实已完成决策的状态/动作/耗时反馈。当前每个Attempt是单步episode，优化本任务完成代价，不伪造next_state或宣称学到了长期拥塞控制；Q网络训练在此边界等价于单步回报拟合。取消不作为算法失败训练；失败有明确惩罚。功能验收不能替代调度性能/最优性实验。

## 参考与有意简化

Kestra本地提交0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4，`core/src/main/java/io/kestra/core/models/tasks/runners/TaskRunner.java`：命令/文件和运行器生命周期分离。沿用该职责边界与原执行状态所有权，不复制插件数量。终端卸载是本课题业务，不宣称Kestra原生提供本DQN。

Q网络、经验采样和动作值训练参考[PyTorch官方DQN教程](https://docs.pytorch.org/tutorials/intermediate/reinforcement_q_learning)。当前单步episode无后续状态，TD目标就是实际reward，不引入没有消费者的target-network/next_state字段；多步DQN不在本批已实现能力内。

## 字段/表的当前消费者与验收

- Flow Container.offload：资格校验、策略与模型选择，使用现有Binding。
- resource终端预约表：FIFO序号、已准入/已释放事实，实际限制Docker并发并处理等待取消。
- offloading任务观测表：同Attempt位置冻结、画像统计、完成反馈、样本导出；不复制outputs/Execution状态。
- offloading模型表：按版本加载Java推理权重；禁止覆盖同版本。
- Terminal连接的slots配置：终端FIFO准入的实际容量，默认1；不支持旧字符串与新对象双格式。

必须验证：资格/伪造拒绝、普通集群不误用、真实本地和远程执行、容量FIFO/等待取消、失败和接管不泄漏、画像隔离/反馈幂等、模型验证/掩码/训练导出Java一致性，以及全部既有回归。S5-04仅在这些验收通过后完成；物理SSH、多云性能、长期DQN及S5-05仍不宣称完成。
