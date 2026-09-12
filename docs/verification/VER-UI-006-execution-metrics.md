# VER-UI-006 Metrics展示

日期：2026-09-12。状态：PASS（代码、验证与CEA前后端发布）。

- 前端Node 40/40通过；Vite构建、Prettier通过。
- Java21编译/package通过；完整verify于17:00:24通过（216项，0失败/错误/跳过），包含原生MySQL、Registry、Kubernetes、MinIO、真实FedAvg/FedProx及打包JAR启动。
- 浏览器最终42/42通过（最终构建index-C3JCnGhE.js），新增真实Job→MinIO→JSON API→图表/明细和无产物空状态；刷新后保留当前指标，桌面1440px/窄屏390px截图已人工复核。
- 新增接口拒绝跨namespace/任务身份、非本Attempt URI、未声明文件、未成功任务、缺失文件、超大/非法/重复键/尾随/非对象JSON；在真实联邦回归比较API指标与实际评估文件字节解析结果。
- 前端检查多item实例、0值、非有限值、标签、固定历史修订、错误与桌面/390px布局。

本次初次编译因测试漏导入WorkflowException失败，补齐后package通过；首轮新增Java/浏览器测试流程漏填Application必填timeout，校验拒绝保存，补齐后专项真实MinIO/Job测试及完整回归通过。一次定向Maven命令的PowerShell参数引号问题已纠正。窄屏检查修正刻度字号/表格横向滚动；检查时补上刷新保留指标选择的回归。没有放宽生产校验来让测试通过。

## 实际环境、源码和证据

- 基线d84b095 + 本UI-06提交；JDK Microsoft 21.0.12.1、Node24.19.0、Maven/JUnit/Testcontainers及现有Docker Desktop。Kestra本地提交0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4。
- `scripts/verify.ps1 -JavaHome C:/Users/liaoy/.jdks/ms-21.0.12.1`：完整成功；`scripts/check-scaffold.ps1`：8模块/87生产Java/32功能编号通过。
- frontend的`npm test`40项、`npm run build`、`npm run format:check`、`npm run test:e2e`42项通过。用Sites的现有项目流程保持原工作台样式，复核桌面/窄屏；不生成新站点或变更托管。
- 本地忽略证据：`.local/UI06-verify-final.log`，`frontend/.local/UI06-e2e-verified.log`，`frontend/.local/evidence/metrics-desktop.png`与`metrics-narrow.png`，`platform-server/target/federated-evidence/{fedavg,fedprox}/`。截图中的metrics-*是明确的测试Job，不是生产FedAvg指标。
- 两种联邦算法均真实运行两轮，metrics API逐轮值与评估文件解析结果相等，`numerical-audit.json`均PASS。无数据处理速率验收，也不将本机Docker隔离环境称为物理多云。

## 发布状态

用户当次明确授权“发布CEA前后端”。2026-09-12 17:15仅替换Compose项目cea的backend/frontend，二者healthy；17:16:52实际18080浏览器复核PASS。

- 发布源码a200f23；复用本日完整verify及前端回归已验证的JAR/dist，分别执行两份既有Dockerfile构建。部署阶段没有重跑216项业务测试，不把之前的测试记录算作本次新运行。
- 部署命令：`docker compose --project-name cea --env-file deploy/cea/.env -f deploy/cea/compose.yaml up -d --no-deps --no-build --pull never --wait --wait-timeout 180 backend frontend`。部署前保存原镜像为`cea/backend:before-ui06`及`cea/frontend:before-ui06`，未删除旧镜像或卷。
- backend镜像`sha256:177ea31f42f8468c36eab867123697eb3228c3156085ad448ecebad7e79699d7`，容器`6df6029b4b62`，StartedAt `2026-09-12T09:15:30.583299023Z`。
- frontend镜像`sha256:d36a26504a41f92ba850d84e41106c005db2157579df5c174497be1baa74ac83`，容器`27d806e4e50c`，StartedAt `2026-09-12T09:15:36.228977758Z`；页面加载`index-C3JCnGhE.js`。
- 发布前无活动Execution或TaskRun（含afterExecution）；发布前后分页读取比较：FedAvg r5/FedProx r3及全部历史修订、4条Execution、38个TaskRun及其Attempt原值不变。其它10个容器的ID、StartedAt、镜像ID不变。未改Flow、业务配置，不重跑训练，不重建算法镜像，无DB migration。
- `node deploy/cea/verify-browser.mjs`在实际CEA通过：两个算法历史执行的accuracy/loss/samples/round图表和表格逐值等于受权产物API；正确区分两轮、刷新保持选择、1440px/390px布局无整页横向溢出，截图人工复核。既有目录、四集群部署列表、No-code、SELECT草稿校验和执行拓扑检查同时通过；草稿未保存、未提交执行。
- 生产FedAvg两轮accuracy为0.5318/0.6229，loss为1.3692640928268434/1.10355718460083；FedProx为0.5812/0.6346和1.348798963546753/1.0562005699157715。两执行固定Flow r1，最新Flow r5/r3未影响历史指标来源。每轮samples=10000，仅陈列原始评估值，不构造吞吐率或新训练结果。
- 本地忽略证据：`.local/UI06-deploy-{baseline,after,metrics}.json`、`.local/cea/browser/result.json`及`{fedavg,fedprox}-metrics.png`/`*-metrics-narrow.png`。部署快照包含业务历史，不上传公开仓库；仓库只维护脱敏说明和通用只读浏览器验证脚本。
- 本次发布另验证未认证API返回401、18080加载已验证构建、浏览器操作后的业务/容器快照仍相等。`node --check deploy/cea/verify-browser.mjs`、`git diff --check`与scaffold（8模块/87生产Java/32功能编号/461文档链接）通过。

本次只补部署验证脚本和发布记录，未再修改生产Java、接口、表、前端组件或Execution/Worker/Runner调用链。MET-001数据处理速率、逐epoch训练指标及Pod日志仍未实现。
