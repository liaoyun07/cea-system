# VER-UI-018 Service 目标部署

2026-09-18，DONE，已部署。源码基线 `8711987771f2983eadbf16ab2f291b79a7951a45` 加本批 UI-18 差异。环境：Windows、Node、Chromium、Docker Desktop 与隔离的真实 MySQL/Registry/Kubernetes 后端夹具。实际发布目标 CEA `127.0.0.1:18080`。

## 实现与边界

只修改前端 KubernetesManagement.vue 与 DeploymentsPage.vue：Service手填Selector变为当前集群、当前Namespace中的目标部署下拉框；从部署详情预选；提交前读取目标的实际runtime.selector，原样提交原Service接口。完整匹配条件保留，界面不再展示内部标签键值编辑。无目标时禁止提交，切换作用域清空选择，读取失败/目标已删除时不提交，可重试。

主调用链变为前端部署列表 → runtime读取真实Selector → 原Service创建API → 原Kubernetes写入。没有新增生产Java文件、API、数据库字段/表、权限、服务或持久化绑定；现有Deployment标签、Service请求结构、删除规则、普通Flow执行链保持。自定义Pod标签和跨多部署Selector编辑不在本次范围，不涉及Kestra工作流语义。详见 [功能](../features/UI-18-service-target.md)、[交互协议](../contracts/ui18-service-target.md)。

## 自动化与修正记录

- 前端单测 **57/57通过**，生产构建与修改文件Prettier检查通过。
- 首轮定向浏览器9项中4通过、5失败，原因是新增select嵌套于label中且包含option文本，精确标签定位不能命中；部署目标实际预选正确。补显式 `aria-label="目标部署"`，不放松业务断言。
- 修正后完整浏览器 **83/83通过（5.7分钟）**，覆盖真实后端及Kubernetes。新用例验证同Namespace部署列表、跨Namespace同名目标、切换后清空选择、零副本可选、两个Service关联同一部署、空列表禁止提交、runtime故障不发POST且恢复后可重试、目标删除后不创建；既有用例验证详情预填、完整Selector一致、真实Pod关联、NodePort与Ingress回归。
- 完整回归后只补目标字段20px上间距；重新构建并检查格式，最终布局通过实际CEA的1440/390px浏览器检查，无页面横向溢出。前后两版截图均人工检查。
- 本批后端源码/API/DB均未改动，浏览器测试使用UI-17已验证的打包JAR，未将上一批Java测试写成本批重跑。
- `scripts/check-scaffold.ps1` 与 `git diff --check` 通过。

## CEA 发布与实际访问

03:48仅重建frontend，保留旧镜像 `cea/frontend:rollback-ui18-20260918`。新镜像为 `sha256:645237350b896e08482e6fc57e508b8c742f468ae979d22b000609a8583dc470`，frontend健康；backend、数据库、Registry、算法集群等其余19个CEA服务未重启，权限不变。

03:49通过实际18080页面，从cloud / cea-lab / http-server部署详情进入“配置访问入口”：目标部署自动预选、Selector编辑不存在。以不同Service名称创建 `ui18-http-check-a` 和 `ui18-http-check-b`，分别暴露80、81端口到同一目标8080；两者实际selector均包含deployment/workspace/owner三个原始条件，API读取关联同一Ready Pod。从cloud节点分别请求两个ClusterIP端口，均得到demo的 `Hello CEA` 及同一实例标识，确认不只是创建表单成功。页面无JS错误，1440/390px布局通过。

验证后仅清理本批两个临时Service，没有修改或删除既有部署。与发布前快照对比：原44个Flow、348条执行、71个应用版本、14个数据集、13个策略内容一致；四集群既有Deployment/Service/Ingress的UID和spec一致；其余19个容器的ID、镜像、启动时间和状态一致。

本地证据不推送：`.local/ui18-unit.log`、`.local/ui18-targeted.log`、`.local/ui18-e2e-final.log`、`.local/ui18/before.json`、`result.json`、`live-1440.png`、`live-390.png`。真实配置、凭据和业务快照均未纳入提交。
