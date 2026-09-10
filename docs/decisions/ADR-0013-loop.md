# ADR-0013 通用Loop与动态集合文件输入

2026-09-10，ACCEPTED；用户授权按设计审查方案实现S5-02b，基线dd1a75a。不进入S5-03至05或迁移其他算法。

参考本地Kestra 0354ddf的Loop.java、LoopExecutionEventMessageHandler.java、ExecutorService.java、RunVariables.java，以及[官方Loop](https://kestra.io/plugins/core/flow/io.kestra.plugin.core.flow.loop)。沿用item作用域、按任务组限流、显式循环输出；不复制其独立子Execution/事件链、URI流式遍历、暂停和失败忽略开关。

Loop与Repeat共用FlowExecutor、TaskRun、WorkerJob和Attempt。父TaskRun+局部iteration区分动态实例；Repeat的iteration保持从1开始，Loop的item.index从0开始。修改V10唯一约束使其包括规范化父作用域，新增迁移而不修改历史迁移。没有新业务表、TaskRun字段或执行状态。只允许Repeat包含Loop，不允许Loop内再放Loop/Repeat。

Loop首次启动冻结values到已有outputs_json的保留键_loopValues；按并发空位创建任务组，运行/排队/重试等待均占位。组内顺序，显式Parallel可并发。失败停止接纳新item，等待已启动组收尾后失败；取消等待活动Pod停止。恢复通过现有实例与快照推进，不重新读取集合。输出由作者显式声明，按输入下标收集为数组，不按完成顺序。

同一Binding增加ITEM(path)，作用于当前item的value/index，不写全局变量。candidateClusters统一解析为Binding，静态数组只是Literal简写。inputFiles的URI列表由平台准备成编号文件及本地JSON清单；清单保存在既有prepared_json中以便接管，不让算法访问存储凭据。FedAvg/FedProx仅把三份train改为Loop内一份train，聚合读取清单，执行器不识别算法名。

有限集合首版最多1000项、concurrency 1..100，防止单个控制周期无限展开；没有新增可配置预留项。不支持整个Loop retry/timeout，沿用叶子retry/timeout和Flow级Errors/Finally。实际状态与测试以进度/验收记录为准。
