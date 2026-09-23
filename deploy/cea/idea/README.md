# IDEA 本地运行，连接现有 CEA

本机 Java/前端复用现有 CEA 数据库、四个 Kubernetes、四个 Registry 和四个 MinIO，不创建空数据库，不迁移数据。不修改业务 Java、API、数据库或算法。

2026-09-23 起日常开发优先使用 **Docker 后端**（18085）和 Docker 页面（18080）。若只改前端，在 IDEA 选择 `CEA Frontend - Docker Backend` 启动本机 Vite（18100，API 代理到 18085）；无需启动 `CEA Backend - Local` 或运行本地切换任务。当前本地后端已停止，Docker backend/frontend/gateway 正在运行。修改后端 Java 后仍须构建镜像并只重建 backend，源码保存不会自动更新容器。下面的本地后端/一键启动配置保留为需要调试 Java 时的可选模式，不再是日常入口。

## 已生成的 IDEA 配置

在 `backend` 项目中打开“运行/调试配置”，选择：

- `CEA - 前后端一键启动`：仅需调试本地 Java 后端时使用，会切到 IDEA 后端；日常 Docker 模式不要点击。
- `CEA Frontend - Docker Backend`：当前推荐的前端开发入口，只启动 Vite 并连接 Docker 后端 18085。
- `CEA Backend - Local`：JDK 21、platform-server、18185；凭据从私有文件读取，不需要手填。
- `CEA Frontend - Local`：npm run dev、18100，代理到 18185。
- `CEA - Restore Docker`：停止本地后端后，点击运行即可恢复原Docker系统。
- `CEA - Prepare Local`：后端的自动前置任务，无需单独点击。

首次初始化或凭据/CEA配置变更后，在 backend 目录运行：

```powershell
node deploy/cea/idea/setup.mjs
```

依赖现有 `frontend/node_modules` 和已安装 Docker Desktop。生成文件位于 Git 忽略的 `.local/idea-cea`、`.idea/runConfigurations`；包含真实凭据，不能提交或分享。不要直接运行旧的 `BackendApplication` 配置来代替本配置。

## 按按钮启动

在IDEA右上角运行配置下拉框选择 **`CEA - 前后端一键启动`**，点击旁边绿色三角形。Docker Desktop需要已经运行。

组合配置并行启动前端和后端；后端先编译，再自动运行一次有限时长的 `CEA - Prepare Local`，成功后才启动Java。准备任务检查现有活动执行、启动两个开发辅助容器、停止原Docker后端并切换网关。前端可能先显示页面，等后端启动完成再登录。

**如果准备任务提示有活动执行，等任务结束后重试，不要强停。** 启动完成后访问 http://127.0.0.1:18100 。登录仍用原系统账号；所有页面操作作用于真实 CEA 数据。单独点 `CEA Backend - Local` 的运行/调试按钮，也包含相同的自动准备步骤。

IDEA 未显示新配置时重新打开 backend 项目；不用修改原配置。IDEA 中“有效配置文件”保持空，工作目录和配置文件地址已生成。

## 恢复原 Docker 运行方式

先在IDEA停止本地后端，再选择 **`CEA - Restore Docker`** 并点绿色运行按钮。

如需命令行，仍可在backend目录使用：

```powershell
node deploy/cea/idea/switch.mjs local
node deploy/cea/idea/switch.mjs docker
```

恢复原后端及网关，访问 http://127.0.0.1:18080 。本地模式期间原18080页面不作为可用入口。两个辅助容器保留，不干扰原服务。

## 两个辅助容器

`cea-idea-access`（Nginx TCP转发）只监听Windows本机127.0.0.1：

| 本机端口 | Docker 内目标 |
|---|---|
| 18443–18446 | cloud、edge-a/b/c 的 Kubernetes 6443 |
| 18500–18503 | center、edge-a/b/c 的 Registry 5000 |
| 18910–18912 | edge-a/b/c 的 MinIO 9000 |

MySQL沿用18306，中心MinIO沿用18900，网关沿用18086。Kubernetes凭据沿用原受限账号，CA校验保留。

`cea-idea-tools` 复用现有 `cea/backend:local` 镜像，但**不启动Java**，仅提供skopeo/buildctl；不挂宿主Docker socket。后端用 `tool.mjs` 调用Docker CLI，把本地临时路径映射到助手容器的/work，构建仍用现有BuildKit和缓存。Registry逻辑地址和Pod使用的存储传输地址保持原样。

网关通过 `host.docker.internal:18185` 回连本地后端；原网关文件会备份到私有目录。切换命令不重启数据库、集群、存储、镜像仓库、BuildKit或终端，不清理数据卷。

验证和边界见[DEV-01验证](../../../docs/verification/VER-DEV-001-idea-local.md)。

使用IDEA原生[组合运行与运行前任务](https://www.jetbrains.com/help/idea/run-debug-multiple.html)，不把持续运行的前端放进阻塞型前置任务。配置格式核对JetBrains的RunConfigurationBeforeRunProvider和CompoundRunConfiguration源码；未增加应用内启动器或业务耦合。
