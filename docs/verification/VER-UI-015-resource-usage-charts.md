# VER-UI-015 资源环形图与内存口径核对

日期：2026-09-18（Asia/Shanghai）；基线`b5a0a41109ff350539494525c280eb148b6d7401`及本批差异。状态：PASS，00:33已部署CEA前端。

## 只读内存诊断（00:23～00:27，浏览器回归负载启动前）

新系统`KubernetesResourceService.nodeUsage`使用Metrics API，并以Node capacity为分母；旧系统工作区`ClusterMetricServiceImpl.toMetricVo`和`Metric.getNodeMetric`也使用Metrics API，但以allocatable为分母。旧库HEAD分别为web-platform `1e45503`、amis `6b3a05d`，本次读取工作区实际源码，不改旧工程。

四个CEA K3s节点均报告CPU16核、memory `16139916Ki`，capacity=allocatable。Docker宿主总内存`16527273984`字节、16CPU与此完全一致。四Metrics样本内存分别为cloud `11576408Ki`、edge-a `11560772Ki`、edge-b `11564168Ki`、edge-c `11578232Ki`（采样时间16:23:03～22Z），均约71.6%～71.7%，不能相加为四套独立物理资源。Compose使用host cgroup namespace，入口脚本分别隔离Pod cgroup子树；隔离Pod管理范围不使根节点容量/统计成为独立虚拟机。

cloud kubelet `/stats/summary`在16:23:42Z显示节点workingSetBytes `11862814720`（约11.05GiB），rssBytes `6437400576`（约6.00GiB）；该cloud集群5个Pod的workingSet合计仅`152453120`字节（约145MiB）。Docker同时段报告backend约668MiB、cloud K3s容器约751MiB；这些范围互不等价，不能把11GiB归因给单个后端/算法进程，也不能用一个K3s容器的docker stats代替该集群全部Pod用量。

`/proc/meminfo`后续读到MemAvailable `8937100Ki`（约8.52GiB）、Active(file) `5297048Ki`（约5.05GiB）；根cgroup active_file约5.05GiB。说明工作集仍含显著活跃文件缓存，工作集百分比不等于系统实际不可回收内存比例，不能直接当作OOM风险判断。保留原采集值，没有手动清缓存、改分母/limit或重启集群。

