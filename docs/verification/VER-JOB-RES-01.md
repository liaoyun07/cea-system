# VER-JOB-RES-01

2026-10-15，基于d7e1548及已有工作树；用户授权任务级K3s CPU/内存上限，留空保持原行为。

## 结果：已部署并验证

- JDK 21.0.12.1、Maven 3.8.8，完整 `scripts/verify.ps1` 成功：312项Java测试，失败/错误/跳过均0；包括真实Registry、Kubernetes Job、MySQL及打包启动。耗时21分45秒。
- 资源测试随后独立为KubernetesTaskResourcesTest，不夹带已有未提交Options测试；DefinitionTest及两资源测试类共25项复测通过，生产代码未变。
- 前端70项单测、Vite build通过；结构检查通过。
- 真实页面：设置500m/512Mi保存r1并重新读取；CPU清空保存r2得到null；移除resources保存r3得到null。浏览器无pageerror，截图已检查。
- 实际执行 `f9b57f74-e1aa-4dbf-8c1b-0486b87cceda`（Flow `verify-job-resources-20261015` r1）五个Application任务全部SUCCESS。

| 配置 | Pod limits / 默认requests | task cgroup cpu.max | task cgroup memory.max |
|---|---|---|---|
| CPU250m + 内存128Mi | 250m / 128Mi | 25000 100000 | 134217728 |
| 仅CPU0.5 | 500m | 50000 100000 | max |
| 仅内存128Mi | 128Mi | max 100000 | 134217728 |
| 两项空白 | 无 | max 100000 | max |
| 旧任务不配置 | 无 | max 100000 | max |

所有files-in/files-out助手resources保持空；Job模板与Pod配置一致。平台仅设置limits，requests由Kubernetes默认补齐。验证的是配置下发与内核cgroup限制，不是OOM或吞吐压测。

仅重建/更新CEA backend、frontend，两者healthy；其他29个CEA服务ID/启动时间保持。旧镜像保留为 `cea/backend:before-job-res-20261015`、`cea/frontend:before-job-res-20261015`。无数据库迁移、旧Flow编辑、独立卸载配置或历史数据删除。

复核脚本：`deploy/cea/verify-job-resources.mjs`；本地证据位于 `.local/cea/job-resources/`（不提交）。新增两个专用验证Flow，不修改既有业务Flow。
