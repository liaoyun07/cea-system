# UI-01/02/03 前端对接边界

UI-06增量：执行Metrics新增GET `/executions/{id}/tasks/{taskRunId}/output-json?port=文件名`，返回已发布的JSON对象；平台按READ权限、固定修订声明和成功TaskRun/Attempt验证，256KiB上限。页面只展示有限数值及字符串/布尔标签，实例上下文/完成时间来自原TaskRun。无新上报/计量逻辑；现有API共52个。见[完整边界](../features/UI-06-execution-metrics.md)。

独立Vue前端通过同源`/api/namespaces/{namespace}`调用52个操作中的子集；UI-06只新增上述只读JSON输出接口，无旧DTO或第二套响应包装。

UI-02使用同一source作为唯一事实源：`GET /flows/editor/schema`提供结构字段；Document路径编辑只更新用户修改部分；TASK_OUTPUT与ITEM下拉仅作结构作用域提示，服务端仍负责权威校验。No-code不持久化画布、alias或第二套binding，不自动派生输入。

- No-code目录选择：GET `/applications`、`/resources/clusters`、`/resources/datasets`，均按原limit/offset读取所有页。ApplicationVersion契约提供参数type/required/defaultValue/choices/DatasetRule，只提示默认值，不自动增加Flow参数。No-code内不登记资源，UI-03专属管理页承担登记。
- 修订：GET `/flows/{id}/revisions?limit&offset`；GET `/flows/{id}?revision=N`；POST `/flows/{id}/rollback`，body `{expectedRevision,targetRevision}`。回退创建新修订而非覆盖历史；409不强制重试。
- No-code覆盖当前11种Task及既有生命周期/输入/变量/输出字段；offload研究配置保留YAML编辑，不扩展卸载语义；任务ID改名由作者在源码同步核对引用。缺失目录、非法文档或未支持字段不以伪造选项/删除字段处理。

- 模板：GET `/flows?limit&offset&q`；GET `/flows/{id}`；POST `/flows/{id}/validate`，body `{source}`；POST `/flows/{id}/revisions`，body `{source,expectedRevision}`。
- 编辑器保留原source；切换/关闭前提示未保存变更；409不自动提升expectedRevision重试。
- 运行：从已保存definition.inputs展示STRING/INTEGER/NUMBER/BOOLEAN/OBJECT/ARRAY；默认值显示并可显式选择是否提供，未提供字段不进入JSON。OBJECT/ARRAY编辑JSON。POST `/flows/{id}/preview`检验本次输入，但不承诺外部资源可用。
- POST `/executions`：固定`{flowId,revision,inputs}`与`Idempotency-Key`。结果未知时保留请求供重试，不能自动换键再次启动。凭据与未决请求均不跨页面刷新持久化，离开前告警。
- GET `/executions`、`/{id}`、`/{id}/tasks`、`/{id}/tasks/{taskRunId}/attempts`、`/{id}/logs?afterId&limit`；POST `/{id}/cancel`。日志增量分页和有限显示窗口；任务实例用TaskRun.id区分，显示iteration/parent/phase。
- 主SUCCESS/FAILED/KILLED与AFTER_EXECUTION状态分别展示；主终态后继续查询任务直到全部后处理终态。
- HTTP错误保留code/message；401/403不静默忽略。Basic只有内存会话，退出清空。开发通过Vite proxy，发布通过Nginx同源代理；不是新认证系统。

## UI-03 管理操作

- 应用/集群/数据集/网关/终端/策略/卸载样本列表：各自原目录GET，limit=20分页；选择器按limit=100读取至末页。失败不是空目录成功，离开停止旧页请求。
- 应用版本：PUT `/applications/{id}/versions/{version}`。表单生成原ApplicationVersion，仅image和parameters，不生成Flow Input。新版本或同内容重放；冲突不覆盖。POST同路径`/preparations/{clusterId}`等待真实PreparedImage，不伪造分发历史；长操作最多等10分钟，代理/网络提前失败仍明确为未知结果。
- 集群/数据集：原resources PUT；数据集版本不可覆盖。集群enabled仅是准入，不显示为在线。无需新字段。
- 网关/终端：原edge PUT，只提交登记字段，不把lastSeenAt回传。已有记录的归属字段只读；停用不是取消Execution。CONNECT账号必须外部预配置，UI不提供密码登记。
- 策略：GET `/edge/policies/{id}`读PolicyView及Flow source/revision；PUT携带`{clusterId,eventType,enabled,expectedRevision,source}`。YAML/No-code编辑同一source，不用USER保存/执行API。校验复用Flow validate并提示Schedule禁止；保存负责路由/权限/修订原子校验。
- Deployment：GET集群列表/详情；PUT创建只传显式应用、版本、副本、parameters、command，不传resourceVersion且不自动覆盖已有资源。DELETE使用详情读到的resourceVersion；409要求用户重新读取，不自动刷新重试。202后刷新列表，区分请求接受和资源消失，不声称Pod全部退出。
- 卸载观测仅GET `/offloading/samples`，显示原数据和关联Execution，不调用模型写入/训练；没有扩大DQN范围。

无账号管理、完整Node/Service/Namespace管理、完整Kestra插件/画线/局部重跑、监控大盘、跨执行指标趋势、全局产物浏览下载或旧DTO兼容。对象存储访问不通过向浏览器暴露凭据实现。UI-08补Deployment配置回读、CAS编辑/手动扩缩容与就绪计时，以及镜像上传/按需分发历史/近期CPU内存，具体以[增量协议](ui08-deployment-operations.md)及其验证/发布状态为准。
