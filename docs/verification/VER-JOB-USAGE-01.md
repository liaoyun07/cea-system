# VER-JOB-USAGE-01

2026-10-17，已实现并部署。本批只改普通Job采集、资源摘要存储和查询；工作树大量既有修改保留，提交使用隔离索引，仅纳入本批差异。无新联邦/DQN收益实验、前端改动或算法镜像修改。

## 实现与测试

- 统一执行器向files-in/task/files-out注入静态cgroup v2采集器，经Worker结果和Executor原事务存入Attempt。新增V35可空JSON列及READ汇总接口，无新表/权限/监控服务。CPU核秒、内存工作集积分、采样峰值；缺失不填0，重试和afterExecution计入汇总。详见[功能](../features/JOB-USAGE-01.md)和[协议](../contracts/job-resource-usage.md)。
- JDK21 `scripts/verify.ps1` 完整回归执行321项：319通过，2项仅因OpenAPI漏同步新增路由/字段而失败，无测试错误/跳过。其中运行时48项、真实MySQL DurableWorkflowTest105项、真实Kubernetes ImageDistributionTest65项通过；包含新解析/汇总7项与落库/重启/权限1项。完整日志保留，不将首次verify写成全绿。
- 修复契约文档后，最终专项Maven verify通过12项：资源7项、ContractTest3项、增加资源断言的真实文件链路1项、打包DeploymentSmokeIT1项；BUILD SUCCESS。该次不是重新执行全部321项。
- 隔离导出仅本批差异的源码，Maven打包及资源/契约10项测试通过，确认不依赖无关未提交功能。仅导出用于验证，不以其构建物覆盖线上其他既有功能。
- Go4项单元测试、真实Docker短任务/exit7/SIGTERM/CPU与内存负载4场景通过；原Python文件助手10项通过。CPU负载报告0.544877核秒，命令末尾直接读cgroup为0.537800核秒，差额为收尾及采集开销，不由任务文件大小推算。采集开销未做独立A/B基准，内存采样峰值不等同内核精确峰值。
- 首次助手镜像下载超时，重试成功；首次Java新测试方法拼写错误修正。线上核验脚本先发现JSON/MySQL浮点末位差异及原逻辑删除失败Pod，分别改为8倍EPSILON容差、检查保留Job与数据库摘要；整数严格相等。同两条执行回执复用，未重跑任务筛选成功样本。

证据在忽略的 `.local/cea/job-usage-20261017/`：`verify-v2.log`、`full-server-reports/`、`full-runtime-reports/`、`verify-final.log`、`isolated-tests.log`、`meter/`、`live-run-first.log`、`live-run-v2.log`、`live-run-v3.log`。不提交运行数据或凭据。

## CEA发布与真实核验

发布前备份41,649,945字节数据库、助手配置和后端原镜像 `cea/backend:before-job-usage-20261017`；捕获2938条旧执行、85个旧Flow和20个CEA Compose服务。四集群同一公共助手镜像digest为 `sha256:2d47e6a4a6e56d1e12ec9cb49515ec2c714874b90bc228ef2e2436c529183b02`，只更新各 `platform.jobs.helpers.lab` 映射，旧镜像保留。仅重建/重启backend，健康检查通过，数据库V35 success=1。

| 新增验收执行 | 业务结果 | 资源结果 | CPU核秒 | 内存GiB·s |
| --- | --- | --- | ---: | ---: |
| `b99cb582-a179-4884-a458-236a5f9def95`：cloud/edge-a/edge-b/edge-c各一个Job | 4个成功，原输出JSON均核验一致 | COMPLETE，4/4 Job | 3.005867 | 0.172040408 |
| `c81fde01-cc05-411b-810e-d7dbc55afd95`：exit7、最多2次尝试 | 2次均按预期FAILED | COMPLETE，2/2 Attempt | 0.955518 | 0.021828210 |

成功Job逐容器比较Pod termination message与数据库摘要，UID和数值一致。失败Pod沿用旧逻辑清理，仍由最后终止状态保存完整摘要；确认Job UID/suspend、FAILED Attempt和三容器COMPLETE。失败记录未改为成功，资源完整与业务成功是两回事。

验收后按名称/UID删除本批6个测试Job，资源API返回与清理前完全一致。保留两条测试Flow、执行记录和小型输出，未删除旧业务数据。旧2938执行、85 Flow修订与19个非后端CEA服务身份/镜像/启动时间审计一致；历史资源查询为缺失而非伪造0。证据：`success-usage.json`、`success-pods.json`、`retry-usage.json`、`retry-pods.json`、`live-audit.json`、`cleanup.json`、`release.json`。

## 使用与边界

`GET /api/namespaces/{namespace}/executions/{executionId}/resource-usage` 返回流程总量及各Job/Attempt摘要；原Attempt接口也含可空resourceUsage。沿用READ权限，重启与403/404测试通过。部署后新Job自动记录，普通联邦流程无需改各算法镜像；旧Job/历史不能补采。

仅统计这批Job容器的CPU与内存，不包含共享MySQL/MinIO/K3s控制面。内存为100ms采样近似；OOM/强杀或容器整体丢失可能缺报告并标缺失。无节点级采集或整机口径，不以本功能宣称资源下降25%达标。前端本批不新增资源图表。
