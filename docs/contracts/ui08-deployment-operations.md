# UI-08 镜像、部署与用量协议

范围：在原Controller和业务服务上增加7个HTTP操作，不增加Execution/Worker/Binding/Runner。API字段以[OpenAPI](openapi.json)为准。鉴权继续使用命名空间及READ/WRITE，路径不能指定任意仓库地址、kubeconfig或Kubernetes namespace。

## 按需分发历史

`GET /applications/{id}/versions/{version}/preparations?limit=20&offset=0`。

复用ImageDistributionService的prepare/prepareForExecution路径：有效注册和白名单检查后、实际Skopeo inspect/copy前写RUNNING，源digest及目标引用确定后写入记录，目标digest核验成功才写SUCCEEDED。失败为FAILED，线程中断为UNKNOWN；进程退出等没有终态的记录在超过3次Skopeo超时+15秒后查询投影为UNKNOWN。API为分页只读，不重试或重新分发。layer复用不意味着完整镜像重新传输，不虚构传输字节；本批没有旧历史回填。

V18新增`dep_image_distribution`：namespace用于隔离，应用/版本/集群用于详情过滤，requested_by展示发起人，source_image/target_image用于回查真实目标，state/start/finish/error用于结果和耗时，deadline_at识别中断后未确认。目标镜像引用已包含Registry digest；不重复保存无单独消费者的digest列。消费方为原分发服务及历史接口；没有额外hash、会话或队列表。

## 镜像归档上传

`POST /applications/{id}/versions/{version}/upload`，multipart的`file`为单镜像Docker save tar，`contract`为application/json：`{"parameters":{...}}`。不接受客户端镜像地址。先验证新版本和参数契约，导入受控namespace中心仓库，以唯一临时tag避免并发覆盖，验证digest后通过原目录服务登记`registry/namespace/application@sha256:...`。不运行镜像/归档脚本，不做在线构建，不新增上传表。

默认文件2 GiB，Spring请求上限2050 MiB，磁盘暂存，导入并发2。并发限制作用于服务导入阶段，不是全站HTTP流量限制；仅开放给已认证WRITE用户。Java不解压归档，Skopeo负责Docker archive协议校验。成功、协议失败或长度不符都清理本次暂存文件；进程崩溃残留需维护窗口清理。Servlet接收和导入可能同时各占一份文件空间，需要部署磁盘余量。上传HTTP失败/断线不能推断数据库一定未写，应查询该版本后决定下一步，不自动重试覆盖。

Registry与MySQL不是分布式事务：导入成功但登记冲突/DB故障/进程退出时，仓库可能保留未引用的唯一tag。当前不自动删除Registry内容，不声称已实现镜像GC。Spring超限413，服务尺寸/契约422，已存在版本/并发忙409，Skopeo失败502；错误不回传凭据和完整stderr。

## 常驻部署配置与计时

- 原PUT创建/更新仍使用完整受支持配置：应用版本、参数、command、显式replicas、HTTP readiness path/port；原resourceVersion用于CAS。
- `GET /clusters/{cluster}/deployments/{name}/configuration`读当前Kubernetes配置，仅回传契约内参数与受支持字段；托管参数如果为Secret/ConfigMap引用或不支持的探针，拒绝回读编辑，不展开凭据。
- `PATCH .../{name}/scale`仅接收显式replicas（0..100）和resourceVersion。没有replicas不是0。保留Pod模板、资源限制、sidecar、标签、非托管env等；不重新准备镜像。禁用集群可缩容不能扩容。
- `GET .../{name}/history`分页返回CREATE/UPDATE/SCALE。删除Deployment后同命名空间仍可查历史。

更新克隆当前Deployment，只替换托管容器的应用镜像/参数/command/可编辑探针。非托管环境变量、资源限制、挂载和sidecar保留；不重建整份Pod配置。完全相同的受支持配置是no-op，不创建操作记录。Kubernetes resourceVersion也可能因控制器写status变化；发生409时用户重新读取，不由后台无条件覆盖或偷偷重试。

如果只更换应用版本注解、实际Deployment spec未变，记录配置操作但不给有效部署耗时；不能把无需滚动的元数据修改计成快速部署样本。[Kubernetes 1.30的更新策略](https://github.com/kubernetes/kubernetes/blob/v1.30.3/pkg/registry/apps/deployment/strategy.go)也会因Deployment注解变化递增generation，因此不能仅凭generation改变判断发生了部署滚动。

计时起点为业务检查通过、分发前；终点为后台首次观察同UID/generation满足：observedGeneration已到本次版本，updated/ready/available/总replicas均等于目标。默认每秒观察，部署截止10分钟；包含本次分发/拉取/调度/启动/就绪等待，不含提前完成的构建上传。没有探针时仅表示容器Ready，有HTTP探针时还验证该HTTP就绪条件，不自动证明业务效果。

仅SUCCEEDED、正副本数、有效连续观测给durationMs；观测间隔>5秒、查询失败或时钟回退使计时永久失效但仍可继续确认结果。旧进程恢复不重放提交；PREPARING超期/结果无法确认显示UNKNOWN。删除/重建或generation被后续变更替代显示SUPERSEDED；ProgressDeadlineExceeded为FAILED。缩到0可成功，但无有效耗时。30秒是申报书目标，前端只比较有效CREATE/UPDATE；SCALE单独展示，不冒充部署指标。观测值含正常轮询/接口时延，不是容器内部精确时间戳。

V19新增`dep_deployment_record`的真实消费者：应用/集群/名称/operation/replicas用于历史归属与展示；UID/generation用于拒绝串计；start/finish/last_observed_at/deadline_at/timing_valid用于计时连续性与超期处理；state/error用于展示确认结果。它不是期望配置副本、任务队列或新的执行状态机。没有恢复apply的职责。

## 近期CPU/内存用量

`GET /clusters/{cluster}/kubernetes/usage/nodes`、`GET .../usage/pods`，只读Metrics API。node为注册集群范围，pod严格限配置namespace（RBAC同样限制）。CPU为采样窗口平均核数，memory为working set字节；保留采样timestamp/window（ISO-8601时长，如PT15S）。超过120秒为STALE，时间超前>10秒或窗口无效为INVALID，缺失为MISSING；不可用字段为null而不是0。

节点百分比=用量/capacity；集群=全部节点用量之和/全部节点capacity之和，任何节点缺样不返回全量百分比。不平均百分比，不跨四个同宿主K3s相加。容器只有明确limit才给相对limit的百分比，无limit仅展示用量。指标读取不参与Placement、不入时序库、不做告警，也不是申报书“系统开销”的验收。

CEA K3s1.30对应metrics-server0.7.x；清单为官方v0.7.2发布配置，使用[Rancher的上游镜像映射](https://github.com/rancher/artifact-mirror/blob/master/config.yaml)。本地自签Kubelet使用insecure-tls，不能原样当互联网生产TLS方案。需显式安装采集器和更新RBAC；不因后端启动自动安装。官方用途和精度限制见[Metrics Server](https://github.com/kubernetes-sigs/metrics-server)。
