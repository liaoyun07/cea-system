# EP-02 边缘处理记录

范围：用户2026-09-13要求补边缘数据处理记录展示，测试后同步部署。依赖EP-01现有策略运行，不重复运行演示或引入第二套处理状态。

## 实际行为

- 主导航“边缘与终端 → 边缘处理记录”；按策略、Execution状态筛选，每页20条，手动刷新。
- 显示策略ID/实际修订、事件类型、执行ID、来源终端/网关/边缘、状态、提交/开始/结束时间及执行耗时。没有开始/结束不计零；耗时是Execution区间，不是算法计量或传输速率。
- “详情与结果”复用ExecutionDetail，原概览/拓扑/任务实例/日志/Metrics/输出，不新建产物查询或下载路径。返回保留页码与筛选，并刷新状态。
- 包括停用策略历史，修订/输入/输出/状态取执行快照；不混入普通USER Flow或已逻辑删除的执行。未命中返回空列表，故障显示错误而不是暂无记录。
- 来源取edge_submission及不可重新分配的终端/网关归属，不信任inputs中自报terminal/cluster。没有接入回执时显示“—”，不推测。
- 来源边缘不等于最终执行位置，也不代表结果已交付终端。实际执行与输出沿现有详情查看；不硬编码三示例的去向或假造送达状态。
- 本页记录已经生成Execution的处理；上传失败、事件在接入阶段被拒绝而没有Execution的请求不在本页，不虚构补录历史。

## 架构与边界

`EdgeProcessingPage → GET edge/processing-records → EdgeAccessService → FlowExecutionService.listForFlows → ExecutionService → JdbcExecutionStore`

Edge读取本模块策略和接入归属；runtime仅按传入flowIds/namespace/state查自己的执行表，SQL筛选后排序分页，不知道EDGE_POLICY或edge表。每页最多100条，再按回执补来源（有界点查）；没有跨模块Repository/表访问，没有新的全表前端扫描。

7个既有Java文件增加只读方法/3个响应record，新增1个GET；没有新Java文件、表/列、SPI、缓存、状态所有权或调度变化。DB仍V24。所有返回受namespace READ约束，CONNECT机器账号不能查询管理记录。

## Kestra参考

本地源码`D:/Project/Kestra/kestra`，commit `0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4`，`ui/src/components/flows/FlowExecutions.vue`将namespace/flowId交给通用Executions组件，而非另建执行模型。本项目同样复用Execution与详情；跨策略列表和终端/网关来源是云边端需求差异，不复制Kestra完整查询系统。

## 验收

EdgeAccessTest新增3项：真实事件状态与输出/修订、服务器筛选分页、普通Flow排除、停用/删除、取消、无来源、鉴权与Namespace隔离。浏览器新增2项：21条真实记录分页/只读用户/历史结果/筛选/桌面390px，真实失败与查询503恢复。全量验证与发布事实见[验证记录](../verification/VER-EP-002-processing-records.md)。
