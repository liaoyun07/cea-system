# VER-FLOW-DEP-01

2026-10-18；接入已部署并完成真实流程验证。创建、重复执行、上游地址绑定、配置更新与数值正确性通过。60秒正式单轮端到端 **2.209357 GB/s**，6199批全部成功，2202次计划到达未发出；约3GB/s目标未达到，未证明多轮稳定性。

环境：Windows/PowerShell、JDK21；源码基于 `4037fd9` 加本批变更，原未提交功能保持。目标仅CEA backend/frontend与本批服务部署；经用户批准补充四集群既有Service规则的update权限。

## 本批验证

- 72项前端单测、生产构建、结构检查通过。
- 完整 `scripts/verify.ps1`：runtime51项通过，server277项仅 ContractTest 的 Task.deployment 文档字段缺漏失败，其余276项通过（含65项真实Registry/Kubernetes/Job测试）。修正OpenAPI后，16项相关测试与打包JAR启动测试复验全部通过；同时新增取消后保留资源及当前rollout就绪测试。日志为 `.local/flow-dep-verify-2.log`、`.local/flow-dep-verify-final.log`，不将首次整套失败记录写成一次全绿。
- 只发布 backend/frontend，两旧镜像已标记 `cea/backend:before-flow-dep01`、`cea/frontend:before-flow-dep01`；后端健康，新schema及实际页面可用。没有新增数据库迁移。
- 页面创建 `verify-deployment-editor` 草稿，保存/回读、契约选择、资源字段和真实流程上游 endpoint 显示通过；未执行草稿。截图/记录位于 `.local/cea/flow-dep-01-20261018/`。
- 应用 `hydraulic-resident / flow-v1` 使用原HC20镜像，只加入固定reference.npz。四集群本批命名空间 `cea-lab-flow-dep01`，NodePort31101。
- 真实Flow `hydraulic-resident-services` r1：执行 `b7ff5ce0-30a4-410b-8f65-9f2806659914` SUCCESS，中心先部署、边缘三任务并行；三边缘实际CLOUD_URL等于中心输出。
- 同r1重复执行 `7517ec4b-d962-49e6-ae8b-b10d06f25fbb` SUCCESS；四Pod UID保持。
- 权限修复后，安全的Kubernetes公开错误原因会保留在任务失败信息；新增单测。17项相关Java测试及打包JAR启动测试通过，日志 `.local/flow-dep-permission-verify.log`。只重发受影响backend，保留 `cea/backend:before-flow-dep01-rbac` 回滚镜像，前后端均健康。
- 提交前另从 `4037fd9` 加本批34文件生成隔离副本，排除无关未提交功能：38项相关Java测试、1项打包启动、67项前端单测、前端构建与结构检查通过。首次前端检查因沙箱拒绝依赖目录连接而缺包失败，获得执行许可连接现有依赖后通过；没有改依赖版本。日志在 `.local/flow-dep-commit/`，完整工作树72项与隔离副本67项不是同一测试集合。

## Service更新失败与授权修复

r2尝试把中心命令显式设为原镜像命令，并将Service port从8080改为8081（targetPort8080、NodePort31101不变）。执行 `fc3e7fda-83e4-4842-b7d2-29b98fd53584` FAILED：Deployment已经更新，Service保持8080。失败记录和新旧Pod证据保留，未重跑原标签。

当时四集群 `kubectl auth can-i update services -n cea-lab-flow-dep01 --as=system:serviceaccount:cea-lab:cea-backend` 均为no；`cea-observe-nodes` 的Service规则为get/list/create/delete。新putService使用update，旧RBAC缺少这一项，故暂停并请求用户批准，没有绕过业务账号写Service。

用户批准后，仅在四个既有ClusterRole的Service规则追加update；原RoleBinding、其他规则与应用工作空间/命名空间/受管对象校验保持，四次can-i均yes。声明同步 `deploy/cea/rbac.yaml`，前后快照在 `permissions*.json`。

对同一r2提交新执行 `b0defea3-a098-4f1d-8afa-2309be5c30d5`，SUCCESS，约2.2秒；Deployment/Service UID保持，中心Service port实际8081、targetPort8080、NodePort31101。原失败执行不覆盖。完整2205周期/17传感器的90数组核验PASS，实际资源为每服务2核、中心1GiB、三个边缘各2GiB。

## 端到端测速

复用HC20协议：128周期一批（末批29），32VU、目标140批/s，k6限7核5GiB；不提高WSL或业务资源。按成功校验的原始信号字节计一次，除以首次HTTP发出至最后结果校验的跨度，包括上传、边缘计算、转发、中心融合及结果取回，不含镜像准备或部署启动。

| 轮次 | 成功/失败批次 | 原始字节 | 完整跨度 | 实测GB/s | 漏发 | 迟发 |
|---|---:|---:|---:|---:|---:|---:|
| probe，10秒 | 683 / 0 | 14,634,721,920 | 10.080秒 | 1.451857 | 717 | 3 |
| measure-01，60秒 | 6199 / 0 | 132,685,163,520 | 60.056秒 | 2.209357 | 2202 | 0 |

`measure`标签在提交负载前被残留Terminating探针Pod拦截，没有创建该轮负载Pod或发送请求。保留 `measure/preflight-blocked.json`，修正成功后的删除等待并确认Pod消失后，以新标签 `measure-01` 进行唯一正式轮次；不把未开始的轮次计为成绩或重跑失败业务请求。

正式轮平均每批229.196ms，P95 407.1ms、P99 547.02ms。名义8400到达，边界采样观测8401时隙，6199发出＋2202漏发；客户端/三边缘/中心的批次数及字节量一致，全部结果校验通过。无OOM或宿主停止事件，但存在明显换页；不能把目标2.996448GB/s、零业务错误或单轮超过2GB/s解释为3GB/s容量或稳定承载所有计划请求。

## 最终现场

`.local/cea/flow-dep-01-20261018/audit.json` PASS：33个原CEA容器只允许backend/frontend发布替换，其他31个保持；四集群47个旧Deployment/Service/HPA对象的UID与spec保持。负载Pod为0，四个本批业务服务保留供页面管理。未改数据库结构、WSL限额或旧服务。运行证据含配置、权限、执行、正确性、探针、正式请求/宿主记录及审计，未上传凭据或原始数据集。
