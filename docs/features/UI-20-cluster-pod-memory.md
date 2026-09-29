# UI-20 集群 Pod 内存环图

范围：仅调整“集群运行资源”的内存环图。当前选择哪个 CEA 集群，就读取该集群全部 Namespace 的 Pod Metrics，汇总各容器 `memory` working set 为已用量；用该集群 Node 容量总和作为分母。当前四个单节点 K3s 集群共用 Docker Desktop 宿主机，因此分母均约 15.39 GiB，百分比可以按用户要求直接比较，但四个百分比不能相加。

节点明细和 CPU 环图仍用 NodeMetrics；现有 `usage/pods` 单 Namespace 明细接口不变。内存环图不包含集群外的宿主进程，也不包含在 Pod 外运行的 K3s 控制面进程；Pod working set 可能含部分文件缓存。它不是独立物理节点的内存占用率或 M03 性能验收值。

需要四集群后端账号只读 `metrics.k8s.io/pods` 的跨 Namespace get/list 权限，不增加业务资源写权限。缺测或过期不填 0；不增加表、执行链、任务调度、定时采集或新服务。
