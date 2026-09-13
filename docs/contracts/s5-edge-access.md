# S5-03 网关、终端与策略协议

后续EP-01已部署独立HTTP网关与终端容器真实上传，见[新增网关协议](ep01-gateway.md)。本文件以下“本批”未部署代理等描述记录S5-03当时的后端范围；原Java API及状态语义不变。

## 边界与实际调用链

管理账号 → edge注册/策略API。网关CONNECT账号 → edge-access → 校验网关/终端归属 → FlowExecutionService → 现有Execution/Executor/Worker → 原Execution结果。

只有一份Flow及Binding。普通Flow与策略Flow共享保存、修订、校验和执行机制，management_scope只决定管理入口；不是DSL字段。普通Flow API的列表不显示策略，普通保存/查询/历史/回滚/提交不能操作策略Flow。策略API保存作者完整YAML/JSON，不生成Java内置模板、不推导参数、不假定单节点。

本批实现后端HTTP网关接入协议，测试网关客户端由真实HTTP请求模拟；没有部署边缘网关进程、硬件代理、MQTT或设备侧认证程序。终端经受信网关转发，后端不接受终端直接伪造gatewayId或principal。未实现终端本地执行/卸载决策；请求来自终端不意味着走DQN。

## 身份与登记

沿用HTTP Basic外部账号配置，无默认网关密码。管理账号有READ/WRITE/EXECUTE；网关账号只能有CONNECT，混合权限配置会启动失败。必须配置网关账号允许的namespace，之后管理账号登记它与EDGE集群的关系。账号示意（真实密码从环境提供）：

```properties
platform.security.users[1].name=gateway-a
platform.security.users[1].password=${GATEWAY_A_PASSWORD}
platform.security.users[1].namespaces=lab
platform.security.users[1].actions=CONNECT
```

所有路径前缀`/api/namespaces/{namespace}`。注册集群沿用[资源API](s4-resource-catalog.md)。本批管理API：

| 方法/路径 | 内容与权限 |
|---|---|
| PUT /edge/gateways/{id} | WRITE；`{clusterId,principal,enabled}`，账号必须已配置且只有CONNECT。cluster/principal不可重分配，同namespace一账号一个网关 |
| GET /edge/gateways | READ；分页，含服务端lastSeenAt |
| PUT /edge/terminals/{id} | WRITE；`{gatewayId,enabled}`；固定网关归属，可启停 |
| GET /edge/terminals | READ；分页，含lastSeenAt |
| PUT /edge/policies/{id} | WRITE，enabled=true另需EXECUTE；`{clusterId,eventType,enabled,expectedRevision,source}`；source的namespace/id必须与路由一致 |
| GET /edge/policies/{id} | READ；返回`{policy,flow}`，flow含完整source及revision |
| GET /edge/policies | READ；仅策略配置的分页列表 |

分页limit 1..100（默认20）、offset 0..1000000。新策略expectedRevision=0，修改必须提交最新revision；配置和Flow修订一起提交或回滚。一个cluster/eventType只能属于一个策略；当前不支持改派网关/终端、修改策略事件路由或物理删除，使用enabled停用。策略不得启用独立Schedule，避免停用策略后仍被定时器触发；多节点/DAG/Repeat/Loop等定义能力不受影响。

## 正常接入与结果

| 方法/路径 | 行为 |
|---|---|
| POST /edge-access/heartbeat | 无请求体；记录认证网关lastSeenAt，返回Gateway |
| POST /edge-access/terminals/{id}/heartbeat | 无请求体；仅所属启用终端，返回Terminal |
| POST /edge-access/terminals/{id}/executions | `{flowId,revision?,inputs}`；提交本namespace的普通USER Flow，可为多节点 |
| POST /edge-access/terminals/{id}/events | `{eventType,inputs}`；根据网关所属cluster/eventType找到唯一启用策略并提交最新Flow修订 |
| GET /edge-access/terminals/{id}/executions/{executionId} | 仅所属终端的执行，返回既有Execution View，包括state、inputs、outputs、error，不复制状态 |

两个提交API均要求`Idempotency-Key`（1..128字符），成功202 `{executionId}`。键的作用域是namespace+terminal，FLOW/EVENT共用键空间；同键同原始请求返回原Execution，同键改内容409。策略改版/停用不会让已接受的重复请求变成一次新运行；新键按当前策略准入。网关/终端/集群被停用后拒绝接入，包括结果查询；此前已提交Execution不被隐式取消，管理员仍可查询或通过原Execution API取消。

输入严格采用Flow自己的Inputs，不自动注入clusterId、terminalId或DATA_PATH，也不创建第二套绑定。事件inputs需要匹配目标策略的声明；错类型/缺必填422，找不到事件策略404，策略停用409。元数据/数据URI可以显式作为输入；真实文件上传和授权仍使用现有数据资源/对象存储协议。结果中的文件URI是引用，此API不代下载二进制文件。

策略clusterId用于匹配事件来源，不强制把全部Task放到该集群；任务候选集群仍由Flow显式声明，可以跨云边执行。不会因请求来自终端就自动调用卸载DQN。

结果由网关在正常连接期间按executionId查询，再由网关交给终端。没有ACK、离线消息队列、终端断线补发/续跑、回调URL或恢复游标。lastSeenAt只是服务器最近收到心跳/提交的时间；不据此伪造ONLINE，也不是调度资源监控。无认证401，权限或归属错误403，他人终端结果404；详见[OpenAPI](openapi.json)。

## 数据所有权和新增字段消费者

- dataflow V12：wf_flow_head.management_scope供保存、普通列表/编辑及提交准入使用。已有Flow迁移为USER；不引入兼容分支。
- edge V13：edge_gateway的principal/cluster/enabled用于身份和集群准入；edge_terminal.gateway_id/enabled用于终端归属/启停；两表last_seen_at在心跳写入、管理列表读取。
- edge_policy的id对应同id Flow，cluster_id/event_type做唯一事件路由，enabled控制触发。无Flow副本、无runtime状态列、无额外策略版本号（编辑比较同一Flow revision）。
- edge_submission保存terminal/key、原始请求hash和executionId，分别用于重复接入冲突判断、固定原执行及结果授权。原始事件hash与runtime已有的解析后Flow提交hash服务两个不同协议边界，不是两个内容校验和。
- 同一终端行锁串行化接入的短事务；保存接入关联与runtime提交/初始消息同库同事务。没有轮询数据库找“待处理数据”的第二个Scheduler；执行失败/重试/取消/Worker恢复仍归原引擎。

新的edge→dataflow依赖只用于公开服务，ArchUnit禁止edge访问dataflow/resource/runtime持久化实现。设计参考、简化原因和限制见[ADR-0014](../decisions/ADR-0014-edge-access.md)。

## 最小验证示例

见[策略Flow](../../examples/s5-edge-policy.yaml)，它只用于接入协议的两节点回显验收，不冒充工业算法。先用管理账号登记edge-a和网关a，再登记terminal-a；将该文件原文作为策略source保存，eventType设为sensor-reading。网关凭据调用：

```http
POST /api/namespaces/lab/edge-access/terminals/terminal-a/events
Authorization: Basic <网关凭据>
Idempotency-Key: reading-001
Content-Type: application/json

{"eventType":"sensor-reading","inputs":{"value":"sample-001"}}
```

得到executionId后查询上述结果API，成功时outputs.result为`processed sample-001`。创建新的读取事件必须使用新键；请求不明时不得盲目换键重复执行。
