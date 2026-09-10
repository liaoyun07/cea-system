# VER-UI-001 独立前端最小闭环

日期：2026-09-11，基线67af86b（S6），本批UI-01；最终代码由本次Git提交追溯。范围见[规格](../features/UI-01-console.md)，操作见[README](../../frontend/README.md)。

## 环境与结果

- Windows、Node24.19.0/npm11.17.0、Vue3.5.42、Vite8.3.0、Playwright1.63.0/Chromium153；JDK21.0.7、MySQL8隔离容器及真实platform-server JAR。依赖锁定package-lock，npm audit报告0项漏洞（本次安装时结果，不是长期保证）。
- `npm test`：9项通过，覆盖六种输入、false/0/空字符串/省略、类型错误/安全整数、固定提交快照、日志去重窗口、终态、Basic编码、请求头/状态错误。
- `npm run build`与`npm run format:check`：通过。静态JS约94kB/CSS约13kB（压缩前），无运行时CDN或第三方图片/字体请求。
- 首轮7项浏览器测试：3通过、4失败，原因是前端日志limit=200超过后端100上限，修正前端后第二轮10项全通过（32秒）。没有通过放宽后端约束掩盖问题。
- 初次E2E启动脚本根路径多回退一级，在创建临时DB前失败；改正为frontend目录。Playwright会清理test-results，后端日志移到.local/evidence避免丢失。
- 第二轮真实浏览器10项通过：401/403及内存凭据、YAML保存/校验/预览/执行/日志/输出/Attempt、422/409和空草稿未保存提示、真实接受后丢响应的同键重试仅一条Execution、取消Sleep、主终态后继续后处理、空搜索/Schema/390px布局、六类型/必填及并发更新仍执行固定r1、真实超时FAILED、21条模板分页及既有源往返。
- 第三轮增加动态Loop 105个元素、106个TaskRun、超过100条日志分页、退出停止轮询；11项全部通过（41.2秒）。收尾将日志查询置于状态读取之后，避免刚结束的任务最后日志因并行读取竞态漏显；最终同套11项全部通过（44.8秒），零失败/跳过，不重复累加轮次数。
- 本次完整`scripts/verify.ps1`重新执行，00:45:59结束，11分13秒：212项Maven（0失败/错误/跳过）及12项Python通过。Java无修改，不重复累加前端定向复测和历史测试数。

## 真实验证边界

浏览器访问构建后的dist，由Vite preview同源代理到测试脚本启动的实际JAR，MySQL独立新库。没有Mock列表/保存/状态成功。丢响应测试仅在真实后端返回202后中断浏览器响应，验证同键重试未产生新执行。超时/取消均来自真正执行的core.Sleep。每项检查未捕获浏览器异常为空；本地截图查看编辑/执行/窄屏，未发现水平溢出和控件重叠。

后端完整回归包含真实FedAvg/FedProx容器数值测试，但本批浏览器只运行通用Log/Sleep/Loop，不声称从页面完成物理多云训练或完整生产部署。不含S7、性能、DQN、全部管理页、前端安全渗透测试或其他浏览器验收。

生产Java仍86、Maven模块8、业务表23、HTTP操作51；无迁移/API/状态机/Runner/SPI变化。主链保持原样。只有前端展示状态与未决请求，不维护第二套持久Execution。

## 证据与清理

本地日志：platform-server/target/ui-01-backend-verify.log、Surefire/Failsafe；frontend/.local/evidence/backend.log、editor.png、execution.png、flows.png、mobile.png；Playwright失败trace/test-results和报告均Git忽略。证据不包含生产凭据，测试凭据每次随机。

E2E用脚本创建的精确容器ID清理本次临时MySQL（测试数据随容器删除，不可恢复、无需保留），停止本次新JAR/预览，不操作旧AMIS、IDEA服务、业务DB或既有集群。正式环境接入/旧系统切换仍待用户后续确定。

收尾结构检查通过：8模块、86份Java、32个功能编号、387个本地文档链接；git diff --check通过。单独启动的frontend开发预览保留在127.0.0.1:18100供用户访问，默认代理18085；未代用户启动日常后端，登录需要用户自行启动的新后端和配置账号。
