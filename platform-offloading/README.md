# platform-offloading

职责：仅针对可卸载终端任务的卸载决策。

已实现显式终端卸载规则、13维单步Q网络推断、不可覆盖模型版本、真实任务观测/画像/反馈。普通Application贡献画像但不自动使用卸载策略。仅拥有off_task_observation和off_dqn_model，不读写Execution或资源表，不包含另一个Executor/Worker。代码职责及有意简化见[协议](../docs/contracts/s5-terminal-offloading.md)。

- [模块边界与 Java 文件索引](../docs/01-code-architecture.md)
- [功能索引](../docs/02-feature-index.md)
- [当前进度](../docs/04-progress.md)

依赖：`workflow-runtime`、`platform-resource`、`platform-foundation`。runtime提供JsonCodec/错误/分页规则，foundation提供身份授权；resource依赖尚无直接Java消费者，原模块依赖未扩大。真实候选由Application适配器通过资源公开服务提供。离线训练见[说明](../algorithms/offloading/README.md)。
