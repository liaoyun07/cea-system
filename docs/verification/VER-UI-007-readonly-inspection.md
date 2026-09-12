# VER-UI-007 只读查看增量

日期：2026-09-12。状态：PASS（实现与隔离验收）；CEA未发布。源码基线cd5db9c加本批UI-07提交；环境Windows、Microsoft JDK21.0.12、Node24、Docker Desktop及独立MySQL/K3s/Registry/MinIO。

## 最终结果

- `scripts/verify.ps1 -JavaHome C:/Users/liaoy/.jdks/ms-21.0.12.1`于19:37:20通过220项：35 runtime、184 server、1实际JAR；失败/错误/跳过均为0。
- `npm test`41项通过；`npm run build`、`npm run format:check`通过。构建资产为`index-DbvYwXXc.js`、`index-DMAQk_D4.css`。
- 完整verify之后串行执行`npm run test:e2e`，44项真实浏览器测试通过（2.2分钟），隔离测试脚本正常退出0并清理自身环境。19:40核对桌面及390px截图：总览、资源、逐轮产物预览均可操作，无页面横向溢出；长资源表可在表内横向滚动。
- `scripts/check-scaffold.ps1`通过：8模块、89个Java文件、32个功能编号；接口契约为57个HTTP操作、67个显式record映射。23张业务表不变，无DB migration。
- `git diff --check`与部署浏览器脚本语法检查通过。CEA上线脚本本批只更新，未对真实CEA执行。

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

开发预览曾使用18120及已有CEA代理，但正式验收使用全新隔离环境；18080/18085未更新，CEA RBAC未应用，已有Flow/Execution及旧系统未修改。发布时需要用户另行确认前后端更新与四个CEA集群的受限只读RBAC。Pod日志、CPU/内存利用率、二进制下载和全局对象存储管理仍未实现；不扩展DQN或数据处理速率口径。
