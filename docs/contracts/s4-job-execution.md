# S4-03 一次性 Application 任务

S5-02b增量：candidateClusters支持同一Binding（静态数组解析为Literal），inputFiles支持URI数组及平台生成的本地清单。准确字段/恢复语义见[Loop协议](s5-loop.md)，以下单文件语义仍适用。

已实现并验收，范围以[进度](../04-progress.md)及[验证记录](../verification/VER-S4-005-external-task-runtime.md)为准。没有新增HTTP路由；通过既有Flow保存、提交、查询与取消API运行。

## 唯一事实源

Flow作者显式写 `type: platform.Application`、`timeout` 和 `container`。容器包含 applicationId、version、candidateClusters、command（argv）、parameters（既有Binding）、inputFiles（文件名到既有Binding）、outputFiles（文件名列表）。参数支持INPUT、VARIABLE、TASK_OUTPUT、LITERAL；应用契约校验类型/required/default/choices/DatasetRule，但不生成Flow Input。

省略的应用参数使用契约默认值。非空标量按原参数名注入环境变量。数据集参数P的值为`datasetId/version`，系统验证允许范围和目标集群位置，另外注入`P_PATH=/cea-work/in/dataset-P`。该路径是已下载的数据文件，不是MinIO地址。显式参数或输入文件与这个系统生成名称冲突时拒绝运行，不默默覆盖。

命名输入文件位于`/cea-work/in/<name>`，声明的输出须由命令写到`/cea-work/out/<name>`。名称仅允许字母起始的字母/数字/._-，不允许目录穿越；不解压用户压缩包。下游TASK_OUTPUT引用得到S3 URI，系统下载到下游输入文件。保存时拒绝引用未来顺序任务、无依赖的并行兄弟或未声明输出；DAG必须显式dependsOn。If分支产物不保证存在，不隐式补依赖或绑定。

Linux镜像必须包含`/bin/sh`、`tar`、`sleep`和基本文件命令，启动argv显式指定；当前不支持Windows/distroless。镜像不需要平台SDK或对象存储密钥。命令只在Pod中执行，不在Worker宿主执行。无宿主挂载、自动ServiceAccount token或额外Linux capabilities；Job工作目录为EmptyDir。本阶段不承诺敌对多租户沙箱，管理员仍应限制可注册镜像与Kubernetes资源。

## 调用与故障语义

FlowExecutionService → Executor派发 → Worker租约 → ApplicationTaskRunner解析既有Binding/契约 → resource观测/预约 → deployment准备digest镜像 → 持久prepared_json → KubernetesJobRunner创建或接管固定Job → 后端收集并发布产物 → 持久Worker结果 → Executor归并。

- 选址检查真实Ready且可调度的节点和数据集本地性；原子预约配置的**平台Job槽**，不是CPU/内存物理预约，不使用卸载DQN。无槽等待同Attempt，占用任务timeout，不消耗业务重试。
- Job名`cea-<taskRunId>-a<attemptNo>`；backoffLimit=0/restartPolicy=Never。Pod中的包装命令等待输入传完才启动业务命令，结束后等待产物收集。业务失败按Job失败处理；缺少输出明确失败。
- 同Attempt重连读取prepared_json，不重新解析镜像tag或挑选位置；租约丢失仅停止本地操作，不删除远程Job。网络/存储结果不明时保留同Attempt待接管，不伪造失败后立即重跑业务。
- 取消/超时持久请求停止；Worker设置Job suspend并等Pod结束/消失，再释放名额并返回。Finally和业务重试不能跑在旧Pod仍活动时。保留suspended Job防止迟到create重新启动。Job保留策略当前由运维管理，不自动删历史。
- 这是Job身份接管，不是任意外部业务的exactly-once保证；强制删除Pod/Job、节点永久失联和外部手工篡改不在已验收的Worker重启范围。不得删除仍需接管的Job。
- 所有输出发布成功并确认Job结束才返回成功；中途部分上传不成为有效Task输出。S3键包含namespace/execution/taskRun/attempt/name；共享artifactBucket仍限制namespace前缀。存储URI不是公开下载授权，读取仍使用后端配置身份。

## 配置与权限

沿用[镜像/部署配置](s4-image-deployment.md)中的显式Kubernetes连接和Registry，不读取默认kubectl上下文。新增示意（实际值由管理员提供）：

```yaml
platform:
  jobs:
    slots:
      lab:
        edge: 2
    storage:
      lab:
        endpoint: https://s3.example.invalid
        access-key-file: /run/secrets/s3-access
        secret-key-file: /run/secrets/s3-secret
        artifact-bucket: cea-artifacts
        readable-buckets: [datasets]
```

预先建立bucket，不自动管理用户存储。数据集bucket白名单是namespace级授权；artifactBucket按namespace前缀隔离。凭据只在后端读取，不能写入Flow、公开API响应或Git。

Kubernetes账号新增最小权限：指定namespace的batch/jobs get/list/create/update/patch；pods get/list；pods/exec get/create；集群级nodes list。不能读取其它namespace的任务或管理节点。执行者需READ+EXECUTE，准备运行镜像不要求额外WRITE；单独分发管理API仍要求WRITE。已派发任务的停止/回收不依赖账号仍有效。

## 持久字段与迁移

V8增加wf_worker_job.cancel_reason（停止原因，允许过截止时间后接管清理）和prepared_json（冻结真实执行计划）。V9新增resource拥有的res_job_reservation；namespace/allocation_id定位Attempt，cluster_id保存位置，released控制名额释放。取消发生在选址前允许cluster_id为空的已释放记录，阻止迟到预约。删除这些字段会破坏接管、取消或并发额度验收，不是预留字段。

升级必须排空活动Execution并停止所有旧版本新后端进程；V8拒绝活动执行。无旧模型兼容分支，不操作旧web-platform库。S5速率统计、DQN、Repeat和前端均不在本协议。
