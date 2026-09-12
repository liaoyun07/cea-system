# VER-UI-007 只读查看增量

日期：2026-09-12。状态：PASS（实现、隔离验收与CEA上线）。源码基线cd5db9c加UI-07提交53ff620；环境Windows、Microsoft JDK21.0.12、Node24、Docker Desktop及独立MySQL/K3s/Registry/MinIO。

## 最终结果

- `scripts/verify.ps1 -JavaHome C:/Users/liaoy/.jdks/ms-21.0.12.1`于19:37:20通过220项：35 runtime、184 server、1实际JAR；失败/错误/跳过均为0。
- `npm test`41项通过；`npm run build`、`npm run format:check`通过。构建资产为`index-DbvYwXXc.js`、`index-DMAQk_D4.css`。
- 完整verify之后串行执行`npm run test:e2e`，44项真实浏览器测试通过（2.2分钟），隔离测试脚本正常退出0并清理自身环境。19:40核对桌面及390px截图：总览、资源、逐轮产物预览均可操作，无页面横向溢出；长资源表可在表内横向滚动。
- `scripts/check-scaffold.ps1`通过：8模块、89个Java文件、32个功能编号；接口契约为57个HTTP操作、67个显式record映射。23张业务表不变，无DB migration。
- `git diff --check`与部署浏览器脚本语法检查通过；用户后续授权后执行了实际CEA上线验证，见下文。

## 直接验证的行为

- MySQL聚合超过列表页容量的执行；UTC边界、空窗口、失败/取消区分、最新10条及READ/跨命名空间权限。
- USER和EDGE_POLICY执行从自身不可变definition读取嵌套输出声明；Flow保存新修订后仍返回旧执行端口。浏览器产物和Metrics不再请求Flow管理源码。
- 真K3s节点、配置Namespace、Service端口及limit/continue分页；拒绝跨命名空间读取/Service写操作。不可达连接明确失败，不返回空列表冒充成功。
- 真Job/S3 JSON产物按轮次逐实例读取，切换第1/2轮不串值；非法JSON显示错误并清空旧内容。原UI-06有界读取、成功Attempt及精确URI校验回归保留。
- 原有编排、保存/执行/取消、修订、Loop/SELECT、管理页面与算法回归全部保留。没有新增执行/调度路径或Pod日志采集。

## 发现的问题与复测

1. 首轮浏览器44项通过后，视觉检查修正页面边距、窄屏表格、30日图滚动和产物切换状态；最终44项在最新代码上重跑通过。
2. 首轮verify于18:56:09失败：新overview测试残留125条执行，使紧随的全局drain超时。改为finally清理该用例自己的队列/TaskRun/Execution；未修改生产超时。另有既有卸载测试JDBC连接关闭和NamespaceFile接管等待超时；首次与浏览器基础设施并发，不能据此认定原因。后续串行完整回归已通过，未放宽等待条件或改执行逻辑。
3. 第二轮19:09:36通过219项，随后发现产物声明经USER限定Flow API不适用于EDGE_POLICY，改为现有Execution快照的只读output-files接口，未添加跨范围兼容回退。删除前端重复遍历后Node测试由42项变为41项，嵌套与范围改由后端真实快照测试覆盖。
4. 第三轮19:24:28仅新增快照测试失败：样例漏填必需command，被FlowValidator拒绝。仅补测试样例`[echo, fixture]`；19:25:00该用例与ContractTest共4项通过，随后最终220项完整回归通过。

## 证据与部署边界

原始日志位于忽略目录`.local/ui07-verify-acceptance.log`、`.local/ui07-e2e-acceptance.log`；截图在`frontend/.local/evidence/`的overview/resources/artifacts desktop/narrow文件。不提交运行配置、凭据或临时数据。

开发预览曾使用18120及已有CEA代理，隔离验收结束后已关闭该临时预览；随后用户单独授权“部署”。Pod日志、CPU/内存利用率、二进制下载和全局对象存储管理仍未实现；不扩展DQN或数据处理速率口径。

## CEA发布（2026-09-12，用户已授权）

- 复用53ff620对应的已验收JAR/静态资源，构建`cea/backend:local`和`cea/frontend:local`，未重跑或改写算法镜像。部署前无活动Execution/TaskRun（含afterExecution）。保存业务/容器/RBAC快照及`cea/backend:before-ui07`、`cea/frontend:before-ui07`，确认回退镜像与原运行镜像相同。
- 四集群原Role/ClusterRole与上一版规则一致后，使用带resourceVersion/rules检查的JSON Patch只替换规则；没有重建Namespace、SA、Secret或Binding。`can-i`验证节点list、cea-lab Service get/list及该Namespace get允许；Namespace list/default读取、default Service读取、Service create/update/delete均拒绝。
- `compose up -d --no-deps --wait backend frontend`仅替换这两个容器，19:50健康检查通过。后端镜像`sha256:c68272ece8c2677b28571df1a83fc2d8415ccdae855e733cabb1faaac59d1192`；前端镜像`sha256:5d8359ffb6a3ba925b6ba5c272a4c0faf21b0c1db3285aa6e46d31cb3b3e92c4`。实际18080提供`index-DbvYwXXc.js`。
- 19:51:23 `deploy/cea/verify-browser.mjs`在实际18080返回PASS：总览与API一致；cloud/edge-a/b/c的Node/Service/配置Namespace查询正常；FedAvg/FedProx历史JSON与Metrics正常；既有编排/管理只读检查、桌面/390px通过，无pageerror。未提交新训练或保存草稿。
- 发布前后深比较PASS：FedAvg r5/FedProx r3及全部修订、4条Execution、38个TaskRun与Attempt不变；其余10容器的ID/StartedAt/镜像ID完全一致。未迁移数据库、清理卷或修改旧系统。
- 本次不重复声明前述220/41/44回归为新一轮测试；本次执行的是同一已验收产物的Docker构建、受限RBAC验证、上线健康检查及真实CEA浏览器/API复核。
- 本地证据：`.local/UI07-deploy-baseline.json`、`UI07-deploy-after.json`、`UI07-rbac-before.json`与`ui07-deploy-*.log`；最新页面结果/截图在`.local/cea/browser/`，上一版截图已保存在`.local/cea/browser-before-ui07/`。这些运行数据及配置不提交Git。
