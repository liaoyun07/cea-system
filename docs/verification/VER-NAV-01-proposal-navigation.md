# VER-NAV-01 业务导航验证

日期：2026-09-17。基线：550eb346（ING-01）及本批前端差异。工作区原联邦实验差异保留，不纳入本批提交。

状态：PASS，2026-09-17 15:23（Asia/Shanghai）已发布 CEA 18080，仅更新 frontend。

验证范围：菜单/品牌/滚动条、原入口可达、分发历史共享组件、Kubernetes 页面拆分、权限和窄屏。无后端行为修改，不以旧 Java 回归结果冒充本次重跑。

## 自动化结果

- Node 54 项单元测试 PASS；Vite build、Prettier check、git diff --check PASS。
- JDK 21.0.12，复用 ING-01 的打包 JAR（本次未重建 Java）；隔离 MySQL/Registry/K3s/Traefik/BuildKit，64 项 Playwright 全部通过。包含原 No-code、执行、资源管理回归及新增三个导航/权限/分发切换测试。
- 第一轮 62/63：新导航测试在用户列表 GET 尚未完成时切页，被原 pending 离开确认保护阻止。修正测试等待按钮恢复可用，未删除/绕过生产保护；第二轮包含新增的分页切换测试，最终 64/64。
- 真实分发记录在原应用详情和新入口一致；覆盖错误后清空旧记录、恢复读取、版本切换重置分页和迟到请求不覆盖新选择。
- 桌面1440、900及窄屏390布局检查通过，系统名不隐藏、不产生页面横向溢出。主导航 computed scrollbar-width=thin、轨道透明，滚动保持。
- check-scaffold：8 模块、109 Java 文件、990 本地链接，通过；仅结构检查，不替代业务测试。

## CEA 现场验证

发布前保存 `.local/nav01/before.json`；旧镜像保留为 `cea/frontend:rollback-nav01-20260917`，digest `sha256:57f94ed79c20067bfc0190cb795ac9ee3d54d9d133cfa1068d59fde46eaba2da`。

新镜像 `cea/frontend:nav01-20260917`（同时标记 `cea/frontend:local`），digest `sha256:48ec75960d4ab9d7ea88a7f29cbd572662091d40f3177567047b43e48df0f972`。Compose `up -d --no-deps --wait frontend`，frontend 15:22:52 启动并健康。

只读 `node deploy/cea/verify-navigation.mjs` PASS：

- 18 个入口和页面标题匹配；四集群 Service/Ingress 列表以及现有 ing01-http-demo 可读。
- `edge-bearing/ep01-v1` 分发历史与原 API 数量/集群一致。
- 44 Flow、348 Execution、71 应用版本、14 数据集版本、13 策略的完整列表与发布前相同。
- 其他19个CEA服务容器ID/启动时间不变；本次不重启backend、DB、Registry、算法集群，不更新Flow修订或执行任务。
- 实际18080桌面/窄屏通过；浏览器JS错误0，检查过程中API写请求0。

截图与结果保存在忽略的 `.local/nav01/`、`frontend/.local/evidence/nav01-*.png`；本地凭据未写入报告或提交。

本批新增2个生产Vue文件、一个只读部署验证脚本和一个浏览器测试文件。没有新增/删除生产Java、数据库表列、HTTP接口或SPI；主调用链不变，未新增多核优化、跨应用全局分发查询等能力。

## NAV-01a 标题可读性（2026-09-17）

基线18e1274。按用户反馈仅修改`.nav-caption`：12→16px、字重700、颜色#9990aa→#e4dcf1、行高1.5，不改变菜单/交互。无新增生产文件、字段、表、接口，不涉及Kestra执行语义；主调用链保持。

本次54项Node单测、Prettier/build、结构检查及1项定向导航Playwright通过：预览新构建、只读连接现有CEA API，检查字体CSS、全部入口、1440/900/390布局。未重跑上一批64项完整浏览器或Java测试，不把历史结果计为本次。

15:32仅重建发布frontend，原镜像保留为`cea/frontend:rollback-nav01a-20260917`；新镜像`cea/frontend:nav01a-20260917`，digest `sha256:a81ad5fd587010ea28b7b49c346bc7dff3a12b30aacfc1f49f9b5c2b8ce4f03d`。18080只读现场验证PASS：标题计算样式、18入口、四集群Service/Ingress、分发历史、桌面/窄屏；44Flow/348执行/71应用/14数据集/13策略保持，其他19服务ID和启动时间不变，JS错误/API写请求均0。证据更新于`.local/nav01/result.json`及截图。

## NAV-01b 纯文字导航（2026-09-17～18）

基线`1a340ee8d74577f67679d14ebfaa7f16d41929f6`及本批差异。删除菜单数据中的图标值、模板图标节点和`.nav-icon`样式；未改变名称、排序、分组、权限、页面位置、品牌标识或退出按钮。普通菜单400字重、选中700字重，颜色#d7d1e2，桌面左24px（标题14px）；窄屏左右14px。标题保持NAV-01a样式，选中项悬停不覆盖其背景。没有新增生产文件、类、字段、表或接口，不改变主调用链，不涉及Kestra执行语义。

本次Node单测56/56、Vite build、Prettier、结构检查及git diff --check通过。沿用UI-14已打包JAR，JDK21.0.12和新建隔离MySQL/Registry/K3s/BuildKit夹具下完整Playwright **74/74通过（4.0分钟）**；含精确菜单纯文字/顺序、标题可读性、普通/选中字重、悬停、Tab/Enter焦点、管理员/普通用户菜单、全部入口与1440/900/390布局。没有修改Java或重跑Maven，不将旧Java回归计为本次。日志`.local/nav01b-e2e.log`。

2026-09-18 00:00:53仅frontend重建，00:01只读线上检查PASS。新镜像`cea/frontend:nav01b-20260917`（构建日期标签，同步`:local`），ID `sha256:4fa36aa2103691562d239174f6ad74819d2677e122549d967628c8438b007933`；原镜像保留为`cea/frontend:rollback-nav01b-20260917`，ID `sha256:741ab65fe53c8502bea2148c3a749988ece4ba0b586fa8d21c6a107530ddf88e`。

`node deploy/cea/verify-navigation.mjs`现场核验18入口、四集群Service/Ingress、现有分发记录、标题/纯文字菜单、桌面/窄屏通过，实际截图已检查。44Flow/348执行/71应用版本/14数据集版本/13策略完整列表与发布前相同；backend等其余19服务容器ID和启动时间不变、均运行，frontend健康。浏览器JS错误0/API写请求0，未更改业务资源。证据`.local/nav01b/before.json`、`result.json`、`sidebar.png`、`desktop.png`、`narrow.png`；原NAV-01证据未覆盖。
