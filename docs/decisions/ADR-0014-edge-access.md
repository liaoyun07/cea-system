# ADR-0014 网关接入与策略管理边界

日期：2026-09-10。状态：接受，S5-03已按最小范围验收。基线1769cbe。

## 决定

- platform-edge通过platform-dataflow公开FlowService/FlowExecutionService调用现有提交链；增加此单向依赖，不访问对方Repository/表。
- 策略保存需要WRITE，启用策略还需EXECUTE，与既有Schedule激活权限一致。删除失去消费者的旧Repository.save四参包装，不保留兼容入口。
- Flow head的management_scope区分USER/EDGE_POLICY，普通列表、编辑、提交不能绕过策略管理；定义和修订仍只有wf_flow_revision。策略保存作者完整Flow，不生成模板或第二套Binding。策略Flow不得启用Schedule，避免绕过策略启停。
- edge拥有gateway、terminal、policy、submission四表。gateway绑定外部认证账号及已有EDGE集群，terminal固定归属网关；enabled负责准入，last_seen_at展示最近联机时间，不持久化推测的在线状态。
- 网关账号仅CONNECT权限，管理账号仍READ/WRITE/EXECUTE。核对账号、命名空间、注册网关、终端、集群启用状态后，在受限服务边界内提交。CONNECT不能替代普通API的READ/EXECUTE。
- 终端可提交本命名空间USER Flow（可以多节点）；事件按clusterId/eventType匹配唯一策略。输入为Flow显式Inputs，不自动注入或猜测参数。文件仍由现有资源/文件协议管理，接入请求不是文件上传协议。
- submission仅保存接入请求幂等键、原始请求hash和Execution关联，不复制状态/输出。它和runtime请求hash分别服务“原始事件”和“解析后的Flow提交”；前者保证策略编辑后重复请求返回原Execution，后者沿用runtime现有提交接口。锁定终端行，回执和Execution/消息在同事务提交。
- 网关正常轮询指定Execution，校验终端归属，返回真实状态/outputs/error。无推送、ACK、离线补发、恢复会话或新结果队列。本批是后端网关协议，不部署硬件网关/终端代理。

## 参考及差异

本地Kestra提交0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4，参考webserver/src/main/java/io/kestra/webserver/controllers/api/ExecutionController.java的createExecution：入口先取可执行Flow，再进入统一Execution服务。执行状态属于引擎，不属于触发入口。

网关/终端归属及策略范围是云边端业务差异；cluster/eventType单策略匹配与主动结果查询是有意简化，不复制完整Trigger插件，不提前实现S6 Webhook。旧系统EdgeGatewayService/EdgeDataPolicyService仅用于业务参考，不迁移启动建表、模板生成、状态复制和断线ACK。

## 验收

真实MySQL/HTTP测试注册、心跳、权限/归属、管理隔离、多节点执行、结果、幂等/并发、编辑/停用、坏输入回滚及全量verify。S5-04卸载与S5-05计量不在本批。
