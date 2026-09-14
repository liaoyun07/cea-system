# ADR-0017：卸载研究后置，普通执行最小解耦

2026-09-14 后续变更：用户授权 OFF-01～04 恢复卸载研究。普通执行解耦继续保留；原候选绑定/代表位置和单步 Q 执行决定由 [ADR-0025](ADR-0025-offloading-layer-placement.md) 更新。

状态：S5-04c已实施并通过完整回归，见[验收记录](../verification/VER-S5-007-offloading-decoupling.md)。用户授权先做最小解耦，然后推进S5-05；基线1a62a62。随后用户选择先讨论计量口径，05保持设计状态。

## 本批决定

- 普通CLUSTER和无offload的TERMINAL不调用OffloadingService读写观测，也不为卸载画像额外读取对象大小。原数据集/文件传输和资源预约仍保留。
- 固定TERMINAL直接使用可信origin和既有FIFO，不创建虚假的卸载决策。
- 完成/失败/取消时优先使用Worker已有Prepared中的实际位置；未准备完成时通过JobPlacementService查询并释放真实终端预约。不存在终端预约时，普通集群或显式卸载路径释放既有集群预约。资源表仍由resource独占，观测不是资源回收依据。
- OffloadingService.observe失去生产消费者，删除；decide/started/finish继续服务显式offload任务。
- 保留既有RULE/单步Q、候选绑定及历史表/数据，不在本批实现新的选层模型、域配置、多步DQN或重命名旧协议。上一轮审查提出的完整职责拆分是后续设计，不冒充本次已经完成。
- S5-05独立于offloading；算法计量口径须确认后实施。不用算法纯计算时间替换卸载服务耗时。

## 文件与状态所有权

只修改ApplicationTaskRunner、JobPlacementService、OffloadingService及既有测试；不增加Java类、字段、record、表、数据库迁移、API或SPI。新增JobPlacementService.releaseTerminal(namespace,key)重载，唯一生产消费者是ApplicationTaskRunner的准入前/排队取消清理，读取既有终端预约的cluster/terminal并复用原有加锁释放逻辑。

主链仍为Executor→Worker→Application适配器→Docker/Kubernetes→持久结果→Executor。租约、Attempt、retry与cancel语义不变。普通执行不需要offloading表可用；显式offload仍依赖其决策/反馈表，不宣称卸载模块已经整体可卸载部署。

## 参考与验收

参考本地Kestra提交0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4的core/src/main/java/io/kestra/core/models/tasks/runners/TaskRunner.java：运行器承担本地/远程命令与文件生命周期。本批沿用现有单一运行器链，不增加研究专用执行器；Kestra不提供本项目的终端归属或卸载算法。

在ImageDistributionTest专属临时MySQL中暂时改名offloading观测表，执行真实终端→集群产物链，再恢复表名，证明不是只删掉决策调用。回归终端失败/retry、接管、排队取消时无卸载观测且无槽泄漏；保留显式卸载三位置/训练闭环回归。验证不连接旧库、不删除历史记录。
