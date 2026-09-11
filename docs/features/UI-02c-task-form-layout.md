# UI-02c：任务字段纵向排版

2026-09-12用户要求参考Kestra截图，任务类型的必填字段在前，其余字段连续向后排列，不以标签切换误导为并列功能。依赖UI-02同源编辑，不增加领域功能编号。

## 本批行为

- 任务面板先显示type、id，再显示该任务类型的必填配置。现有任务的type/id仍只读，不增加改名传播或类型替换能力；添加任务仍在原对话框选择类型和ID。
- Loop直接显示values、concurrency、outputs，不额外套一层loop对象编辑框；Repeat直接显示iterations、initial、feedback；Http/Sql同样展平已有任务配置。实际YAML路径仍为loop.values、repeat.iterations等，没有DSL迁移。
- Log/Sleep/If显示其消息/等待时间/条件；Http/Sql/Application的timeout放在必填区。应用目录、契约参数、位置/文件绑定仍使用原专门控件。控制任务不再提供后端不允许的timeout/retry入口，HTTP POST不显示retry；隐藏不删除已有源码字段，非法配置仍由后端拒绝。
- 必填标记为表单提示，不引入第二个验证器；保存/预览/提交仍由FlowValidator/BindingResolver校验。
- values下用普通“集合来源”下拉：固定集合、流程输入、流程变量、上游输出；其下仅展示当前来源的编辑字段。取消Array/引用标签，不把数据来源包装成视图切换。
- 来源变更仍替换该字段的草稿配置；继续保留确认，取消时连下拉回显也保持原值。由INPUT切回固定集合时，沿用已有逻辑复制该输入的数组默认值；不自动迁移到inputs，不保存两套非活动配置。
- Flow全局输入/变量/输出仍在流程设置中，不把它们重复塞进每个Task。外层“可视化/并排/源码/结构参考”是真正编辑视图，不属于本次取消范围。
- 固定集合的递归元素编辑暂保持现状；本批不顺带实现整段YAML/JSON元素编辑或Kestra的String表达式解析，不改变原Binding语义。

## 实现与消费者

NoCodeEditor调用document.js的taskFormFields取得当前面板需要的字段次序、原Schema和必填提示，并传给既有SchemaField。SchemaField.required只用于显示星号。LoopValuesField直接选择原Binding.source，BindingField.hideSource由Loop消费以避免重复来源下拉。CSS只调整连续字段间隔和分隔线。

没有新增生产Java类/字段、表、API、SPI或任务状态。没有新增执行入口、编排模型或数据库迁移；调用链仍为No-code → 同一YAML草稿 → 原保存/校验API → 原执行链。

## Kestra参考与边界

参考本地Kestra源码ui/src/components/no-code/components/tasks/TaskObject.vue的sortProperties（身份/必填字段前置）及TaskArray/TaskExpression编辑职责。源码基线0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4；结合用户当前截图，不声称每个Kestra版本排版相同。

沿用“必填在前、字段连续编辑”的思路；本项目的INPUT/VARIABLE/TASK_OUTPUT是结构化Binding来源，不能直接冒充Kestra的String/Array值形态切换，因此显示来源下拉。本批有意保留当前后端及元素编辑方式。Sites技能用于保持现有Vue视觉语言与桌面/窄屏检查，不新建托管站点或引入依赖。

## 验收

字段顺序与必填标记、无额外loop套层/不适用入口、来源选择及确认取消、保存回读不改原Flow内容、既有执行回归；结果见[验证记录](../verification/VER-UI-002c-task-form-layout.md)。用户已当次确认测试后仅更新CEA前端，不修改业务Flow或重启其他服务。