依据：[Kubernetes资源指标](https://kubernetes.io/docs/tasks/debug/debug-cluster/resource-metrics-pipeline/)说明memory为工作集估计且含部分文件缓存；[Docker stats](https://docs.docker.com/reference/cli/docker/container/stats/)说明Linux CLI扣除特定缓存且范围为容器。新旧采集来源相同，当前capacity=allocatable，因此分母差异不解释本机高低；未取得同时间/同负载旧指标，不能断言其当时更低的唯一原因或新系统存在内存泄漏。旧代码在Metrics缺失时存在节点百分比0/N/A回退，但未证明用户历史页面经历了该情形。

## 测试与部署

- Node单测56/56，Vite build、Prettier、git diff --check通过。完整Playwright **77/77（3.9分钟）**，使用JDK21.0.12及此前打包的UI-14 JAR、新建隔离MySQL/Registry/K3s/BuildKit；本批未修改Java、未重跑Maven。
- 真实节点指标和原资源管理操作通过；新增三个浏览器测试覆盖全节点汇总不受节点表分页影响、真实0、100%、超100保留数值、STALE/MISSING/INVALID及503不伪装0、刷新恢复、切换清空和迟到响应不覆盖、1440/900/390布局。参考截图均已检查，无溢出。日志`.local/ui15-e2e.log`。
- 旧前端镜像保留为`cea/frontend:rollback-ui15-20260918`，ID `sha256:4fa36aa2103691562d239174f6ad74819d2677e122549d967628c8438b007933`；新镜像`cea/frontend:ui15-20260918`（同步`:local`），ID `sha256:b208b32b66c24f377e9785457f4e9aed147889a610a0a1c13b4c3716239fdc89`。仅`compose up -d --no-deps --wait frontend`，00:32:58启动，健康通过。
- 00:33只读现场脚本`.local/ui15/verify.mjs`逐一比对四集群的API百分比、圆环弧度及已用量；四集群内存71.587/71.602/71.681/71.590%，正常呈现，不改成更低口径。1440/900/390实际截图通过，JS错误0，API写请求0。
- 原44Flow/348执行/71应用版本/14数据集版本/13策略完整列表与发布前相同；其余19服务容器ID、镜像ID、启动时间保持且运行，未重启后端、DB、Registry或算法集群。证据`.local/ui15/before.json`、`result.json`及`live-*.png`，不包含凭据。
- scaffold通过（8模块、109 Java文件）；仅结构检查，不替代业务测试。本批仅新增测试/文档，主调用链、API/表/字段及采集公式保持。上述只读诊断不是性能基准或内存优化。

## UI-15a：节点表信息精简（2026-09-18）

基线`b37516a596920798017cdec6c620ba759d651c8f`。隐藏容量和可分配容量中的Pod上限，并移除采样状态/时间/窗口整列；不改后端返回值、Metrics有效性判断、节点配置。保留只读封锁调度列，未实现或调用cordon/uncordon。

只读核对：`cea-edge-a-1`容器在Docker `cea_default`桥接网络中的IP为`172.26.0.8`，与Kubernetes节点InternalIP一致；该网络子网为`172.26.0.0/16`，节点Pod CIDR为`10.42.0.0/24`，不是同一地址范围。`/api/v1/nodes/cea-edge-a/proxy/configz`返回`kubeletconfig.maxPods=110`，部署配置未发现显式覆盖；[kubelet官方参数](https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet/)默认也是110。该值可人工配置，并非按CPU/内存推算或当前Pod数。封锁调度来自Node `spec.unschedulable`，可解释外部维护时不接收普通新Pod，不会停止已有Pod；[官方节点说明](https://kubernetes.io/docs/concepts/architecture/nodes/)。当前系统只读展示，无修改入口，本次不增加权限。

- 本批重新运行Node单测56/56、完整Playwright77/77（3.9分钟），Vite构建、Prettier及diff检查通过。新增断言表头为8列、容量只含CPU/内存，不再渲染110、采样时间或窗口；STALE/MISSING/INVALID节点明细继续显示“— / —”。真实节点指标测试同步通过。沿用既有打包JAR启动隔离测试后端，无Java变更或Maven重跑。日志`.local/ui15a-{unit,build,format,e2e}.log`。
- 前端新镜像`cea/frontend:ui15a-20260918`（同步`:local`）为`sha256:4a31ed8a23e93b22b5a3ae545b6ba6b56049ccc1938c557a0f5666d15a940364`；前版保留为`cea/frontend:rollback-ui15a-20260918`（`sha256:b208b32b66c24f377e9785457f4e9aed147889a610a0a1c13b4c3716239fdc89`）。只执行`compose up -d --no-deps --wait frontend`，00:54:46启动并健康。
- 00:55实际页面逐一验证cloud/edge-a/edge-b/edge-c：8列表头、容量两项、环形图及用量与API一致；1440/900/390宽度通过，桌面和窄屏截图检查通过，窄屏表格保留内部横向滚动。浏览器JS错误0，API写请求0。
- 发布前后44Flow/348执行/71应用/14数据集/13策略完整列表保持，其余19服务ID、镜像ID和启动时间未变且仍运行。仅前端更新，未重启后端、DB、Registry或算法集群。证据`.local/ui15a/before.json`、`result.json`及`live-*.png`；复用`.local/ui15/verify.mjs --ui15a`分目录取证，未覆盖上批证据。
- scaffold通过（8模块、109 Java文件）。本次不改接口、部署资源配置或采集公式，不把隐藏字段等同于停用采集/校验。
