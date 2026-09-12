# UI-07 只读查询协议

五个GET均要求平台namespace READ；公开字段和参数以[OpenAPI](openapi.json)为准。

## 执行总览

`/api/namespaces/{namespace}/executions/overview?days=7`：days范围1..31，默认7。from为数据库当前UTC日向前days-1天的零点，to为查询数据库时间，过滤created_at属于[from,to)。同一只读查询事务中按日/当前state聚合COUNT，并取窗口内最近10条（created_at、id降序）。days数组为非零的日期/状态桶，页面补零日期；不是当天状态转移次数。成功、失败、取消独立统计，活跃包括CREATED/QUEUED/RUNNING/RETRYING/KILLING。无采集表或缓存。

## Kubernetes资源

`/api/namespaces/{namespace}/clusters/{cluster}/kubernetes/nodes`和`/services`：limit默认50、范围1..100，continueToken为原Kubernetes continue值，不做offset仿真；过期返回409，刷新从首页开始。节点是集群范围；Service只在连接配置namespace内。容量/可分配量是Kubernetes Quantity，不是当前CPU/内存使用率。

`/api/namespaces/{namespace}/clusters/{cluster}/kubernetes/namespace`：只读取连接配置的一个Kubernetes Namespace。平台namespace并不等同于Kubernetes namespace；例如平台lab映射cea-lab。缺失返回404；未配置连接422；上游不可用/RBAC拒绝502且不返回凭据或原Kubeconfig。所有页面不提供资源增删改操作。

CEA部署RBAC仅增加cea-lab中Service get/list及Namespace cea-lab的get，禁止列出所有Namespace、读取其他Namespace或写Service。节点list权限已经存在。应用权限变更须经当次部署授权。

## 产物

`GET /api/namespaces/{namespace}/executions/{id}/output-files`只返回执行不可变definition中容器的任务ID/声明端口列表，包含嵌套/生命周期任务。普通Flow和边缘策略执行均读取同一执行快照，不跨USER/EDGE_POLICY管理入口，也不返回整份源码或读取对象存储。声明与实际TaskRun及其输出一起渲染；没有生成未执行的实例。

内容复用UI-06 `output-json`，不增加任意URL/对象键下载接口。首版只有成功JSON支持内容查看（上限256KiB且为对象），其它产物显示实际URI，不伪称可预览模型二进制。Metrics同样消费output-files后过滤JSON，不改变指标读取原值或计算口径。模型/数据大小、执行速率均不在此查询中推算。
