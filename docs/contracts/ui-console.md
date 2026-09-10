# UI-01 前端对接边界

独立Vue前端通过同源`/api/namespaces/{namespace}`调用原51个操作中的子集，没有新API或响应封装。

- 模板：GET `/flows?limit&offset&q`；GET `/flows/{id}`；POST `/flows/{id}/validate`，body `{source}`；POST `/flows/{id}/revisions`，body `{source,expectedRevision}`。
- 编辑器保留原source；切换/关闭前提示未保存变更；409不自动提升expectedRevision重试。
- 运行：从已保存definition.inputs展示STRING/INTEGER/NUMBER/BOOLEAN/OBJECT/ARRAY；默认值显示并可显式选择是否提供，未提供字段不进入JSON。OBJECT/ARRAY编辑JSON。POST `/flows/{id}/preview`检验本次输入，但不承诺外部资源可用。
- POST `/executions`：固定`{flowId,revision,inputs}`与`Idempotency-Key`。结果未知时保留请求供重试，不能自动换键再次启动。凭据与未决请求均不跨页面刷新持久化，离开前告警。
- GET `/executions`、`/{id}`、`/{id}/tasks`、`/{id}/tasks/{taskRunId}/attempts`、`/{id}/logs?afterId&limit`；POST `/{id}/cancel`。日志增量分页和有限显示窗口；任务实例用TaskRun.id区分，显示iteration/parent/phase。
- 主SUCCESS/FAILED/KILLED与AFTER_EXECUTION状态分别展示；主终态后继续查询任务直到全部后处理终态。
- HTTP错误保留code/message；401/403不静默忽略。Basic只有内存会话，退出清空。开发通过Vite proxy，发布通过Nginx同源代理；不是新认证系统。

本批不提供资源注册、用户管理、完整No-code、监控大盘、指标曲线、产物下载或旧DTO兼容层。原始outputs和日志足以检查当前最小执行闭环；对象存储访问不是直接暴露凭据给浏览器。
