# S6-02至04：文件、Webhook、Checks、SLA与后处理

范围与取舍见[ADR-0019](../decisions/ADR-0019-s6-files-lifecycle.md)。[OpenAPI](openapi.json)是HTTP字段事实源；仍只有FlowDefinition/Binding/Execution/TaskRun/Attempt与原Executor/Worker。

## Namespace Files

适合小型UTF-8脚本、配置，不代替DatasetVersion或S3二进制产物。

- `POST /api/namespaces/{namespace}/files`：WRITE，`{path,expectedRevision,content}`，首次expectedRevision=0；成功201，每次追加不可覆盖修订；冲突409。
- `GET .../files`：READ，limit/offset分页，返回path和最新revision。
- `GET .../files/revision?path=scripts/run.sh&revision=1`：READ，精确版本内容。缺失404。
- path为本命名空间相对路径，≤200字符，不允许空段、`.`、`..`、绝对路径或反斜杠。单文件≤65536 UTF-8字节。
- 不提供删除/覆盖旧版本，以保证已保存Flow及已提交执行仍可复现；历史版本通过版本号读取，目录列表只给最新版本。

Application中的实际消费：

```yaml
container:
  applicationId: shell-tools
  version: v1
  candidateClusters: [edge]
  command: [sh, /cea-work/in/work.sh]
  namespaceFiles:
    work.sh: {path: scripts/run.sh, revision: 1}
```

`namespaceFiles`与原`inputFiles`共享本地命名空间，总数≤30、禁止重名；namespace文本总量≤256KiB。固定revision已进入Flow/Execution快照，不接受latest。Runner按执行身份EXECUTE权限读取本命名空间文件，在资源预约/远程派发前确认内容，再保存到原Prepared.inlineFiles；接管读取原Prepared，不重新取最新文件。文件名与原容器文件协议一致，固定落在`/cea-work/in/`，不会把路径直接传给宿主Shell。缺文件明确失败，不创建远程Job。容器本身是否具备sh/python由Application契约/镜像负责。

## Checks和Webhook

```yaml
inputs:
  count: {type: INTEGER, defaultValue: 2}
checks:
  - when: '{{ inputs.count > 0 }}'
    message: count must be positive
webhook: true
```

when复用现有Pebble表达式；上下文仅inputs/vars，必须渲染为`true`，false/非布尔/未知引用均阻止执行。message为1..1000字符，最多30项。Flow保存验证语法/结构，不要求所有输入已知，也不会因某组默认值不通过而禁止保存；preview验证当前输入及Checks，所有首次提交在ExecutionService持久化之前再次检查。

普通HTTP、Webhook、终端请求、边缘策略和Cron均走这个门禁。失败返回422且无Execution/接入回执；可修正后沿用尚未成功的请求键。Cron的失败检查消费本次触发并推进下次时间，记录服务日志；不创建占位失败Execution，不让不通过的定时任务永久堵塞Scheduler。已接受请求的相同键重投直接返回原执行，不根据新版本重新执行Checks。

`POST /api/namespaces/{namespace}/webhooks/{flowId}`，Basic认证，namespace EXECUTE，USER Flow明确`webhook:true`。JSON正文就是显式Flow inputs，不转发headers/URL参数，不新增trigger Binding。必须带1..120字符Idempotency-Key；返回202 Accepted。Webhook使用原执行表的`webhook:`键前缀，禁止普通提交使用此前缀；同键不同内容409，不同Flow使用同一键也冲突。不存在匿名URL密钥或第二套触发队列。

## SLA

`sla: {maxDuration: PT30S}`，范围PT0.001S..PT24H。从startedAt到主执行最终endedAt（含Errors/Finally），不含排队和afterExecution。原Executor使用数据库时间检查，首次观察超限写`slaViolatedAt`；执行查询可读取，后处理可读`execution.slaViolated`。这是超时告警，不是取消/强杀，也不是算法计时或数据速率；轮询存在约100ms及实际执行负载造成的检测延迟，不承诺实时告警。

## afterExecution

```yaml
afterExecution:
  - id: notify
    type: core.Log
    message: 'result={{ execution.state }}, sla={{ execution.slaViolated }}'
```

在主任务→Errors（失败时）→Finally结束之后，先持久state/outputs/endedAt并释放Flow并发名额，再通过原持久消息运行afterExecution。包括主失败、取消、准入FAIL、QUEUED取消；未通过Checks而未创建Execution的不运行。

后处理TaskRun.phase为AFTER_EXECUTION，支持原控制任务、retry、timeout及同Attempt租约接管。顺序顶层后处理在某项失败后仍尝试后续项；控制组内部保持原失败语义。不增加afterState/error汇总字段，查询TaskRun/Attempt/logs即可确定是否处理完或失败。Flow主结果不等待后处理，终态取消不终止后处理；需要有界后处理应给叶子配置timeout。外部副作用仍受原Runner语义约束，不承诺任意HTTP POST exactly-once。

上下文增加`execution.state`、`execution.outputs`、`execution.error`、`execution.slaViolated`。后处理也可引用已成功任务的outputs；失败/跳过任务无输出，引用将正常失败。主Flow outputs不能反向引用afterExecution。后处理不改变主state/outputs/endedAt/error/cleanupError；其远程任务仍受同一个Resource槽位约束。

## 数据及升级

- V16/dataflow：新增`df_namespace_file(namespace,path,revision,content)`，主键用于CAS，revision/content由Runner和文件API读取。无无消费者hash/metadata字段。
- V17/runtime：增加`wf_execution.sla_violated_at`供查询/告警上下文；将既有`wf_task_run.phase`扩大到20字符以保存AFTER_EXECUTION，无新增后处理表或第二套Execution状态。
- 总计V1–V17、23业务表。停机升级新后端前，排空主执行及未终态的afterExecution TaskRun、停止所有角色，备份专用数据库；不允许新旧进程混跑，不迁移旧web-platform数据库。
- 本批新生产类只有NamespaceFileService、NamespaceFileController、WebhookController；无新Binding/Runner/SPI或模块依赖。

示例：[生命周期](../../examples/s6-lifecycle.yaml)、[文件消费](../../examples/s6-namespace-file.yaml)、[HTTP调用](../../examples/s6-files-webhook.http)。完整验证记录见[VER-S6-002](../verification/VER-S6-002-files-lifecycle.md)。
