# VER-UI-012 镜像库存直接分页

日期：2026-09-17；基线bef9d44及本批改动。原联邦实验工作区差异保持，不纳入本批。

状态：PASS，2026-09-17 18:18（Asia/Shanghai）已部署CEA 18080前后端并完成现场验收。

## 已执行验证

- JDK 21.0.12 / Maven完整`scripts/verify.ps1`：278项（277项单元/集成及1项打包JAR启动），0失败、0错误、0跳过；18:10完成。包含真实MySQL、Registry和Kubernetes回归。
- 库存新增测试覆盖路径内/跨路径游标、过滤、其他工作空间不可见、空路径跳过、完全满页但无后页、同digest不同路径、多个tag合并、非法游标及上游失败。既有真实Registry测试同时核对新接口的无标签镜像。
- Node单测54项、Vite生产构建及Prettier检查通过；3项定向浏览器测试通过，覆盖自动查询、20条分页、筛选/清除、迟到响应、空/失败、详情/删除使用行内路径，以及390px窄屏无页面横向溢出。真实删除仅在隔离测试仓库进行，页面边界测试的删除使用mock。
- 定向测试初次因`getByLabel`同时匹配导航与select而失败，改为精确combobox定位后通过；窄屏表格增加内部横向滚动，避免digest逐字换行。未修改业务参数或删除规则。
- 完整隔离浏览器回归71/71通过（3.7分钟），使用本次打包JAR、新建MySQL及Registry/K3s/BuildKit/Traefik测试环境。包括真实镜像删除引用保护与目录/Registry分离、Service/Ingress、部署、流程编排及执行回归。
- `scripts/check-scaffold.ps1`及`git diff --check`通过。旧部署脚本`deploy/cea/verify-browser.mjs`仅适配路径筛选操作，本次未重跑该脚本；现场验证由本批只读检查完成。

## CEA发布与现场验收

- 发布前确认当前执行均已结束并记录快照；仅Compose `up -d --no-deps --wait backend`、`frontend`，均健康。无DB迁移，不重启Registry、数据库、算法集群或其他服务。
- 新后端镜像`cea/backend:ui12-20260917`（同时标记local），ID `sha256:33faa8fa5bf81e0a0b27ec2f7ccdc7bf2780e3fe11a5d1bbe940afc8dbc17920`；新前端`cea/frontend:ui12-20260917`（同时标记local），ID `sha256:b88b0f7df388e3b808ee8a79903be0876d7df8c11610c9ca8ff871476ddf7e7e`。
- 回滚标签`cea/backend:rollback-ui12-20260917`保留原ID `sha256:26dcea692dfe5949ac08252b421da2aacf6fc7bbbda5c2496f1c329576cc35ae`；`cea/frontend:rollback-ui12-20260917`保留原ID `sha256:bb31a95c8bf808cba236aa41611f9299825160fd5b457984b112f64d0ed7fbbe`。
- 实际4个仓库用旧路径/镜像接口逐条核验，并与新接口每页7条完整遍历结果精确比较：center 47条/7页、edge-a 38条/6页、edge-b 23条/4页、edge-c 23条/4页；路径+digest无重复、无遗漏，含无标签副本。
- 18080浏览器验证4仓库自动查询、每页20条、下一页/上一页、可选路径筛选/清除和镜像详情；1440px及390px无页面横向溢出，人工复核截图，JS错误0、API写请求0。未删除任何现有镜像。
- 前后完整业务列表一致：44个Flow、348条执行、71个应用版本、14个数据集版本、13个策略；其他18服务容器ID、镜像、启动时间均不变。
- 本地忽略目录`.local/ui12/before.json`、`result.json`及4仓库桌面/窄屏截图保留证据；不提交凭据或本地环境数据。

## 变更边界

实际调用链为页面→RegistryController.inventory→RegistryManagementService→原RegistryHttpClient/镜像核验。只新增1个只读HTTP接口及3个内嵌响应record；无新生产Java文件、数据库/迁移、库存缓存、SPI或任务执行链变化，不涉及Kestra执行语义。每页20条，不再先分页仓库路径；路径为可选子串筛选。按实时Registry查询，不提供快照或虚构总数；未知且无法由标准Registry API发现的无标签digest仍无法枚举。

## UI-12a 标签优先与短摘要（2026-09-17）

基线d18949c及本批前端差异，19:29（Asia/Shanghai）已部署CEA 18080，PASS。

- 仅列表模板/CSS变更：三列“镜像路径、标签 / 短摘要、操作”，有标签只显示全部标签，无标签显示12位摘要；完整Digest留在详情。行键、分页游标、详情及删除请求/确认仍使用完整摘要。未新增类、业务字段、表、接口或关联应用推断，不涉及Kestra语义，不改主调用链。
- 本次54项Node单测、Vite生产构建、Prettier、check-scaffold和diff检查通过。4项定向Playwright全部通过（4.2秒）：标签/无标签同路径辨认、列表无完整digest、有标签不显示短摘要、详情完整摘要、删除精确引用、分页/筛选/切换/错误、390px无页面溢出。删除操作在mock中验证，没有删除CEA真实镜像。
- 原真实Registry测试和部署检查脚本将完整摘要断言移至详情，适配列表展示；本次未重跑完整Java、完整浏览器套件或真实镜像删除，前一节278/71项为UI-12历史结果，不能算成本批重跑。
- 18080现场四仓库每个首20行与真实inventory响应比对，标签或短摘要全部正确，完整Digest仍可在详情读取；桌面/390px截图复核，JS错误和API写请求均0。44个Flow、348条执行、71个应用版本、14个数据集版本、13个策略完整列表及其余19服务容器ID/镜像/启动时间不变。
- 仅Compose `up -d --no-deps --wait frontend`，健康；新镜像`cea/frontend:ui12a-20260917`/`local`，ID `sha256:31fe5129c7d8fb765d754808ea443251da71240bdd86e926000ec991a98d6665`；原镜像保留为`cea/frontend:rollback-ui12a-20260917`，ID `sha256:b88b0f7df388e3b808ee8a79903be0876d7df8c11610c9ca8ff871476ddf7e7e`。后端不构建、不重启。
- 本地忽略目录`.local/ui12a/`保留发布前后快照和4仓库截图；`frontend/.local/evidence/registry-identifiers-*.png`保留标签/无标签同路径边界截图，不提交凭据或本地业务数据。
