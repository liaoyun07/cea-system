# UI-02d逐项JSON编辑验证

2026-09-12，PASS，已部署。源码基线c2d5661003ce7171268f95f908c27a235b5ae572加本批差异。

范围：[功能规格](../features/UI-02d-loop-json-items.md)。仅前端，不改Java、数据库、流程或其它模块。

- Node单测31项、真实浏览器37项全部通过（浏览器1.8分钟），生产build和Prettier通过。
- 浏览器覆盖每项恰好一个textarea/无类型下拉、JSON对象含嵌套数组/null/布尔值、字符串与数字区分、0/false/空字符串、逐项键入不被格式化覆盖、添加/删除/排序后的回显与真实Loop执行输出、FedAvg/FedProx同源往返。
- 非法JSON、空白编辑和不安全整数保留原文，YAML不变并阻止保存/重排/来源切换；修改其它有效项不会覆盖错误草稿；修正后恢复。原INPUT/VARIABLE/TASK_OUTPUT及确认取消回归通过。
- 桌面/650px窄屏截图已人工查看，无横向溢出；沿用现有配色与字号，仅JSON文本使用等宽字体。18120开发预览HTTP200，应用内打开请求返回queued。
- 完整Maven verify本批215项通过，耗时11分50秒，2026-09-12 02:45:02 +08:00结束；scaffold通过（8模块、86个已索引Java文件、32功能编号、444本地链接），git diff --check通过。
- 按用户确认，02:45:17 +08:00只替换CEA frontend，健康检查及nginx -t通过；02:45:54 +08:00实际18080浏览器只读复核PASS，FedAvg/FedProx每项一个JSON文本框、无元素类型下拉，截图已人工查看。
- 部署前后两Flow源码/修订与四条历史Execution的状态/输入/输出不变，无活动执行；其余11个CEA容器ID和StartedAt均不变。未保存或运行新的CEA业务流程。

发布镜像cea/frontend:local，镜像ID为sha256:5619b0a21f29be051a617e88e397d322db623418f2516b17e28bd853c8c3a097；前端容器ID为9100d2718d4bee5217edf0e4d2b31aa99ff617544145f1d9c2e9d59d03a5d4e7，StartedAt为2026-09-11T18:45:17.465685411Z。既有业务数据仍是原修订，本批仅改变编辑方式。

环境为Windows、JDK21、Node24.19.0、Vue3.5.42/Vite8.3.0；浏览器测试使用独立MySQL、Registry、K3s和打包JAR，不修改CEA业务数据。日志位于frontend/.local/UI02d-unit.log、UI02d-build.log、UI02d-format.log、UI02d-e2e.log及.local/UI02d-verify.log、UI02d-frontend-build.log、UI02d-deployed.log；测试截图为frontend/.local/evidence/loop-values.png、loop-values-narrow.png，部署截图为.local/cea/browser/fedavg-loop-values.png和fedprox-loop-values.png。本地日志/快照/凭据/产物不提交Git。
