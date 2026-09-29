# VER-UI-020 集群 Pod 内存显示

日期：2026-09-29。环境：Windows 11 / Docker Desktop 单宿主四个 K3s；JDK 21.0.7、Maven 3.8.8、Node 24。

范围：只更改资源页内存环图的来源和百分比分母；CPU 环图、节点表、已有单 Namespace Pod 明细、业务资源及执行链不变。四集群 `metrics.k8s.io/pods` 跨 Namespace get/list 仅用于汇总。

验证记录：

- `mvn -pl platform-server -am -Dtest=KubernetesUsageTest,ImageDistributionTest#actualMetricsApiReturnsRecentUsageWithNamespaceIsolationAndRejectsStaleSamples test`：2/2 PASS。真实隔离 K3s 中，后端受限账号可列出全 Namespace Pod Metrics，`memoryPercent=podMemoryBytes/Node capacity×100`，未来时钟导致过期返回 null。
- `npm test`：59/59 PASS；`npm run build` PASS；Prettier 定向检查 PASS。
- `scripts/verify.ps1`：结构检查及完整 Maven verify PASS（含真实 Registry/K3s/MySQL、打包 JAR 冒烟）；测试中的预期故障注入日志未计为失败。
- `node tests/run-e2e.mjs resource-usage.spec.js operations.spec.js`：隔离数据库/JAR/浏览器 9/9 PASS，覆盖不同的 Pod 已用量、缺测、刷新/切换与原 CPU/节点表。
- CEA 发布前：`wf_execution` 活动数 0、非终态 `wf_worker_job` 0；旧 backend/frontend 镜像分别保留为 `pre-ui20-20260929`。四集群原 ClusterRole 的 metrics 规则均为 `nodes get/list`；只把该规则加上 `pods get/list`，四处 `kubectl auth can-i list pods.metrics.k8s.io --all-namespaces` 均为 yes。
- 只重建并重启 CEA backend/frontend，两者健康；其它常驻服务未重启。真实 API 四集群 Pod 用量及按 `16139912Ki` 节点容量复算：cloud 157.7MiB/1.001%，edge-a 528.8MiB/3.355%，edge-b 148.7MiB/0.943%，edge-c 125.7MiB/0.798%。同次节点明细工作集约 69.8%～69.9%，证明环图已不再复用节点工作集。
- 18080 实际浏览器：cloud 0.15GiB/1.0%，edge-a 0.52GiB/3.4%，edge-b 0.15GiB/1.0%，edge-c 0.12GiB/0.8%；标签明确“集群 Pod 内存使用率”“占共享宿主机总容量”。

口径限制：Pod working set 含可能的文件缓存；不包含 Pod 外 K3s 控制面和宿主其他服务。四个百分比各自除以同一宿主容量，不能相加，不作为独立硬件内存容量证明。
