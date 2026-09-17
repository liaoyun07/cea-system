# VER-UI-013 应用参数类型对齐

基线 `042036c2dc30d87743e037269e54c234091ceb13` 加本批相关差异；环境 Windows / JDK 21.0.12 / Node 24 / Docker Desktop。与工作区既有联邦训练实验差异分开验收与提交。

状态：PASS，2026-09-17 21:14（Asia/Shanghai）已部署CEA 18080前后端并通过现场验收。

## 验收范围

- 注册、上传、在线构建三入口均提供七类参数；SELECT 必须给合法字符串选项；OBJECT/ARRAY 默认值可直接输入 JSON；切换非 STRING 类型取消 dataset 勾选。
- 契约注册与查询 HTTP、MySQL 持久化、同内容重放和非法值拒绝；原 STRING+choices、整数/数值/布尔值、dataset 行为保持。
- 真实 K3s Job 与网关终端容器消费来自 Flow OBJECT/ARRAY/SELECT 的参数，产物反读内容验证嵌套、null、中文、引号和换行；不是仅检查生成配置。
- 常驻 Python HTTP Deployment 先在进程中解析/断言 JSON 环境变量，再启动服务并等待 HTTP readiness；编辑配置回读、no-op、扩缩容与非托管配置保留。
- 可视化应用任务绑定保存 JSON，不把对象变成 `[object Object]` 或字符串；应用表单真实保存及错误 SELECT 无写请求。

## 已完成检查

- 56 项 Node 单测通过，Vite 生产构建、Prettier 与 check-scaffold 通过。
- 4 项只读浏览器定向测试通过：注册/上传/构建三入口七类型与类型切换、原参数卡片、桌面/390px布局，无 API 写请求。
- 完整 `scripts/verify.ps1` 执行280项单元/集成测试，279通过，1项部署测试夹具失败：Python `http.server.test()` 默认使用不支持GET的handler，探针收到501（JSON参数断言已经执行通过）。只修正测试命令为SimpleHTTPRequestHandler，生产代码未再变更。随后定向重跑4项本批真实测试（契约持久化、非法值、集群/终端JSON传参、部署编辑/扩缩容），全部通过；再通过1项打包JAR启动测试。21:05完成Maven verify定向复测，BUILD SUCCESS。合计281个不同Java用例已覆盖，不能描述为首次全量一次性全绿。
- 测试过程曾有一次为补齐整数JSON输出而主动中断；另一次Java/浏览器并行运行时Windows测试JVM意外退出、浏览器连接拒绝，原因未确证，不计通过。后续改为串行、测试JVM最大堆768MiB/Metaspace256MiB，Maven256MiB；未改变生产JVM配置。真实测试最终结果按完整报告及复测结果核对，不仅看脚本末尾状态。
- 本地忽略目录保留 `ui13-java-final.log`（完整280项）、`ui13-java-retest.log`（4项+JAR启动）及完整Java XML副本。
- 串行重跑完整隔离浏览器回归73/73通过（4.0分钟），包括表单真实注册/回读、非法SELECT不提交、应用任务结构JSON绑定、真实部署、上传/构建、Service/Ingress及原Flow执行。发布截图复核后仅修正OBJECT/ARRAY允许值的示例文字，再跑56项Node、4项三入口浏览器、构建/格式检查，并更新前端；此文本调整后未重复完整73项套件。

## 发布边界

仅更新 CEA backend/frontend，不新增基础设施、数据库字段/表/API、Java 类或执行分支。发布前保存现有镜像回滚标签，并确认无执行正在运行；发布后检查两服务健康及 18080 三入口，对比业务列表和其余 18 个服务的 ID/镜像/启动时间。当前只读快照为44个Flow、348条执行、71个应用版本、14个数据集版本、13个策略。

本批不改已有契约；若以后已注册新增类型的契约，旧后端不认识新枚举，不能仅回滚后端镜像后继续读这些新契约，应优先前向修复。发布即时回滚点是尚未写入新类型契约的现有数据状态。

## CEA现场结果

- 发布前确认无执行正在运行，保留原镜像。只用 `up -d --no-deps --wait backend` / `frontend` 更新受影响服务，二者均健康；无DB迁移。末尾提示文字调整仅再次更新frontend。
- 后端 `cea/backend:ui13-20260917`（同时local），ID `sha256:4a285ed4df17be4bb1bdd1bb5fd6dc4a0dddd8ad4c26f8372eea0b52bb2e0f34`；前端 `cea/frontend:ui13-20260917`（同时local），ID `sha256:5c185fd029657cc9d81cb81887b2173a19336026d61905868676db7e3f211897`。
- 回滚标签 `cea/backend:rollback-ui13-20260917` 保留 `sha256:33faa8fa5bf81e0a0b27ec2f7ccdc7bf2780e3fe11a5d1bbe940afc8dbc17920`；`cea/frontend:rollback-ui13-20260917` 保留 `sha256:31fe5129c7d8fb765d754808ea443251da71240bdd86e926000ec991a98d6665`。
- 18080现场注册/上传/构建三入口七类型、OBJECT文本框、SELECT允许值必填、1440/390px布局验证通过；页面无JS错误、无API写请求。复核桌面及窄屏截图，未保存任何测试草稿到CEA。
- 完整业务列表前后一致：44个Flow、348条执行、71个应用版本、14个数据集版本、13个策略；其他18个服务的容器ID、镜像和启动时间均不变。
- `.local/ui13/before.json`、`result.json`、桌面/窄屏截图保存本地证据，不提交凭据、缓存或环境快照。
