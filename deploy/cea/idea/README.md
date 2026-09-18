# IDEA 本地运行，连接现有 CEA

本机 Java/前端复用现有 CEA 数据库、四个 Kubernetes、四个 Registry 和四个 MinIO，不创建空数据库，不迁移数据。不修改业务 Java、API、数据库或算法。

## 已生成的 IDEA 配置

在 `backend` 项目中打开“运行/调试配置”，选择：

- `CEA Backend - Local`：JDK 21、platform-server、18185；凭据从私有文件读取，不需要手填。
- `CEA Frontend - Local`：npm run dev、18100，代理到 18185。

首次初始化或凭据/CEA配置变更后，在 backend 目录运行：

```powershell
node deploy/cea/idea/setup.mjs
```

依赖现有 `frontend/node_modules` 和已安装 Docker Desktop。生成文件位于 Git 忽略的 `.local/idea-cea`、`.idea/runConfigurations`；包含真实凭据，不能提交或分享。不要直接运行旧的 `BackendApplication` 配置来代替本配置。

## 启动（先切换，再在 IDEA 点运行）

在 IDEA Terminal 中，确认当前目录是 backend：

```powershell
node deploy/cea/idea/switch.mjs local
```

此命令检查现有活动执行，启动两个开发辅助容器，停止原 Docker 后端，将网关切到本地后端。**如果提示有活动执行，等任务结束后重试，不要强停。** 然后依次运行上述后端、前端配置，访问 http://127.0.0.1:18100 。登录仍用原系统账号；所有页面操作作用于真实 CEA 数据。

IDEA 未显示新配置时重新打开 backend 项目；不用修改原配置。IDEA 中“有效配置文件”保持空，工作目录和配置文件地址已生成。

## 恢复原 Docker 运行方式

先在 IDEA 停止本地后端，再运行：

```powershell
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
