# UI-02a 候选集群选中反馈

日期：2026-09-11。基线：`6f4abb170deab69080c6019c0cc80c87cf222aa2`。

## 原因与修改范围

原登记集群按钮只把ID追加到candidateClusters，按钮一直显示“＋”且没有选中样式；候选列表位于上方而按钮位于文件配置之后，用户点击时看不到更新。改为紧邻候选字段的可切换按钮：高亮、勾选、aria-pressed和实际已选计数；再次点击取消。固定列表与等价LITERAL切换保留列表，避免切回时清空既有选择。

仅修改NoCodeEditor、CSS、浏览器回归与部署复核脚本。选中状态直接读取唯一YAML文档，无新缓存、Binding、Java类、DB表/字段、API或SPI；Execution主调用链及调度语义不变。不涉及新的Kestra工作流能力迁移，保留UI-02的同源编辑边界。没有增加说明文字、tooltip或展开帮助。

## 验证与发布

- Node 24.19.0 / Vue 3.5.42 / Vite 8.3.0 / Playwright 1.63.0 / JDK 21。
- `npm test`：29项通过；构建、格式检查和scaffold通过（8模块、86份Java、32个功能编号）。
- 旧产物回归：28通过、2失败，两处均复现按钮没有aria-pressed/选中反馈。
- 修复后首轮：29通过、1失败。新增保存测试的模板漏写Application必填timeout，后端正常拒绝422；补齐测试模板，未放宽产品校验。
- 随后30项真实浏览器回归通过（1.5分钟）：初始回显、多选/取消、YAML反向同步、固定列表/LITERAL往返、真实修订保存回读、禁用限制、FedAvg/FedProx以及650px窄屏。夹具为独立MySQL/JAR/Registry/K3s，不保存生产CEA流程或创建生产执行。
- 用户确认后17:09发布并做真实CEA只读复核，状态、目录和其他11个服务均正常。截图进一步发现通用hover样式把已选按钮变成浅底白字；补充专用hover样式及CSS断言后，再次30项浏览器回归全部通过（1.5分钟），17:13发布最终版本并再次只读复核PASS。全部操作只更新frontend；生产流程中的测试点击只改本地草稿，随后恢复原文，没有保存。
- 完整 `scripts/verify.ps1 -JavaHome C:/Users/liaoy/.jdks/ms-21.0.12.1`：2026-09-11 17:20:21 +08:00通过，212项Maven测试（33+178+1），零失败/错误/跳过，耗时11分59秒。没有修改后端实现或放宽测试；最终scaffold通过420个本地链接检查。

本地日志：`frontend/.local/UI02a-before-e2e.log`、`UI02a-e2e.log`、`UI02a-e2e-final.log`、`UI02a-e2e-hover.log`；后端`.local/UI02a-verify.log`；部署`.local/UI02a-deployed-browser.log`。截图位于`frontend/.local/evidence/`与`.local/cea/browser/`，不提交凭据或本地产物。

## 最终部署复核

- 前端容器：`b3648f681e078d0a333f00e5c62d35f688a2aea45b9068db7bd656d5ac098725`，StartedAt `2026-09-11T09:13:09.545550322Z`，healthy；Nginx配置检查通过。
- 镜像：`sha256:0c9729a2f0436577fd35fe3e23edc3cc0e6a44b6538a4a74c879617762f9c58d`；18080返回`index-D5WvG2_6.js`和`index-C5SmGrUm.css`。
- 17:13:17只读复核PASS：FedAvg/FedProx的init已选cloud正确回显，edge-a点击选中/再次取消、深色悬停以及1440px/650px截图均通过；不保存草稿或创建任务。目录与运行结果查询保持正常，其他11个CEA服务的ID和StartedAt与更新前一致。
- 最终部署日志：`.local/UI02a-deployed-final.log`；真实截图：`.local/cea/browser/fedavg-cluster-selection.png`及`fedavg-cluster-selection-narrow.png`（另含FedProx）。
