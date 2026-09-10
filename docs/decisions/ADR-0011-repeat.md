# ADR-0011 Repeat的轮次与状态反馈

2026-09-10，ACCEPTED，用户授权开始S5。首批S5-01，基线8efaa59。

参考本地Kestra提交0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4：`core/src/main/java/io/kestra/plugin/core/flow/LoopUntil.java`、`core/src/main/java/io/kestra/core/models/executions/TaskRun.java`、`core/src/main/java/io/kestra/core/models/tasks/FlowableTask.java`。已阅读LoopUntil的下一轮/状态判定，以及TaskRun的parentTaskRunId、iteration；不声称该checkout为官方最新版本。

沿用其职责：循环是Executor解释的控制任务，叶子仍由Worker执行；任务定义不等于每次运行实例，轮次不是Retry Attempt。研究需求是固定轮数与显式模型反馈，故本期实现有界Repeat，不复制条件轮询、插件接口或无限循环。嵌套Repeat暂明确拒绝，循环内仍可包含Sequential/Parallel/Dag/If。

Flow使用现有Binding声明iterations、initial和feedback。控制TaskRun的outputs保存iterations、iterationCount及显式状态名：iterationCount为已完成轮数，initial定义初值，整轮所有子任务成功后一次性计算feedback并推进状态；子任务通过TASK_OUTPUT引用所属Repeat的当前状态。类似Kestra循环可读自身当前输出，本项目不引入第二套alias或表达式类型。

新增TaskRun.parentTaskRunId与iteration及数据库对应列，用来标识所属Repeat运行和轮次。无循环任务iteration=0/parent为空；轮内任务保留模板taskId，每轮新UUID，Job/产物隔离自动复用S4。此处parent仅标识Repeat作用域，不另建完整控制树索引。无需新增业务表。父TaskRun的outputs存已完成轮数和冻结总轮数，是推进/恢复的真实消费者，不另加游标表。

每轮行和父状态变更都在同一Execution锁事务中；只创建当前轮，禁止一次性复制所有轮。取消只回收已创建任务，确认活动Job停止后才完成父循环/Finally。上一轮的产物不会通过taskId映射泄漏到本轮；循环外只读取Repeat显式状态输出，不直接读取循环子任务。

不新增控制任务Retry：单个叶子在本轮原TaskRun上增加Attempt，循环不重新启动已成功兄弟。错误/Finally仍用既有Flow级语义。评估必须显式放在Repeat.tasks中才能逐轮执行；放在外部就只在整个Repeat后运行，不能根据镜像名字推断/偷偷移动节点。

S5-02真实联邦学习迁移另行验收，本批通用任务测试不冒充FedAvg已完成。计量、网关/终端和卸载均为后续S5工作包。
