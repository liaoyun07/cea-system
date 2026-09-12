# VER-UI-006 Metrics展示

日期：2026-09-12。状态：PASS（代码与验证），尚未发布CEA。

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

当前只完成代码/验证及GitHub同步步骤；尚未获得本次CEA前后端发布确认。没有更新18080，没有修改存量Flow/历史/业务库，不重建生产算法镜像，不重启任何既有服务。临时验证资源按原测试脚本清理。
