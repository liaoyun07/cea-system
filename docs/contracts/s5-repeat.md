# S5-01 Repeat协议

本批已实现并通过[验收](../verification/VER-S5-001-repeat.md)，阶段状态见[进度](../04-progress.md)。沿用原Flow/Execution HTTP API，没有新路由或Binding来源。

`core.Repeat`是控制任务，`tasks`是每轮完整子图（按顺序，可内含Parallel/Dag/If）；`repeat`包含：

- `iterations`：现有Binding，运行时解析为1..100的整数并冻结。
- `initial`：状态名到初始Binding。
- `feedback`：相同状态名到每轮完成后的Binding；initial/feedback键必须一致，可都为空。

状态名不能占用`iterations`、`iterationCount`。子任务使用`{source: TASK_OUTPUT, taskId: rounds, port: model}`读取当前模型；循环外同样引用rounds.model获取最终模型，不再绑定内部train/aggregate。iterationCount是已完成轮数，轮内当前轮号另外可从模板上下文taskrun.iteration读取。

initial和iterations只能引用循环外可达上游；feedback可引用本轮保证成功的任务和循环当前状态。直接引用If条件分支的非保证输出、未来顺序任务、无依赖并行兄弟及循环外引用内部输出均拒绝。变量与Flow Input仍由作者显式定义。

子任务全部成功→解析feedback→更新父状态→下一轮。循环内评估未结束时不启动下一轮；评估在循环外则仅执行一次，系统不推断算法角色。单个叶子重试不重跑整轮；任一失败或取消不会创建后续轮。

TaskRun查询新增parentTaskRunId/iteration：无循环任务为null/0，轮内为所属Repeat运行UUID/从1开始的轮号。taskId仍是定义ID，每轮TaskRun UUID及产物路径不同；Attempt仍仅表示该TaskRun的重试。执行状态仍由Executor拥有。

不支持嵌套Repeat、无限/条件循环或控制任务retry/timeout；叶子timeout沿用S4。每轮成功输出保留在TaskRun历史中，但不会当作下一轮同名任务已经成功。迁移V10要求排空活动执行、停机更新新后端；不修改旧系统数据库。
