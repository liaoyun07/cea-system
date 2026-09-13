# EP-02 处理记录查询

`GET /api/namespaces/{namespace}/edge/processing-records?policyId=surface-cloud&state=SUCCESS&limit=20&offset=0`

使用人员认证，要求该namespace的READ。policyId/state可省略；limit 1..100、offset 0..1000000。按原Execution的createdAt DESC、id DESC排序，筛选先于分页。返回数组；没有匹配项为[]；非法状态400、非法ID/分页422、未认证401、越权403。未知策略ID返回[]。

每行：`{ execution: <既有Execution响应>, eventType: string, origin: {terminalId,gatewayId,clusterId} | null }`。

execution不是新状态副本：即时读取原表，其内部Flow定义不返回；定义、任务、尝试和产物继续用`/executions/{id}`相关API。origin来自原接入回执与不可变归属，clusterId仅来源边缘，不是Placement结果。没有回执时null，不根据caller inputs猜测。eventType来自不可变策略路由；停用策略不影响已接受工作和历史。

没有新DB migration、存储数据或上传接口。普通USER流程不包含，即使由终端发起；已逻辑删除的Execution不显示。该接口不证明原始文件仍存在、执行完成后终端已经领取结果或中心已经完成其他独立业务。
