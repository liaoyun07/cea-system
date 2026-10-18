# 服务部署预热与伸缩历史

部署 PUT 在原字段外接受 `warmPool: boolean` 和可选 `autoscaling: {minReplicas,maxReplicas,cpuUtilization,memoryUtilization,resourceVersion}`。省略 warmPool 创建常规部署，更新保持原类型；不允许改变类型。省略 autoscaling 保留原 HPA，不代表删除。关闭沿用原 DELETE autoscaling。CPU/memory target 是相对 requests 的利用率。预热模式受现有 WarmService CRD 限制，最多20业务副本，必须有内存上限用于预算。

原 configuration 返回 warmPool；原 view 返回 warmPool 和 resources。runtime 对预热返回稳定业务 selector（包含 online=true），不把备用连接到 Service；各 Pod 的 standby 标识用于实例用途列。Service selector 不绑定池修订。应用配置更新更换 poolName，adapter 更换旧 Claim。工作负载类型是创建时的选择，模式之间没有隐式转换。

`GET/PUT .../deployments/-/warm-pool` 查询/更新命名空间预算；available 由服务端授权配置决定，count 为备用实例上限，memoryMiB 为备用内存预算，resourceVersion 执行原有 CAS。

`GET .../deployments/{name}/scaling?since=<ISO时间>` 返回 samples 与 events。默认最近2小时；最多4000条最近采样、500条最近事件。事件包含 fromReplicas/toReplicas、状态、开始/结束、durationMs 与 warmHits。仅成功事件有耗时，仅预热扩容成功有命中数；其他值是 null 而非0。状态 OBSERVING/SUCCEEDED/SUPERSEDED/INTERRUPTED/TIMEOUT/REMOVED。

V36 两表是观测证据，不是部署队列/资源状态副本。事件保存开始时业务身份、已就绪备用身份和结束身份供复核。采集每轮读取 Kubernetes；重启将未结束事件标 INTERRUPTED，不恢复计时。当前仅为配置了观察范围的中心云两个命名空间采集。所有接口沿用工作空间和 Kubernetes 命名空间校验。

详情查询按当前工作负载 UID 隔离；删除后同名重新创建不会混入上次模式的记录。旧身份的记录仍保留在数据库中。
