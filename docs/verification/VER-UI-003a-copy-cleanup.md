# UI-03a 页面说明删除

日期：2026-09-11。基线：`f4b522c5dfbec6c9f8b08c2bd38af32913c3ea9a`；本次差异由后续Git提交追溯。

## 范围

按用户要求直接删除常驻说明，不移入展开帮助或tooltip。仅前端模板、目录展示配置和样式改变；保留字段/状态/数据、错误/确认/结果。无Java类、DB字段/表/API/SPI变化，主调用链未变，不涉及工作流语义或新的Kestra能力迁移。

## 验证

- Node 24.19.0、Vue 3.5.42、Vite 8.3.0、Playwright 1.63.0；JDK 21。
- `npm test`：29项通过。
- `npm run build`、`npm run format:check`：通过。
- 新构建本地预览对接真实CEA只读API：十个列表页通过，1440px和650px截图检查通过，无横向溢出和浏览器错误；未保存/提交业务记录。首次临时检查脚本未选部署集群便等待刷新按钮启用，按实际交互先选择cloud后通过；未因此修改产品逻辑。
- 浏览器回归：29项全部通过（1.6分钟），包括十个列表页面无说明段落/无替代帮助入口、原字段和保存按钮可用检查；原错误、冲突、真实镜像分发/部署、执行测试通过。随后仅删除两条已无DOM消费者的说明样式，并再次通过构建/格式检查。
- 完整 `scripts/verify.ps1`：2026-09-11 14:59:54 +08:00通过，212项Maven测试（33+178+1），零失败/错误/跳过，耗时11分49秒。没有修改后端代码或放宽测试。
- `scripts/check-scaffold.ps1`：通过，8模块、86份Java、32个功能编号，未增后端结构。
- CEA前端部署：用户确认后于2026-09-11 15:03完成。只读浏览器复核、Nginx配置及健康检查通过；其余11个容器ID和StartedAt与更新前一致，不操作业务数据。

本地日志：`.local/UI03a-verify.log`、`frontend/.local/UI03a-e2e.log`；浏览器截图位于`frontend/.local/evidence/`，不提交凭据或本地产物。

## 部署复核

发布源码`591b42c42b2ec77503ee6a57830b7fcd0f628246`的已验证静态产物，仅运行`docker build -f deploy/cea/frontend.Dockerfile -t cea/frontend:local .`及`Invoke-CeaCompose up -d --no-deps frontend`。本次打包部署没有重编译后端或重跑前述全量回归。

- 前端容器：`3187ba42b775b2efe536e419c5eaa658c5bb575b71d6deb60929f63479847343`；StartedAt `2026-09-11T07:03:11.164395301Z`，healthy。
- 镜像：`sha256:42a8d08501dd63a366539a22e04709d89bb6c24394e998f8427984e14acc7a43`；18080实际返回`index-CjLnCnyC.js`，两处截图对应的旧说明已不在该产物中。
- `node deploy/cea/verify-browser.mjs`于15:03:17通过：应用5、集群4、数据集2，网关/终端/策略/观测和四集群部署列表与API一致；FedAvg/FedProx已有流程、动态实例、输出及日志空状态正常，未创建任务或修改目录。
- 实际部署截图/结果：`.local/cea/browser/`。集群页截图确认说明已删除，无替代帮助入口；不重启后端、数据库、存储、Registry或算法集群，不影响旧系统。
