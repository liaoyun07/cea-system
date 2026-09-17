# VER-UI-016：部署核心操作验证

状态：2026-09-18 02:06 已完成 CEA 前后端发布和现场核验。源码基线 `ac192528bad6392f23db1ff736188bc1c336423c` 加本批提交差异；Windows、JDK 21、Docker、Node 24.19、Chromium。范围见 [UI-16](../features/UI-16-deployment-core.md)。

## 自动化

- 前端单元测试 57/57，构建与格式检查通过。
- 后端完整 `scripts/verify.ps1` 运行 282 个单元/集成用例，280 通过，ContractTest 两项失败是执行早于 OpenAPI 文档更新。同步 OpenAPI 并扩展三个新 DTO 字段检查后，定向 Maven verify 的 ContractTest 3/3 与实际打包 JAR 启动 1/1 通过（35.6 秒，BUILD SUCCESS）。共覆盖 283 个不同 Java 用例，不表述为首次完整 verify 全通过。完整回归 17 分 40 秒，其中 ImageDistributionTest 59/59（含本批资源更新/清除/扩缩容/归属/真实退出原因）通过；原工作流、联邦、卸载等回归通过。
- 第一轮完整浏览器回归 80/80（4.3 分钟）通过，覆盖真实常驻部署、七类型参数、CPU/内存/HTTP readiness、Service 预填/创建、Ingress 关联、异常退出和查询失败显示。截图审查后修正数字控件自动类型转换、复选框受全局纵排样式影响，补充实际修改整数/小数和横排断言；随后完整回归再次 80/80（4.2 分钟）通过。测试隔离运行，不在 CEA 创建测试业务。
- 首次发布后，实际 CEA 390px 详情检查暴露原集群工具栏与控制器长词条导致页面宽度 446px；新增本页窄屏换行和单列详情，补 390px 详情回归。测试启动脚本透传 Playwright 文件参数，便于用同样隔离基础设施定向复测；不改变默认全量回归行为。该修正的 3 项部署回归 3/3（15.5 秒）通过，属于前述 80 项中的重复复测，不额外计为 83 个不同用例。
- `scripts/check-scaffold.ps1` 通过，8 模块/109 个生产 Java 文件保持不变；OpenAPI JSON 与字段/路由校验通过。

## 发布基线

CEA 18080：20 个服务，44 Flow / 348 Execution / 71 应用版本 / 14 数据集 / 13 策略，无活动执行。四集群 `cea-lab` 下 Deployment/Service/Ingress 合计 cloud=5、edge-a=6、edge-b=4、edge-c=3，记录各对象 UID/spec；发布后比对，不清理或改写现有部署。

原 frontend 镜像 `sha256:4a31ed8a23e93b22b5a3ae545b6ba6b56049ccc1938c557a0f5666d15a940364`，原 backend 镜像 `sha256:043c5f3654c9e26e547ec645994f3e2d2c491314c2a7cb66058b32175cd5aad6`。只计划更新前后端，保留其它 18 个服务及上述业务对象。

## 实际发布与核验

- 使用 `docker compose --project-name cea --env-file deploy/cea/.env -f deploy/cea/compose.yaml up -d --no-deps --wait backend frontend` 更新两项；窄屏 CSS 修正后只再次更新 frontend。两者 healthy。
- 最终 backend：`cea/backend:ui16-20260918` / `:local`，镜像 `sha256:4419480ca6d38d864bea5bcba5a1ee43a866a9b713155d2907ee0d7bc8937e7d`；frontend：`cea/frontend:ui16-20260918` / `:local`，镜像 `sha256:02543ccf253f7e77c82ac825caaa1128499419b0e130641d59b2aadd2c91b2c0`。
- 两个原镜像均保留 `cea/backend:rollback-ui16-20260918`、`cea/frontend:rollback-ui16-20260918`，可按相同 no-deps 发布方式恢复。不涉及数据库迁移。
- 18080 真实页面只读验收：cloud 的 `ing01-http-demo` 显示实际 Running/Ready Pod、关联 Service/Ingress 和访问链接；编辑回读原 HTTP `/health` 探针与空资源；“配置访问入口”正确预填 cloud/cea-lab/名称/完整三个 Selector，不提交。创建表单从已有应用契约生成参数。1440px/390px 创建与详情均不撑宽页面，截图人工检查通过。
- 四集群 10 个实际 Deployment 的 runtime API 全部读取成功，均为 1 个 Ready Pod。只读浏览器零运行错误、零 API 写请求。
- 发布前后五类业务列表逐项相等，44/348/71/14/13 数量保持；四集群既有 Deployment/Service/Ingress 的 UID/spec 完整相等；其它 18 个 CEA 服务的容器 ID、镜像、启动时间不变且仍运行。未重启算法集群、数据库、仓库、网关或存储，也未创建生产测试部署。

本地证据保存在被忽略的 `.local/ui16/`、`.local/ui16-verify.log`、`frontend/.local/evidence/ui16-*`，不提交凭据、构建产物或运行数据。
