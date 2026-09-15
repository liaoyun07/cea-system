# FLPAR-11：18 客户端启动竞争修复

2026-09-16。基线源码 `d642da1` 加现场既有 FLPAR-05～10 未提交工作；本批不改变算法、数据、计量 SDK、Flow、Worker24、每边缘6槽、云2槽。

## 根因与边界

- 四个 Docker 化 K3s 共享 host cgroup namespace，原 kubelet cgroup-root 都为 `/`。FLPAR-10 两个训练 Pod 的 UID 出现在其他集群 kubelet 的 cgroup 清理日志：edge-c `1da1feab-b129-4093-a623-5b61237af211`，edge-b `b4369380-851e-44b3-8bde-e25b04f28c80`。保留52条过滤日志于 `.local/cea/par11/cross-cluster-cleanup.json`，不是仅凭失败文案推测硬件不足。
- Kubernetes v1.30.6 的 [Pod cgroup 枚举](https://github.com/kubernetes/kubernetes/blob/v1.30.6/pkg/kubelet/cm/pod_container_manager_linux.go)、[本节点 orphan 清理](https://github.com/kubernetes/kubernetes/blob/v1.30.6/pkg/kubelet/kubelet_pods.go) 与 [cgroup-root 校验](https://github.com/kubernetes/kubernetes/blob/v1.30.6/pkg/kubelet/cm/container_manager_linux.go) 说明扫描范围由 kubelet root 决定。结合现场日志，本项目判断为多 kubelet 管理相同目录的配置冲突。
- `k3s-entrypoint.sh` 仅接受四个既有节点名，创建各自 `/cea-<node>` cgroup 根并传给原 `/bin/k3s`。保留 host cgroup namespace、镜像版本、卷和资源配置；不把算法 Pod 改放2GiB控制平面容器限额内，不删除旧 `/kubepods`。
- 原 Runner 先创建活动 Job 再写授权 Secret，FLPAR-10 有24条 FailedMount。新顺序和恢复语义见 [文件协议](../contracts/file01-pod-artifacts.md)。一个 Job annotation 有真实消费者，无新增 Java 类、表、列、API、SPI 或 Executor/Worker/Binding 分支。
- 参考本地 Kestra `0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4` 的 `core/src/main/java/io/kestra/core/runners/Worker.java` 和 `core/src/main/java/io/kestra/core/models/tasks/runners/TaskRunner.java`：保持 Worker 调用 Runner、Runner 拥有远程执行/文件职责的边界。挂起 Job 准备协议是本项目 Kubernetes 技术约束下的修复，不声称照搬 Kestra 细节。

## 验证结果（DONE/PASS，18路同时训练与2GB/s未达成）

- 原245条终态执行、28个Flow、数据集/19服务快照已保存。
- Shell 语法、Compose解析通过。四个既有K3s已重建；实际 configz、运行进程 cgroup 路径、Ready、原42个 Node/Namespace/Deployment/Service UID和spec一致性通过（`k3s-before/after.json`）。未删除工作负载或数据卷；常驻Pod随受影响K3s重新启动。
- JDK21编译过程发现并修正新增测试的客户端 Namespace 用法和受检异常声明，原失败日志保留。最终 `scripts/verify.ps1` 完整通过：264项（35 runtime、228 server、1打包启动），零失败/错误/跳过，16分27秒。其中50项真实Registry/K3s/Docker测试全部通过；新增准备失败后同UID恢复、准备中取消分别6.386秒/0.909秒，原接管、缺失输出、取消、联邦数值等回归保持。
- 8项现有 Node 数学参数/区间/负载测试通过。
- 后端已发布，镜像 `sha256:8de560d9bd35f7a975e67f186d05b392494e3a5616fb39d1c9d0dc0dbed01670`，旧镜像 `sha256:6a66acf8c9a5e14dfa715e18f6de4ece14b07967593f6a311bcb5c2be7ef769e` 保留为 `cea/backend:pre-flpar11`。仅backend和4个K3s重建，frontend只reload反向代理；原14个非目标常驻服务ID/镜像/启动时间保持。无DB migration，保留原245执行/28Flow/数据集；最终249执行全终态、28Flow，01:57:29前后端及18080 API健康。
- 同一 `par10-fedavg-cifar10-c18-preprocess` r1，单轮FedAvg/CIFAR10/MLP、batch1024、每集群6客户端、完整重复分片，仍累计30万条处理/5万独立样本。每次输入4,799,179,791B、输出3,722,841,546B，与修复前完全相同。

| 样本 | 提交至Execution结束 | 算法活动并集 | MB/s（十进制） | 训练算法峰/平均重叠 | 训练主容器峰（秒精度） |
| --- | --- | --- | --- | --- | --- |
| 修复前单次FLPAR-10 | 77.038s | 17.372s | 490.55 | 5 / 1.70 | 8 |
| 预热 | 61.794s | 18.429s | 462.42 | 7 / 2.53 | 9 |
| 正式1 | 50.541s | 16.057s | 530.73 | 6 / 2.81 | 14 |
| 正式2 | 52.497s | 14.727s | 578.69 | 5 / 3.07 | 11 |
| 正式3 | 53.370s | 14.443s | 590.05 | 7 / 2.86 | 13 |

正式3/3成功，平均52.136秒、566.49MB/s。修复前只有1次，不能据此报告严格配对统计显著性或稳定百分比保证；预热不混入正式均值。全部失败/原始样本保留，无补跑替换或人为同步屏障。

四次共156个真实Job/SDK、468个init/main/output容器，退出0且无重启；镜像digest、6客户端/集群、训练参数、完整输入/输出文件量、SDK区间并集核验PASS。启动Warning为0：原24条FailedMount及3条sandbox失败均未复现。Pod创建至files-in启动最长从原32秒降为各次2/2/2/3秒（Kubernetes秒精度）。时钟/SDK历史其他故障不因本次通过而视为全部解决。

独立使用旧par07数学参考重算：80份模型、320张量逐值一致；每次18客户端/30万样本加权聚合与10000测试样本评估一致（accuracy=0.2124，loss=2.227987951660156），不减少真实计算/文件量来提速。

预热Execution：`8c23ef62-2594-46e7-99e2-802c36d9df53`；正式：`925597c7-b86a-4bdb-b09f-b92cf1304816`、`8658067e-e5a4-4a57-8e7b-a460a853cb05`、`6be8b7d5-6ac7-436d-aabd-1966a8d9bcbc`。本地证据位于 `.local/cea/par11/`：`verify-2.log`、`summary.json`、`audit-with-launch.json`、`audit.json`、`models-audit.json`、`after.json`，不上传模型、凭据或运行缓存。

## 剩余限制与调用链

仍为 FlowExecutor → WorkerEngine → ApplicationTaskRunner/Placement → KubernetesJobRunner → 文件助手/算法。只改变Job启动准备顺序和基础设施隔离，没有新执行分支。

训练主容器包含Python导入、算法及退出同步等待，不能把14个主容器同时存在当成14路算法计算。正式单客户端算法仅0.54～2.59秒，而18个算法开始时间仍相差6.63～9.52秒；尚未18路同时训练。文件准备、独立Python启动及不同分片工作量导致错峰，不能仅继续提高已经足够的Worker/槽位解决。下一步如继续优化，应先细分这些阶段的启动开销，不能加入计时前等待屏障或减少计算来制造并行峰值。

继续保持Worker24/每edge6槽/cloud2；数据处理速率未达2GB/s，本批不修改M01验收状态。结构检查：8模块、109 Java、32功能ID通过；Git更新仅纳入本批修复与证据说明，保留未完成的既有算法优化工作。

本机共享Docker宿主，不代表三台独立物理边缘云；重启控制面造成短暂不可用，恢复验证与算法性能必须分开记录。
