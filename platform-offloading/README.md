# platform-offloading

职责：仅针对可卸载终端任务的卸载决策。

OFF-01：显式终端任务的 RULE 只选择执行层，输入是每层合法容量/占用汇总，不挑代表 cluster。实际位置由 Resource 预约后回填审计；普通 CLUSTER 和固定 TERMINAL 不贡献卸载观测。旧单步 Q 模型登记/查询保留，但不再执行新 DQN 决策，等待 OFF-04 替换。仅拥有 off_task_observation 和 off_dqn_model，不读写 Execution 或资源表，不包含另一套 Executor/Worker。当前边界见[协议](../docs/contracts/s5-terminal-offloading.md)。

- [模块边界与 Java 文件索引](../docs/01-code-architecture.md)
- [功能索引](../docs/02-feature-index.md)
- [当前进度](../docs/04-progress.md)

依赖：`workflow-runtime`、`platform-resource`、`platform-foundation`。runtime提供JsonCodec/错误/分页规则，foundation提供身份授权；resource依赖尚无直接Java消费者，原模块依赖未扩大。真实候选由Application适配器通过资源公开服务提供。离线训练见[说明](../algorithms/offloading/README.md)。
