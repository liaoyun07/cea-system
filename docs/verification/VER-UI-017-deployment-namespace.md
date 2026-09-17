# VER-UI-017 部署 Namespace 选择

2026-09-18，DONE，已部署。源码基线 `278d4e5136dda92cb004bbd7d754b432e0430163` 加本批 UI-17 差异；环境为 Windows、JDK 21.0.12、Docker Desktop、真实 MySQL/Registry/Kubernetes 与 Chromium。目标为 CEA `127.0.0.1:18080`；未操作旧系统。

## 实现与边界

常驻部署的列表、创建、详情、配置、编辑、扩缩容、删除、实例和历史，均显式传递所选 Kubernetes Namespace；原配置只作默认预选。复用已有 Namespace 查询和归属检查。Namespace 管理移入“模块化边缘服务部署 / 服务资源管理”，与 Service、Ingress 并列；集群运行资源仅保留节点。

主调用链为 DeploymentController → DeploymentService → 既有 Namespace 范围校验 → Fabric8 inNamespace → Kubernetes。普通 Flow / Job / Worker / Placement 不变，不涉及通用工作流语义修改或 Kestra 模型迁移。不新增生产 Java 类、模块依赖、表、服务或状态机；V29 给原部署记录表增加 kube_namespace 并更新索引，观察器和历史查询使用该列。所有部署 API 统一增加目标 Namespace 路径，前端、OpenAPI 和现有部署基准调用同步更新，不保留旧部署路由。见 [接口契约](../contracts/ui17-deployment-namespace.md)。

## 自动化验证

- 前端单测 **57/57 通过**，构建通过。
- 完整 `scripts/verify.ps1` 跑到 284 项 Java 测试：283 通过，唯一失败为既有迁移数量断言仍写28，实际已增加至29。其中 ImageDistributionTest 的 **61/61** 真实 Registry/Kubernetes 测试全部通过，包含新加的双 Namespace 同名部署操作隔离、越权拒绝及历史回填测试；普通 Flow 和联邦任务回归通过。
- 将迁移数量断言更新为29后，执行 `mvn -B -ntp '-Dtest=DurableWorkflowTest#realMysqlAndFlywayMigrations,ContractTest' '-Dsurefire.failIfNoSpecifiedTests=false' verify`：迁移测试1项、接口契约3项、打包启动 DeploymentSmokeIT 1项全部通过，03:16:29 BUILD SUCCESS。合计覆盖285项不同 Java 用例；未声称修正后又完整重跑284项。
- 第一轮完整浏览器测试79通过、2失败：新测试等待异步就绪后未刷新页面，持旧resourceVersion扩缩容被既有CAS拒绝；旧导航测试仍在原位置找Namespace标签。修正测试刷新步骤和迁移后导航断言，未放松产品CAS。
- 再次完整浏览器测试 **81/81 通过（5.6分钟）**。验证默认Namespace预选、两个新Namespace同名部署的创建/配置编辑/扩缩容/列表/实例/历史/删除隔离、403作用域限制、访问入口预填与1440/390px页面无横向溢出。
- 结构检查通过；修改的前端文件格式检查与 `git diff --check` 通过。

## CEA 发布与现场核验

用户明确授权补四个集群的后端Deployment写权限。发布前保留原镜像回滚标签并完成数据库备份；只更新backend/frontend，未重启数据库、Registry、构建服务或算法集群。四集群既有管理ClusterRole只增加 `apps/deployments: create, update, delete`；发布后逐一对比原规则并验证ServiceAccount权限，未授予cluster-admin。现有集群级绑定不变，平台仍限制默认或归属当前工作空间的托管Namespace，不声称实现Kubernetes级的逐Namespace租户RBAC隔离。

03:17发布、03:21现场核验完成，前后端均healthy：

| 服务 | 新镜像内容 ID |
| --- | --- |
| backend | `sha256:674a3b13b4cb6416f76dc3d58ec0385baa8f03960e1351b189d4006858009fac` |
| frontend | `sha256:fc901f65a72a2ceef32115c5e4dbcc92c6e8bb0e3f9c53a3e7d89d312c53af5d` |

现场在edge-a通过平台创建 `cea-lab-ui17-check-a` 与 `cea-lab-ui17-check-b`，各部署同名 `ui17-same-service`，使用既有 `httpserver/v1` 和HTTP就绪探针。两者真实Pod均Running/Ready，创建就绪计时分别 **2.161s、1.766s**。修改A的CPU申请并将A缩至0，不影响B配置及1个Ready实例；A历史3条、B历史1条，实例均属于对应Namespace。18080实际浏览器确认选择器、详情、Service入口Namespace/名称预填、新菜单和Namespace标签；1440/390px无页面横向溢出、无JS错误，截图已人工检查。

验证后仅删除本批两组临时Deployment和Namespace，`kubectl get ... --ignore-not-found` 确认Namespace已消失；测试产生的操作历史保留，未清理原业务记录。对比发布前快照确认：

- 原44个Flow、348条执行、71个应用版本、14个数据集、13个策略内容不变。
- 原四集群Deployment/Service/Ingress的UID和spec不变；原默认Namespace中10个业务部署均可通过新API查询真实实例。
- 原23条部署历史字段保持，Namespace按原连接默认值回填；数据库中无尚未回填的NULL Namespace。
- 除前后端外其余18个CEA容器的ID、镜像、启动时间与状态保持不变。

本地证据（忽略、不推送）：`.local/ui17-verify.log`、`.local/ui17-contract-verify.log`、`.local/ui17-e2e-final.log`、`.local/ui17/before.json`、`result.json`、`live-1440.png`、`live-390.png`。数据库备份为 `.local/ui17/cea-before.sql`；原镜像保留在 `cea/backend:rollback-ui17-20260918`、`cea/frontend:rollback-ui17-20260918`。备份/配置/凭据不纳入提交。

## 有意不扩展

不迁移已有部署，不支持编辑时跨Namespace搬迁；需在另一Namespace另建部署。不改变普通Flow任务的执行Namespace，不增加任意系统Namespace管理或新的权限体系；未配置连接的历史记录不猜测Namespace。部署计时定义、应用契约、镜像分发与Service/Ingress语义均保持原逻辑。
