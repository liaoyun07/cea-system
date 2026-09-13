# UI-06 执行 Metrics

状态：DONE（代码、验证与CEA发布）。用户确认后于2026-09-12 17:15仅更新前后端，17:16:52实际历史指标页面复核PASS；存量Flow/执行及其它10服务不变，详见验证记录。

UI-06a（2026-09-13）：前端图表新增柱状/折线切换；本增量的验证及独立发布状态见[记录](../verification/VER-UI-006a-chart-switch.md)，不沿用上面UI-06的发布结论。

## 当前范围

展示现有任务成功产物中的数值指标。FedAvg/FedProx的evaluate已经输出metrics.json（loss、accuracy、samples、round及algorithm）；train未输出逐epoch指标，不能声称已展示训练过程。不涉及数据处理速率、计量SDK、DQN、Pod日志或跨执行指标仓库。

## Kestra依据与取舍

本机源码 `D:/Project/Kestra/kestra`，提交 `0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4`：

- `core/.../runners/DefaultRunContext.java:metric`收集插件上报的结构化指标。
- `core/.../models/executions/MetricEntry.java`包含executionId/taskId/taskRunId、name/type/value/timestamp/tags；不是扫描metrics.json。
- `webserver/.../controllers/api/MetricController.java`按Execution、Task或TaskRun查询。
- `ui/src/components/executions/ExecutionMetric.vue`及`MetricsTable.vue`提供任务/指标表，openChart按同一任务与指标名查询，使用单指标柱图。

沿用实例身份、单指标图和明细；有意简化为已有产物的按需读取，不复制通用采集、队列、指标Repository或Timer/Counter聚合。此时真实消费者只有现有算法结果展示；没有新增计量表的需要。

## 主调用链与所有权

Metrics页 → 固定Flow修订及现有TaskRuns → `ExecutionController.outputJson` → `ExecutionOutputService.readJson` → `FlowExecutionService` READ授权/执行和实例查询 → `ObjectStorage.readPublished` → 已配置对象存储。

- 使用Execution固定修订确认container.outputFiles，不读取最新Flow当历史定义。
- TaskRun必须属于此Execution，状态SUCCESS；选成功Attempt；URI必须精确等于平台发布的namespace/execution/taskRun/attempt/filename地址。
- Execution本身不要求SUCCESS，因此运行中或后续失败的执行仍能查看前面已成功任务的真实结果；不会把整体执行改成成功，也不读取失败Attempt的未提交产物。
- URI来自TaskRun.outputs，不接收用户输入URL、Bucket或凭据；只读已声明.json文件，最多262144字节且必须为单个JSON对象，重复键/尾随第二个JSON/非对象拒绝。
- API返回JSON对象原值，不造出指标时间点。页面标注的“完成时间”是TaskRun.endedAt，而非算法采样时间。
- 前端只把顶层有限Number字段作为指标，不把字符串/null/嵌套对象转数值；字符串/布尔字段列为标签。无数值显示空状态；读取失败保留错误，不补0。
- 按taskId及文件选择，实际行身份是TaskRun.id；parentTaskRunId与iteration形成`rounds[2] / clients[3] / train`等上下文，不能按taskId合并多轮。重试只读最终成功Attempt产物，不显示失败Attempt的未提交结果。
- 每页20个真实实例，最多4个并发读取；图只表示本页/当前指标，横轴实例序号，纵轴含0基线。不同量纲不叠加；缺失值无柱/无点。所有原值保留在表格。
- 图表右上角普通按钮组切换柱状/折线，默认柱状；选中项高亮并提供aria-pressed。切换仅更新当前组件的显示状态，不发请求、不修改指标、排序、坐标范围或表格，不持久化设置。当前页内刷新/切换指标保留图形选择，离开Metrics再进入恢复默认。
- 折线使用与柱图相同的实例横坐标和数值纵坐标，直线连接连续有效点，不平滑、不插值、不跨缺失点连接；仅一个有效值显示一个圆点，零值保留。悬停显示对应实例及原始数值。不是跨执行或按时间采样的趋势图。
- TaskRun状态/产物变化触发本页刷新；其它失败手动重试，切换来源/页面或离开取消旧请求，旧结果不覆盖新选择。

Execution、Worker、Runner主链未变。无DB migration、表/列/DSL/Binding/SPI/算法镜像变化。新增Java仅ExecutionOutputService（及其安全502异常）；ObjectStorage、ExecutionController、RuntimeConfiguration、ApiExceptionHandler增加当前读取消费者所需的方法/装配。

## 前端边界

ExecutionMetrics.vue负责固定修订/来源/有界读取/图表/明细；execution-metrics.js负责JSON指标、实例上下文投影和缺失断线的SVG路径；ExecutionDetail只增加Metrics页签。沿用现有视觉样式，不增加常驻解释文字或图表依赖。UI-06a只改前端组件/函数及测试，未新增Java/API/DB/DSL/SPI，执行与读取链不变；不宣称新增了Kestra通用Metrics采集能力。

未做跨执行趋势、训练epoch采样、嵌套JSON路径选择、自定义指标Schema、实时SDK采集、全局产物浏览/下载。旧产物若已被清理则明确404；不会重新训练或自动补造。

页面沿用USER Flow固定修订API；该来源若因策略管理范围或权限不可读取，则明确报错，不退回最新Flow或跨范围绕过读取。本批不扩展策略源读取API。

验证见[VER-UI-006](../verification/VER-UI-006-execution-metrics.md)。
