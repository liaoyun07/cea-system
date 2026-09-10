# UI-01：独立前端最小闭环

2026-09-11用户授权。新工程位于仓库内`frontend/`，独立npm构建/启动，不是Maven模块，不修改旧amis/web-platform。S7、计量、长期DQN、可视化拖拽和资源管理页面不在本批范围。

## 边界与实现计划

- UI-01a：Vue + Vite工作台、内存Basic认证、命名空间、同源API代理、真实模板列表/搜索/分页。
- UI-01b：原始YAML编辑、服务端校验、expectedRevision CAS保存、未保存提示；读取已保存Flow.inputs生成运行表单，提交固定修订。
- UI-01c：Execution列表/详情、TaskRun/Attempt、增量日志、输出/失败/取消；afterExecution单独展示，不把主终态等同于全部后处理完成。
- UI-01d：构建、输入转换/错误/幂等单元测试、隔离MySQL + 原JAR联调；文档与Git同步。

## 决策

参考本地Kestra `0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4`的`ui/src/components/flows/useFlowEditorActions.ts`（未保存变更、保存与执行分开）和`FlowExecutions.vue`（执行展示复用Execution数据）。本批只沿用单Flow源与编辑/执行分界，不复制插件安装、Playground、文件多面板等复杂度。

使用Vue/Vite实现小型客户端，与Java API保持独立；不新增后端类、表、API或第二套绑定。API配置来自开发服务器环境变量，不让用户在页面中向任意地址发送凭据。认证值只在页面内存保存，不存localStorage/sessionStorage；刷新需重新登录。发布时由站点反向代理`/api`，不放宽后端CORS，不内置管理员密码。非本机部署必须安排HTTPS。

API事实见[编辑协议](../contracts/s6-flow-editing.md)、[前端对接边界](../contracts/ui-console.md)。Vue/Vite用法参考[Vue官方快速开始](https://vuejs.org/guide/quick-start.html)和[Vite代理配置](https://vite.dev/config/server-options)。

## 验收

连接失败/401/403/409/422显式展示；空列表不伪造数据。YAML无效不能保存；保存冲突保留编辑内容，不自动覆盖。未知输入、类型/必填约束由服务端最终校验。重复点击不产生双提交；网络结果未知时保留原请求与键供原样重试。日志轮询不得重叠、不得每轮全量累加，离开/断开即停止。只把实际后端状态作为状态源。

UI-01a至d已完成最小闭环；9项Node测试、11项真实浏览器测试及构建/格式检查通过，完整Java回归212项Maven/12项Python通过。失败及修正、测试限制见验证记录；未进入本页排除范围。

用户补充要求风格/操作尽量参考Kestra，本批追加核对`MultiPanelFlowEditorView.vue`和`ui/src/components/executions/Executions.vue`：采用深色导航、紫色动作、源编辑顶部操作栏、执行概览/任务/日志/输出标签；保留中文、基础文本编辑和内存认证的有意简化，不复制插件/多面板/自动安装等能力。验收见[记录](../verification/VER-UI-001-console.md)。
