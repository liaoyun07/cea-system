# platform-edge

职责：网关终端接入、边缘策略及结果交付。

S5-03已实现网关/终端登记与心跳、策略Flow隔离管理、事件及普通Flow提交、受归属约束的Execution结果查询。真实HTTP/MySQL测试通过，完整回归状态见进度。

- [模块边界与 Java 文件索引](../docs/01-code-architecture.md)
- [功能索引](../docs/02-feature-index.md)
- [当前进度](../docs/04-progress.md)

依赖：`workflow-runtime`、`platform-resource`、`platform-foundation`、`platform-dataflow`。通过dataflow公开服务提交/查询，不访问其他模块Repository，不另造执行状态机。详细API及最小范围见[协议](../docs/contracts/s5-edge-access.md)。不部署网关代理、不做终端断线恢复、DQN或计量。
