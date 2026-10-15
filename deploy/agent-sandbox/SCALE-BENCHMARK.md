# DEP-WARM-02 Grafana 扩容对照

仅中心云 `cea-cloud-1` 的独立命名空间 `cea-warm-scale-20261016`。不是改造原 Deployment/HPA，也不改 CEA 页面、账号或数据库。依赖已安装的 Agent Sandbox v1.0.2 与 Metrics Server。

## 冻结方案

正式10对：Deployment普通扩容与Sandbox预热池扩容，均从1个业务可用实例变为3个。奇数对先普通、偶数对先预热，串行执行。普通组将Deployment从1改为3；预热组保留1个原Deployment实例，通过2个Claim领取两个独立Sandbox实例，加入同一个Service；两种控制器的selector不重叠。

- 镜像：Grafana13.2.4，固定 `grafana/grafana@sha256:dbbc38ea21103cefb50396340cd88afec779c7e070b0a7bf5a75b4ce46651d3f`。镜像准备在正式计时前完成，之后两组均IfNotPresent，不删除缓存。
- 每实例requests CPU100m/内存128Mi，limits CPU1核/内存1Gi；同一镜像、环境、挂载、安全上下文、1秒周期HTTP readiness probe。
- 默认镜像启动命令。配置只增加返回真实Pod名称的HTTP响应头、关闭分析上报/更新检查；不人为增加启动等待。各实例emptyDir中的SQLite只做空库初始化和健康/登录页验证，不代表生产共享数据库的Grafana HA功能验证。
- 两组准备完毕后均静置10秒。预热组备用2实例不能在领取前进入业务Service。
- 计时器在集群内Python Pod运行，CPU50m/64Mi请求、250m/128Mi上限。其ServiceAccount仅能操作本次命名空间的测试Deployment、Claim/池与读取Pod、Endpoints、Events、Metrics；不修改原账号或授予集群管理权限。
- 中心云没有集群DNS；使用Kubernetes注入的API/业务Service IP，不安装DNS或对宿主机增加端口。

## 计时

同一进程 `time.monotonic()`，起点是第一条扩容API请求发出前，终点同时满足：

1. 新增的2个（库存不足补测为4个）不同Pod UID全部Ready。
2. 业务Service的就绪Endpoints恰好包含原实例和新增实例。
3. 每个新增实例直连 `/api/health` 返回正确版本、数据库ok、对应Pod名称。
4. 经ClusterIP新建HTTP连接，实际观察到**每个新增实例**返回成功响应和它自己的Pod名称。

100ms观察间隔；每次最多连续探测6次Service，再等下一周期。请求确认耗时、全部Ready/Endpoints就绪耗时和完整HTTP终点分别保留。Service负载均衡命中差异也属于此观察方法的抖动，不能误读成纯控制器内部耗时。额外身份比对、日志收集和环境审计不进入计时。

预热领取后核验Pod UID、containerID、startedAt及imageID不变。另记预热池初建、请求到恢复2个备用实例、可服务后剩余补池时间；背景补池不人为暂停。单独进行30秒稳定后的3个Metrics Server采样（间隔15秒），记录备用2实例CPU和working-set内存。该采样不是内存积分或长期平均。

资源量沿用[Metrics API的CPU/内存定义](https://kubernetes.io/docs/tasks/debug/debug-cluster/resource-metrics-pipeline/#measuring-resource-usage)：CPU是采样window内的平均核占用，内存是采集时刻的working set。结果同时保留timestamp/window，不把CPU核占用写成累计CPU时间，也不把3次内存快照写成整个实验的平均内存。

正式对照之后只各补测一次：空池同Claim链路1→3；只有2备用时1→5。补测不混入10对平均值。

效率定义：新增实例数/扩容耗时。正式组新增数相同，因此效率提升=`(普通平均耗时/预热平均耗时−1)×100%`；另报耗时降低=`(1−预热平均耗时/普通平均耗时)×100%`。失败保留，不删样本或补跑筛选。

## 操作和证据

```powershell
python -B deploy/agent-sandbox/test_scale_benchmark.py
node deploy/agent-sandbox/scale.mjs run
```

脚本固定本批路径，已有证据时拒绝重复启动。本地证据目录 `.local/cea/agent-sandbox-scale-20261016/` 保存before/after、冻结plan、生成清单、完整runner.log、逐次结果和最终结果/审计。真实服务账号令牌只挂载到测试Pod，不落库或上传仓库。

首次准备阶段因没有DNS失败，未产生正式计时。修正为Service IP后执行了一次受限 `resume-preflight`；原失败日志、Pod和清单保留。此操作禁止在已有任何trial-start后重新提交实验。

第3条的准备阶段首次Service HTTP连接超时，此时尚无 `requestAt`、尚未发扩容请求。修正为轮询实际HTTP可用后，使用一次受限 `resume-preparation`：保存失败日志/Pod/行和checkpoint，保留已成功的前两条计时，跳过已完成序号，只继续未计时的准备。正式计时循环没有改变，原失败记录不删除。任何已发出扩容请求的失败均不允许使用此恢复路径。恢复时Windows命令行参数超长的本地错误没有启动集群操作；ConfigMap更新改用stdin提交。

全部成功后自动删除本次Namespace（包括临时Role/账号、Grafana临时数据、探测Pod和池等），保留controller及镜像缓存；原31个服务和旧集群配置前后比较。若观察脚本中断，先查询原benchmark Pod，不启动第二个；`finish`只收尾已有完整结果，不重新运行实验。

[验证记录](../../docs/verification/VER-DEP-WARM-02.md)
