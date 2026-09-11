# VER-UI-002：同源 No-code 编排

日期：2026-09-11；基线提交78387ba。实现为本批UI-02差异，最终状态PASS，首轮失败及复测过程保留如下；最终代码由本批Git提交追溯。

## 范围与参考

仅backend/frontend、说明文档及CEA只读浏览器验证脚本；不改Java、SQL迁移、业务数据或执行链。应用/资源/Schema读取及修订回退均消费既有API。参考本地Kestra提交0354ddf8cb的MultiPanelFlowEditorView.vue、TaskEditPanes.vue、useNoCodePanels.ts，以及[官方流程UI](https://kestra.io/docs/ui/flows)。采用同源表单/源码与分组块，不复制其插件系统或全部面板。

## 验证环境与命令

Windows、Node24.19.0、Vue3.5.42、yaml2.9.0、Playwright1.63.0、JDK21（ms-21.0.12.1）、Docker Desktop。前端E2E拥有独立临时MySQL、随机端口/账号和真实后端JAR，结束清理本次资源，不连接CEA业务库。CEA复核只读。

```powershell
cd frontend
npm run format:check
npm test
npm run build
$env:CEA_JAVA_HOME='C:\Users\liaoy\.jdks\ms-21.0.12.1'
npm run test:e2e
cd ..
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify.ps1 -JavaHome 'C:\Users\liaoy\.jdks\ms-21.0.12.1'
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-scaffold.ps1
```

前端最终源码：23项Node单测PASS、19项真实JAR浏览器测试PASS（1.0分钟）、构建/格式检查PASS，生产依赖audit报告0项漏洞。包含收尾生命周期作用域、无效字段结构和空任务组修正。scaffold：8模块/86 Java/32功能编号/406链接PASS；git diff --check通过，待提交差异不含本地CEA凭据值。

完整后端verify首轮13:26:53失败：runtime33项通过，server178项中2项ERROR、0断言失败、0跳过，Failsafe未执行。失败为ImageDistributionTest的`terminalPreservesQuotedMultilineParametersWithoutHostShellInterpretation`在Worker heartbeat遇到MySQL通信超时，以及`terminalCancellationStopsContainerBeforeFinally`等待终端启动超过40秒。未改后端/测试阈值、未删测试。

同源码第二轮完整verify于13:39:37结束（11分49秒）PASS：runtime33 + server178 + 实际JAR部署Failsafe1 = 212项，零失败/错误/跳过。ImageDistributionTest 33项全部通过，并通过真实容器执行断言验证7项test_federated与5项test_training。原两项超时未重现；只能说明本轮复测通过，不宣称已定位/修复其偶发根因。日志在`.local/ui02-verify-rerun.log`和Surefire/Failsafe报告，未计入Git。

13:28:40首次更新及13:38:24最终更新后，CEA实际浏览器只读复核均PASS：两保存Flow的No-code/应用表单/源切换、两成功Execution、各6个train实例、outputs和真实日志空态均可读；无pageerror。只重建并替换frontend，其余11个容器ID/StartedAt与更新前一致。最终静态脚本`index-INKtFJ7N.js`已进入Nginx镜像，访问18080，不使用Vite开发服务器冒充部署。

## 发现及修正

- 新增任务弹窗显式补充可访问标签；textarea测试改为检查value而非textContent，保留原验收目标。
- 修订回退实际已创建r3，但异步source watcher清掉成功提示；改为同步清理旧提示后设置新反馈，保存/回退API不变。
- YAML库新增空组必须创建Sequence节点，修正添加/移动到缺失errors/finally等组；补充单测。
- 新Application草稿需满足当前后端timeout/command约束：提供可编辑5分钟初始超时及空command列表，必须由作者填写真实命令，不假设某个镜像入口。测试经表单显式填命令后校验。
- JSON嵌套超大整数/非有限值拒绝写入，避免精度丢失。无效YAML和非对象Task保留原文并暂停No-code，不闪退。
- 生命周期引用严格对齐既有FlowValidator：Errors可引用主任务，Finally再包含Errors，AfterExecution再包含Finally；Flow输出沿用主树（排除动态子实例）的允许范围。只是选项修正，不改后端语义；新增回归验证。

## 证据与边界

前端截图/trace位于忽略目录`frontend/.local/evidence/`和`frontend/test-results/`；CEA实际截图在`.local/cea/browser/`。不上传凭据或运行数据。

浏览器测试包括纯No-code创建Log/Loop并实际执行、目录契约绑定、DAG后定义上游、引用删除保护、YAML/表单往返、移动端、修订比较回退和121节点切换/目录失败重试；原11项认证/CAS/执行/日志/取消测试保留。FedAvg/FedProx本批验证DSL往返和实际已部署记录可读，不宣称重新运行训练或物理多云/性能达标。

不涉及新增Java类/字段/表/API/SPI，Execution主链未变；完整资源管理、Pod stdout采集、指标/数据处理速率、长期DQN、旧切换仍未实现。
