# EP-01 网关HTTP协议

OFF-02增量见[终端计算协议](off02-terminal-gateway.md)：新增独立compute入口，不改变本页上传/事件行为；成功terminal_result改经平台已有产物权限链读取，因此支持本次执行的云/边缘JSON，不再限定本网关桶。平台结果API不接受任意URI。

独立网关端口8080，CEA仅映射本机18086。所有业务请求须`Authorization: Bearer <terminal token>`；token映射终端，后端登记检查其归属/启用状态。平台人员Basic账号、S3账号不交给终端。TLS尚未启用，不对公网开放。

| 方法/路径 | 请求 | 成功结果 |
|---|---|---|
| GET /health | 无 | 200，进程健康，不代替依赖健康验收 |
| POST /v1/uploads | 原始文件，单Content-Length，1..64MiB | 201 `{uploadId,bytes}`，边缘存储原子PUT已成功 |
| POST /v1/events | `{eventType,uploadId}` | 202 `{executionId}`，复用原edge-access事件API |
| GET /v1/executions/{id} | 无 | 200 `{executionId,state,result?}`，result仅为成功执行的terminal_result内容 |

网关不接受任意cluster/URI/Flow inputs。对象固定`lab/ingress/<terminal>/<uuid>/data`，同一上传ID作为既有事件Idempotency-Key；同键同事件重试返回原执行，同键改事件由平台409拒绝。未上传、其他终端上传、禁用登记不得提交。上传不自动触发Flow；客户端收据必须先取得uploadId，再发事件。

每次认证接入更新原网关/终端心跳，并校验登记cluster与网关存储域配置一致；域不匹配503。没有另一套在线状态表。终端先验证收据目录可写，上传后先保存uploadId再发事件；请求结果不明时不得换key重复提交，当前不做自动离线重试队列。

错误：400坏请求，401无效token，403归属/登记禁止，404没有所属对象/执行，408超时，409原API幂等冲突，411未知长度，413大小超限，429两路上传槽已满，502存储/平台依赖异常。不把异常当作成功或回退为本地伪结果。

terminal_result限定本边缘桶、当前namespace/execution前缀、.json及256KiB；只返回这个Flow输出，其他产物仅管理员在现有执行页查询。返回轴承诊断不下发执行器/PLC命令。原S5-03后端API及OpenAPI未改变；本文件为新网关协议事实源。
