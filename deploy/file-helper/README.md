# 平台文件助手与Job资源采集

`transfer.py`继续负责文件输入/输出，不修改算法镜像。`meter/`编译成无动态库依赖的Linux二进制；KubernetesJobRunner通过已有emptyDir注入主容器，并包装files-in/task/files-out原命令。

每100毫秒读取本容器cgroup v2，内存中积分，结束时在 `/dev/termination-log` 写一份摘要。CPU累计核秒、内存工作集积分/采样峰值及缺失处理见[功能说明](../../docs/features/JOB-USAGE-01.md)。无需安装Metrics Server或新增Kubernetes权限；原命令输出、退出码、SIGTERM转发保持。内存是采样近似，短于采样间隔的峰值可能遗漏。

构建同时执行4项Go单元测试：

```sh
docker build -t cea/file-helper:job-usage-v1 deploy/file-helper
node deploy/file-helper/meter/smoke.mjs
```

smoke使用真实Docker cgroup验证短任务、退出7、SIGTERM和计算/内存负载，比较最后CPU报告与命令内直接读取值。只创建/删除带 `cea-job-usage-meter-` 前缀的本批容器；结果保存在忽略的 `.local/cea/job-usage-20261017/meter/`。运行前不得有同名容器。

CEA发布需要将同一助手镜像分发至四个配置的集群仓库，并将 `platform.jobs.helpers.lab` 各项更新为新digest；旧镜像保留。只发布backend。验证脚本 `deploy/cea/verify-job-usage.mjs` 的capture/run/audit/cleanup分别备份环境、运行四集群小任务及失败重试、审计旧数据/服务、按名称及UID删除本批6个Job并核验记录保持。run已有回执时复用原执行，不重发；cleanup后不可再用run验证已删除的Pod。脚本用于本批验收，不能用于重复压力实验。

2026-10-17已发布四集群助手与backend：4个成功Job和2个失败Attempt全部COMPLETE，清理Job后记录保持，旧数据/服务审计通过。完整测试及失败修复记录见[验证](../../docs/verification/VER-JOB-USAGE-01.md)。

API：`GET /api/namespaces/lab/executions/{executionId}/resource-usage`。只对部署后新建且使用新助手的Job有资源记录；前端未新增图表，历史不补造。
