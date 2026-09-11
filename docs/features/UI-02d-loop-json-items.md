# UI-02d：Loop每项JSON文本编辑

2026-09-12，按用户“就先改这个，其它都别动”限定范围：只将Loop固定values数组中的每项换成一个JSON文本框；不是将整个values合并进单一文本框。

- 保留每项编号、添加、删除、上下移动及既有集合来源选择。移除元素内部的Object/Array/String类型下拉和递归字段增删。
- 每项按JSON解析，字符串带双引号；对象、数组、字符串、数字、布尔值及null保持原类型。复用parseJsonValue的安全数值检查，不增加JSON字符串运行时解析或表达式来源。
- 文本框保留编辑中的原文，合法值经原patch写入同一YAML；非法JSON不写回、不清空，使用原invalid机制阻止保存/执行与重排；修正后恢复。移动/删除或源码变化时按原数组数据更新回显。
- 仅改已有JsonValueField.vue及其已失去消费者的递归样式。它只有LoopValuesField一个外部消费者，来源/循环/执行逻辑不改。没有新增Java类、表、API、DSL字段或第二套绑定。
- 不改Flow.inputs、任务共有属性、Schema接口、Application编辑器、FedAvg/FedProx定义或执行链；不实施上一轮更广泛的统一表单方案。

参考本地Kestra 0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4 的TaskArray.vue逐项编辑/排序与TaskExpression.vue内联文本方式。本批有意只支持JSON文字值，不引入其YAML/Pebble/ION语义。Sites技能只用于保持现有视觉和桌面/窄屏检查。

验证与部署状态见[记录](../verification/VER-UI-002d-loop-json-items.md)。用户已当次授权测试后只更新18080前端，其它CEA服务与已存业务数据保持不变。
