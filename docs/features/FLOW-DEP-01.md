# FLOW-DEP-01 服务部署编排

在现有流任务编排中增加 `platform.Deployment`。应用目录仍共用一个注册入口；同一应用版本可以被 Job 任务或服务部署任务引用。

## 操作与语义

添加“服务部署”任务，选择应用版本、绑定参数、选一个目标集群，设置部署名称。可选配置副本数、K8s 命名空间、HTTP 就绪检查、Service 端口及访问地址。容器命令和资源限制沿用 Container 字段；空命令使用镜像默认命令。

任务调用已有部署模块创建或更新固定名称的 Deployment，Service 与其同名并选择该部署的 Pod。重复执行更新同一个对象，不按执行 ID 新建副本。准备信息沿原 Worker 信封持久化，接管后继续等待同次部署。当前修订全部副本就绪后任务成功；未完成时使用已有 timeout/cancel/retry。服务不会随流程结束或取消删除，继续在“边缘服务部署”和“集群资源管理”查看与管理。

`endpoint` 是唯一新增任务输出：有 Service 且配置访问地址时返回该地址，否则为空字符串。与普通任务一样，通过 TASK_OUTPUT 或流程输出传递。地址不等于数据文件，不走文件助手；业务数据由服务通过 HTTP 直接交换。访问地址由用户提供对应 Service 的可达地址，不猜测跨集群外部入口。需要 Ingress 时使用现有集群资源管理配置，本批未再添加一套 Ingress 表单。

只支持应用参数、命令与资源限制；Job 的输入输出文件、命名空间文件、终端卸载不用于部署任务。固定参考数据可封装到镜像；未新增通用卷/ConfigMap 编排。常驻服务消耗不纳入执行结束即汇总的 Job 资源统计。

Service更新使用既有后端账号。四集群原规则缺update，经用户批准仅补这一项；其他权限、绑定及应用范围校验不变。真实Flow `hydraulic-resident-services` 已部署中心与三个边缘服务并验证更新、正确性及单轮端到端2.209GB/s；详见验证记录，不与Job的纯计算速率混用。

## 参考和边界

沿用 Kestra 的有限任务执行、Execution 输出绑定、部署后资源可持续运行的概念。参考官方 [Apply](https://kestra.io/plugins/plugin-kubernetes/kubernetes-api-kubectl/io.kestra.plugin.kubernetes.kubectl.apply) 与 [Outputs](https://kestra.io/docs/workflow-components/outputs)（2026-10-18核查）。有意简化为既有 Deployment/Service 管理 API，不提供任意 YAML Apply；Kestra Apply 原生输出为 metadata，本平台 endpoint 为当前业务需要的输出。没有新建执行入口、工作流状态机或数据库表。

验证见 [VER-FLOW-DEP-01](../verification/VER-FLOW-DEP-01.md)，字段见[协议](../contracts/flow-deployment.md)。
