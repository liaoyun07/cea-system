# VER-UI-005a 任务实例开始时间排序

日期：2026-09-13。源码基线5a503bb加本批差异。状态：PASS，已发布CEA前端。

## 范围

仅前端ExecutionDetail.vue、model.js：表格startedAt升序，同时间稳定、未开始/无有效开始时间置后，保留后端小数秒精度。数组副本排序，不修改原tasks，也不改变拓扑、Metrics、输出或Attempt身份。无Java/API/表/DSL/SPI变化，无执行主链、采集或计量语义变化。

## 验证

- `npm test`：50/50通过；新增3项检查时间先后、同时间/时区等值稳定、缺失/非法置后、微秒精度、空表、原数组/对象身份不变及更新后的重排。
- `npm run build`、`npm run format:check`通过；产物index-BwKsMZzi.js / index-QmC23aPi.css。
- `npm run test:e2e`完整55/55通过（3.3分钟）。新增真实Loop并行Sleep→聚合→评估场景，检查运行时未开始置后/终态排序、API仍为创建顺序、刷新/选中详情身份与拓扑不变；已有Metrics切换等回归同时通过。
- `scripts/check-scaffold.ps1`通过（8模块、104生产Java、32功能编号、537本地文档链接），`git diff --check`通过；1440px/390px截图复核通过，表格保持局部横向滚动，无整页横向溢出。
- Windows、Node24.19.0、JDK21、Chromium/Playwright及隔离MySQL/K3s/Registry/MinIO/BuildKit；使用已构建后端JAR，不连接CEA业务库。本批未改Java、未重建后端或重跑Maven完整verify，不将历史后端测试作为本次结果。
- 忽略证据：`frontend/.local/ui05a-unit.log`、`frontend/.local/ui05a-e2e.log`、`frontend/.local/evidence/task-order-{desktop,narrow}.png`。

## 部署

依用户持续授权，2026-09-13 14:37:42仅替换CEA frontend，14:38:54实际18080浏览器PASS，14:39:01部署后快照对照PASS。

- 用已验收dist和既有frontend.Dockerfile构建；保留`cea/frontend:before-ui05a`原镜像。仅Compose `up -d --no-deps --no-build --pull never --wait frontend`，不更新backend、builder、MySQL/MinIO、Registry或算法集群。
- frontend容器`cb0b5c45fe27`，镜像`sha256:72b283a28cf8a5281616e3b229b4bbd683c7fe950d2156a812f64ef914bf84bb`，health为healthy，实际加载index-BwKsMZzi.js。
- 使用用户现有FedAvg（62个TaskRun）与FedProx（14个TaskRun）做只读核验：完整列表与后端UTC时间按完整小数秒独立计算的顺序逐ID一致；实际train位于后续aggregate/evaluate之前，API仍是原创建顺序；刷新与尝试详情保持TaskRun身份，已有Metrics柱状/折线正常。1440px/390px截图已复核，无整页横向溢出，无浏览器异常或业务写请求。
- 部署前后2个Flow、5条Execution、100个TaskRun、78个Attempt原值一致；其余12服务的容器ID、StartedAt、镜像均未变。没有修改Flow或启动新训练，没有DB迁移。
- 本地忽略证据：`.local/evidence/ui05a-live-{before,after}.json`、`ui05a-live-browser.json`与`ui05a-{fedavg,fedprox}-{desktop,narrow}.png`；不公开用户完整运行快照。
