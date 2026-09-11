# S5-02b 通用集合Loop

状态与验收以[进度](../04-progress.md)为准。决策见[ADR-0013](../decisions/ADR-0013-loop.md)。不是FedAvg专用DSL，不新增HTTP接口。

## 定义与调用链

```yaml
tasks:
  - id: clients
    type: core.Loop
    loop:
      values:
        source: LITERAL
        value:
          - {id: edge-a, clusters: [edge-a]}
          - {id: edge-b, clusters: [edge-b]}
      concurrency: 6
      outputs:
        models: {source: TASK_OUTPUT, taskId: train, port: model.pt}
    tasks:
      - id: train
        type: platform.Application
        timeout: PT5M
        container:
          applicationId: fedavg-train
          version: v1
          candidateClusters: {source: ITEM, path: [value, clusters]}
          command: [python, /app/app.py, train]
          parameters:
            CLIENT_ID: {source: ITEM, path: [value, id]}
          inputFiles:
            global_model: {source: TASK_OUTPUT, taskId: rounds, port: global_model}
          outputFiles: [model.pt]
```

此片段展示Loop结构，train依赖外层rounds模型及应用数据参数；完整可运行定义见[FedAvg](../../examples/federated/fedavg.yaml)/[FedProx](../../examples/federated/fedprox.yaml)。完整顺序为init → Repeat(rounds){Loop(clients){train} → aggregate → evaluate → feedback}。

UI-02b将上述两个算法的客户端集合内联到Loop.values，不再声明inputs.clients；更换客户端要编辑流程并保存新修订，不作为启动参数覆盖。通用Loop仍支持INPUT/VARIABLE/TASK_OUTPUT引用，前端的Array模式只是编辑LITERAL.value，不增加裸数组解析分支、String表达式或第二套集合定义。

values使用既有INPUT/VARIABLE/TASK_OUTPUT/LITERAL Binding，运行时必须是0..1000项JSON数组，不接受字符串JSON、Map或URI数据流。首次启动冻结集合，恢复不重新取值。重复值保留为不同item；空集合成功，各声明输出为[]。算法自身可以要求非空或不允许重复客户端，不属于Loop通用校验。

每个item的tasks默认顺序执行，可内含Parallel/Dag/If。concurrency默认1、范围1..100，限制未结束的item组（包括排队/重试等待），不是线程数/集群数；实际并发还受Worker和平台槽约束。只支持Repeat内放Loop，不支持Loop内Loop/Repeat。

主链仍为FlowExecutionService → FlowExecutor → WorkerEngine → TaskRunner → 持久结果 → 原Executor归并。Loop是Executor控制任务，不发往Worker；叶子继续原WorkerJob/Attempt链。

## 实例、上下文与输出

- 定义taskId不改写。TaskRun UUID是实例标识；(execution_id, task_id, COALESCE(parent_task_run_id,''), iteration)是唯一作用域。
- 顶层无动态父为null/0。Repeat子作用域iteration从1计轮；Loop子作用域iteration从1计item，父为该次Loop TaskRun UUID。两轮中的第一个客户端有相同taskId/iteration，但不同父UUID，不冲突。
- Worker上下文增加item={index:0,value:原生JSON值}，index从0开始。不是全局变量，不覆盖inputs/vars；嵌套静态控制仍持有同一个item。
- ITEM.path从value或index开始，只进行对象键逐级读取，不是新表达式语言。例[value,id]、[value,clusters]、[index]；缺失字段明确失败。Log/If等原模板可使用item.value/item.index。
- Loop外不能直接引用其train输出。作者在loop.outputs声明端口，每项解析完成后按输入下标收集数组；不按完成顺序，也不自动收集所有输出。只在全部item成功后发布完整数组，下游才启动。
- `_loopValues`存于父TaskRun已有outputs_json，真实消费者是恢复/派发/最终结果收集；不是新领域字段或表。不会作为可绑定端口，或额外复制到Worker.outputs；既有inputs/vars仍按原Worker上下文保留。TaskRun历史查询能查看该快照。

## 失败、重试、取消、恢复

- 叶子失败且可重试：同一TaskRun新增Attempt，item不变，仍占组并发名额，其他已成功item不重跑。
- 叶子重试耗尽：停止接纳新item。已接纳组按既有控制流收尾，等待其终态，再将Loop置FAILED；不发布部分成功数组。Flow Errors/Finally沿用原语义。
- cancel：不接纳后续item；遍历实际已持久化子作用域，取消原WorkerJob，等待活动Pod停止/资源槽释放，再完成KILLED和Finally。不会因Loop父终态而遗留远程任务。
- 服务重启：恢复父快照、已接纳TaskRun与原Attempt/租约。没有新客户端计数表或第二套消息。集合清单见下方，远程接管仍使用固定Job名称/Prepared。
- 无Loop级retry/timeout，无忽略失败/部分结果继续聚合、无限/流式循环、子Execution、自动发现客户端。

## 动态选址和集合文件

container.candidateClusters是同一Binding，运行时校验为1..100个不重复集群ID。静态[cloud]在解析入口转成LITERAL，保存后的定义只走Binding执行路径；不是旧/新两套运行分支。

inputFiles每个值可解析为单个S3 URI或最多1000项的URI数组：

- 单URI：沿用/cea-work/in/name。
- URI数组：每项下载到/cea-work/in/name.item-0等，并生成/cea-work/in/name.json，内容是按原数组顺序的本地路径数组；空数组清单为[]。
- URI、桶/命名空间权限、实际展开文件名碰撞在派发前检查。数组不能含非字符串。数据下载失败不会伪造文件/结果。
- 清单内容和固定输入URI一起存在既有wf_worker_job.prepared_json（Prepared.inlineFiles），接管不重新解析上游数组/重新选址。不增加清单表、路径映射表或Runner SPI。
- aggregate读取--clients-manifest /cea-work/in/client_models.json。镜像只读本地文件，不扫描产物目录，不持有S3凭据。不再保留旧--clients argv模式。

## 数据迁移与Kestra取舍

V11在新后端排空活动Execution并停机后运行：仅将原uq_task_iteration换为包含规范化父作用域的uq_task_scope。没有新增业务列/状态/表；MySQL函数索引的内部实现不作为业务字段使用。历史已完成行保留；旧活动Prepared不做双格式兼容/热升级，已有版本或镜像也不会被脚本原地覆盖。

与Kestra相同：item作用域、按item组限并发、显式输出、父循环屏障。当前Kestra Loop通过独立子Execution和事件聚合；本项目有意复用已有TaskRun动态作用域，当前需求不引入子Execution和第二套状态机。Kestra还支持Map/URI流、更多输出存储/失败策略；本批只做有界数组和确定输入顺序。Kestra默认失败即传递父失败，本批有意等待已接纳组收尾后失败，防止执行终态后遗留本批远程工作。
