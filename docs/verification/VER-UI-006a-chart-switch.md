# VER-UI-006a Metrics图形切换

日期：2026-09-13。源码：基线bf52aa2加本批差异。状态：PASS，已发布CEA前端。

## 范围与实现

- 只修改ExecutionMetrics.vue和execution-metrics.js：默认柱状，紧凑按钮组切换折线；复用原值、实例身份、顺序、坐标及明细。
- 折线仅直线连接连续有效点；缺失断线、不补0、不插值，单值显示圆点。切换不新增API读取或业务写入。
- 无Java类、HTTP接口、DB字段/表、DSL或SPI增删；Execution/Worker/Runner及原产物读取链不变，不涉及通用工作流语义调整。没有增加采集、计量SDK或跨执行趋势。

## 验证

- `npm test`：47/47通过（新增2项折线路径测试，涵盖缺失断线、单值、零/负数和极端有限数）。
- `npm run build`及`npm run format:check`：通过；最终产物index-DuS9FLdi.js / index-DVZrtazx.css。
- `scripts/check-scaffold.ps1`：通过（8模块、104生产Java、32功能编号、533本地文档链接）；`git diff --check`通过。
- 最终构建的`npm run test:e2e`：54/54通过（3.2分钟）；真实Job产物经API显示，检查双向切换无新请求、坐标与原值/表格一致、刷新保留选择、零值、负值单点、缺失、错误及空态。已复核1440px/390px截图，布局无整页横向溢出。
- 首轮54项浏览器全过后，人工截图发现全局hover样式冲淡选中背景，补专属选中hover样式及真实颜色断言；没有改数据或放宽断言，最终54项重跑通过。
- 环境：Windows PowerShell、Node24.19.0、Chromium/Playwright1.63、JDK21及现有Docker。忽略证据为`frontend/.local/ui06a-unit.log`、`ui06a-e2e-final.log`和`frontend/.local/evidence/metrics-{desktop,narrow,line-desktop,line-narrow}.png`；图中metrics-*为隔离测试任务，不是生产算法结果。
- 本批只构建前端；未重建Java或重跑Maven完整verify，不把UI-10的235项后端结果记为本次验证。浏览器使用已有真实打包JAR和新建的隔离MySQL/K3s/Registry/MinIO/BuildKit环境，不访问CEA业务数据。

## 发布

用户后续明确要求每次修改同步部署，已写入AGENTS.md持续约定。本批2026-09-13 13:59:05只替换CEA frontend；13:59:40实际18080浏览器PASS，13:59:51发布后快照对照PASS。

- 使用已验收dist和既有frontend.Dockerfile；保留`cea/frontend:before-ui06a`回退镜像。Compose仅`up -d --no-deps --no-build --pull never --wait frontend`，不更新backend、builder、数据库、Registry或算法集群。
- 新frontend容器`c6debd232a8f`，镜像`sha256:6b08042b5940428512672efece0c0f3f62785c1b146bea2cd4a74ab21bcbbfaf`；health为healthy，实际HTML加载index-DuS9FLdi.js。
- 实际FedAvg/FedProx已有两轮评估loss，柱状和折线逐TaskRun原值均等于授权产物API；切换额外请求为0，坐标不变；实际1440px/390px截图人工复核。无API写请求、无浏览器异常，不启动新训练。
- 发布前后2个Flow、4条Execution、38个TaskRun、27个Attempt原值不变；其余12个服务的容器ID、StartedAt及镜像均未变。未做DB migration。
- 本地忽略证据：`.local/evidence/ui06a-live-{before,after}.json`、`ui06a-live-browser.json`及`ui06a-{fedavg,fedprox}-{bar,line,narrow}.png`。初次发布前只读脚本遇到无Health字段及PowerShell数组包装问题，修正脚本后重新取快照；两次异常均发生在构建/替换前，未修改服务或数据。
