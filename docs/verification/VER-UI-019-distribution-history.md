# VER-UI-019 应用分发记录

2026-09-18。源码基线3bedf0f；本批候选工作区。Windows、JDK21、MySQL8/Testcontainers、真实Registry/K3s隔离测试环境。

## 已完成测试

- `scripts/verify.ps1 -JavaHome C:/Users/liaoy/.jdks/ms-21.0.12.1 -MavenCommand D:/developevn/maven/bin/mvn.cmd`：04:25:51 完整通过，17分34秒。workflow-runtime 36项、platform-server 249项，共285项测试；另1项DeploymentSmokeIT通过。无失败、错误、跳过。
- 新增 `allDistributionHistoryPagesAcrossApplicationsWithoutCatalogAndEnforcesReadScope`：真实MySQL保存23条多应用/多版本、含相同开始时间的记录，不创建应用目录；验证跨应用分页、稳定倒序、版本筛选、跨工作空间隔离、只读用户HTTP读取、401/403/422、空页。原真实镜像上传/分发/复用及部署回归保留，ImageDistributionTest共62项通过。
- 前端 `npm test`：57项通过；生产构建通过。
- 3项交互专项先使用既有隔离后端包和受控历史响应，4.4秒通过：44条多应用记录分页/筛选重置、恰满页不产生空白下一页、空目录/失败恢复、取消在途旧请求。此轮不作为新后端API联调证据。截图检查后为短字段增加不换行样式，最终浏览器回归重新验证。
- 新后端JAR＋最终前端构建完整浏览器回归：85通过、1失败，6.0分钟。失败为旧导航夹具仅拦截单版本接口，默认全部请求落到真实测试库，返回8条而非夹具期望20条；此轮进程已加载旧夹具。已将夹具改为拦截全部/单版本两入口、返回21条前瞻数据，显式断言默认全部，保留切换归零和延迟响应不覆盖断言；重新启动导航与分发页面复测，不将该次整套回归记为全绿。新增真实镜像上传后的全部/单版本查询与三个交互用例在首次完整回归中均通过。
- `scripts/check-scaffold.ps1`：8模块、109个Java文件索引、结构与文档链接检查通过；不以此代替业务测试。

## 发布准备

04:11现场快照：2360条历史、44 Flow、348执行、71应用版本、14数据集、13策略、四集群Deployment/Service/Ingress UID与spec、20个CEA容器标识/镜像/启动时间。原镜像已保留为 `cea/backend:before-ui19-20260918`、`cea/frontend:before-ui19-20260918`。无DB迁移或权限调整，仅准备更新前后端。

## 复测与实际发布

- 重启隔离测试进程后 `node tests/run-e2e.mjs navigation.spec.js operations.spec.js`：9/9通过，27.4秒。包含原失败导航用例、真实上传/分发与全部记录接口、三个新交互用例、部署配置/扩缩容与节点指标回归。最终涉及的86项浏览器用例均有通过证据（首轮85项＋失败项复测），不表述为首次完整回归全绿。
- 04:35仅通过 `docker compose --project-name cea --env-file deploy/cea/.env -f deploy/cea/compose.yaml up -d --no-deps --force-recreate --wait --wait-timeout 120 backend frontend` 发布；两服务healthy。backend镜像 `sha256:d20e3204e450f82aa303359e56fc01cbda7a3d84b64c2bc6a42aa51f6e561619`，frontend镜像 `sha256:ec6875ba5091fe38e78f2d5903fb5d08164e4f03bd2b9e8e5e80c819d750668f`。
- 04:36在真实18080环境逐页读取全部2360条记录（64个应用版本），ID序列与MySQL按开始时间/ID倒序查询完全相同，没有漏项/重复。页面默认“全部应用版本”、首/次页20行、选择`edge-bearing/ep01-v1`仅1行、筛选/清除回第一页、刷新、1440/390px布局全部通过，无浏览器脚本错误。
- 发布前后2360条历史原始行不变；44 Flow、348执行、71应用版本、14数据集、13策略及四集群Deployment/Service/Ingress UID/spec不变；其余18服务的容器ID、镜像、启动时间和健康状态不变。现场验证全部为只读操作，无临时业务对象，无数据清理。
- 日志、快照、截图保存在忽略目录`.local/ui19/`与`.local/ui19-*.log`；真实配置、凭据、构建产物不提交。

本批没有数据库、权限、调度或镜像复制语义变化；新增的是只读历史聚合分页。全部记录仅限当前工作空间，筛选选项仍来自已登记应用目录。
