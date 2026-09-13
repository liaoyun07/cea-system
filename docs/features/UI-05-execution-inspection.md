# UI-05 执行数据展示

状态：DONE（本批展示范围），已发布CEA前端及FedAvg r5/FedProx r3。范围来自2026-09-12用户授权及当次“更新前端和两个流程”确认。

UI-05a（2026-09-13）：任务实例表按开始时间展示，增量验证/发布状态见[记录](../verification/VER-UI-005a-task-start-order.md)，不沿用上面的历史发布结论。

## UI-05a 列表排序

- 任务实例表按后端TaskRun.startedAt升序，完全相同时间保留API返回顺序；尚未开始（包括未启动即跳过/取消）置后并保留相互顺序。非法/缺失时间同样置后，不补造开始时间。
- 使用完整返回时间比较，保留Java Instant的小数秒精度，不按页面格式化后的秒级文字排序。并行同时间不表示存在执行依赖；父级控制任务仍覆盖子任务的运行区间。重试不改口径：使用TaskRun首次开始时间，不按最新Attempt重新排序。
- `model.js.tasksByStartTime`只返回排序后的数组副本；`ExecutionDetail.vue.sortedTasks`只供此表使用。刷新后自动重算，行及尝试详情仍通过TaskRun.id识别，不使用行号作为身份。
- 原tasks数组、概览后处理列表、拓扑、Metrics和输出不变；不改变后端task_index查询顺序、轮询/API请求、调度、状态或执行链。表头提供aria-sort，不添加新开关或解释文案。
- 无Java类、API、DB表/字段、DSL或SPI增删；不是新增Kestra执行语义，仅调整已有只读表格。当前功能消费者就是任务实例列表，不引入新的领域状态或采集能力。

## 当前边界与调用链

执行详情继续轮询原Execution/TaskRun/Log API。只读拓扑通过GET Flow?revision=Execution.flowRevision获取固定修订，按DSL结构展示依赖，状态只取真实TaskRun。点击节点沿用GET tasks/{taskRunId}/attempts；输出直接展示TaskRun.outputs，不下载/解析文件内容。

- 根任务、错误处理、Finally、afterExecution分开查看。
- Sequential按声明顺序连线；Parallel不画顺序边；Dag只画dependsOn。子控制组可展开；If的then/else分开。
- Repeat/Loop只选择实际已创建迭代。实例通过taskId＋动态parentTaskRunId＋iteration匹配；普通Sequential/Parallel/Dag/If不制造新动态作用域。TaskRun.id仍是选择/尝试查询身份。
- Loop展示后端已冻结的_loopValues当前item值，不拿最新输入重算。尚未创建的实例显示“未创建”，不推测状态。
- 实例/Attempt耗时为endedAt-startedAt，包括它们自身的等待/重试等区间；未结束/缺失/非法时间显示“—”。不是算法活动时间或数据处理速率，未引入新计量定义。
- Flow旧修订读取失败仅使拓扑报错，实例表/日志/输出仍可用；不退回最新修订。当前策略隔离可能使策略Flow源API不可读，本批不增加跨管理范围读取接口。
- FedAvg/FedProx训练/测试数据输入改显式SELECT，值分别mnist-train/v1和mnist-test/v1。不是契约自动派生/求交集；保存端及执行端继续已有成员校验。

## 文件与职责

- frontend/src/execution-graph.js：只读拓扑投影、动态实例查找及时间差格式化。
- frontend/src/ExecutionGraph.vue：固定修订读取、分组/轮次/item导航、缩放和节点选择。
- frontend/src/TaskRunDetail.vue：实际输出/时间/Attempt展示。
- frontend/src/ExecutionDetail.vue：复用现有轮询与尝试API，选中实例从最新TaskRun列表按ID读取。
- examples/federated/fedavg.yaml、fedprox.yaml：仅两个数据集输入类型/选项变更。

没有生产Java新增/删除、DB迁移、API/表/字段/SPI新增，Executor→Worker→Runner链未变。

## Kestra参考与简化

本地Kestra源码commit `0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4`：

- ui/src/components/executions/Topology.vue：只读拓扑与执行状态关联。
- ui/src/components/inputs/LowCodeEditor.vue：节点动作打开真实TaskRun输出/日志详情。
- ui/src/components/logs/TaskRunLoopProgress.vue：多迭代实例独立标识。

沿用只读图→实例详情与动态实例隔离。当前有意简化：复用2秒轮询而非SSE、前端从已有固定DSL投影而非增加图API、按任务组展开而非复制整个VueFlow/store/插件系统。我们的Loop仍属于同一Execution，不迁入Kestra子Execution架构。

## 未做

Pod日志、全局产物浏览/下载、metrics.json解析与曲线、DQN/速率、图编辑/局部重跑、旧数据迁移不在本批。验证和上线事实只见[VER-UI-005](../verification/VER-UI-005-execution-inspection.md)。
