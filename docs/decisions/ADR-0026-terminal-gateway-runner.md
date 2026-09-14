# ADR-0026：OFF-02 元数据请求与网关终端执行

状态：ACCEPTED / OFF-02已发布，2026-09-14。用户授权第2步以及CEA终端代理、独立特权DinD模拟引擎；不挂宿主Docker socket。实际结果见[验收](../verification/VER-OFF-002-terminal-gateway.md)。

## 决策与边界

终端先把原始文件固定为本地不可变fileId，向网关发送requestId/eventType/fileId/bytes。新增compute入口只接受这些元数据，经既有edge-access事件路由提交策略Flow。data_file是显式JSON Input，子任务用原Binding引用；不增加Binding来源、模板目录或Execution状态链。

Application准备阶段识别`{fileId,bytes}`命名文件描述符，仅允许可信TERMINAL来源及已配置的网关连接。选层前通过网关向终端检查文件大小；选TERMINAL时不上传原始文件，终端代理在自己的Docker引擎运行同一Application镜像；选EDGE/CLOUD时由网关从终端读取并原子写所属边缘存储，现有Pod助手直接读取该对象。CLOUD输出仍先落云存储，不为“经中心”制造中间副本。

Worker通过网关驱动代理的幂等容器准备/查询/取消；TaskRun+Attempt决定唯一容器名。代理不创建Execution、不重试算法、不调度子图。Docker状态及持久取消标记用于同Attempt接管/防止取消后迟到重建；未知通信结果保留原Worker租约接管语义，不冒充成功或释放预约。成功小JSON沿原产物授权读取后经网关返回终端。原上传事件入口不变。

新增FIXED+layer用于三路径验收及后续基线；RULE仍选层，Placement仍选具体集群。DQN仍禁用。已有显式Docker Context部署能力继续作为原Runner配置路径，不自动回退到它；CEA新接入使用网关连接，连接互斥。这不是第二个Executor/Worker链。

## 真实消费者

- 网关连接地址/认证：Application适配器调用已登记来源终端；不接受Flow提供网络地址。
- Prepared的terminalFiles/网关目标标识：本地挂载、按需上传与同Attempt重入；长期密钥不进入Prepared。
- Offload.layer：FIXED决策的唯一目标层；RULE/DQN不得携带。
- 代理按Attempt的请求描述与取消标记：容器准备中断后的幂等恢复、取消后拒绝迟到创建；不是业务状态表。
- 不新增数据库表/列；复用Execution.inputs、Worker prepared、edge_submission和OFF-01观测。

## 参考与有意简化

参考[Kestra服务组件](https://kestra.io/docs/architecture/server-components)：Executor推进状态，Worker/Runner执行远程工作；不把Python代理当作新工作流引擎。参考[ThingsBoard网关RPC](https://thingsboard.io/docs/reference/gateway-api/rpc/)的终端归属转发及请求关联思路，不复制MQTT/离线队列。官方资料核查日期2026-09-14。

当前仅稳定联网HTTP、同网关来源终端、Linux Docker、单文件1..64MiB及小JSON结果。无离线续跑、任意终端枚举/调度、物理多云性能结论；真实状态/端到端奖励/Double DQN留OFF-03/04。验收及发布结果另记，不因设计完成标为功能完成。
