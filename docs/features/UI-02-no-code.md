# UI-02：同源 No-code 编排

状态：DONE（当前DSL范围）；用户于2026-09-11授权，并同意测试后只更新CEA前端。23项Node、19项浏览器、212项Maven及12项容器内Python测试通过，实际CEA前端更新/只读复核通过。不是全Kestra功能对等或新后端功能。

## 设计与当前消费者

UI-04增量：Flow Inputs可选SELECT，values逐项配置，defaultValue从选项中选择；删除默认值对应选项时保留原值供修正，不静默换值。非SELECT不显示空values，但保留误填的现有values供删除并交服务端校验。执行表单保持原默认值/提供开关，SELECT提供下拉，不隐式选首项；边界与验收见[SELECT规格](UI-04-select-input.md)。

- FlowEditor.source是唯一编辑源。No-code使用yaml库的Document节点按路径修改，不从表单重建整份Flow；保留未知/未覆盖字段及未修改节点的注释。序列化可能调整空白/折行，不承诺逐字节不变。无效文档不允许表单写入，保留原文供修正。
- 中间分组任务块与右侧表单，支持主任务、Errors、Finally、After Execution、Sequential/Parallel/Dag/If/Repeat/Loop；新增、删除、排序和移组只修改既有tasks结构。删除仍被引用的任务时拒绝，不自动删除绑定。跨组移动由服务端校验作用域，不改写执行语义。
- 表单结构来自GET /flows/editor/schema，字段标签/显示条件是前端表现，不是第二套DSL。INPUT/VARIABLE/TASK_OUTPUT/LITERAL/ITEM均使用原Binding；Loop当前item和Repeat反馈采用当前模型。
- Application选择读取应用目录、版本、参数契约；集群/数据集使用资源目录。没有自动生成Flow Input，不自动求choices交集，不根据DATASET名字猜含义。不存在命名端口自动发现：可选输出来自当前Flow显式声明。
- UI-02a候选集群按钮紧邻对应字段：已选高亮/勾选、再次点击取消，计数与按钮状态直接读取当前YAML的candidateClusters，不保存第二份选择状态。固定列表与等价LITERAL引用切换保留列表；动态ITEM等绑定仍按原语义编辑。未选的禁用集群不能添加，已选后停用的集群允许移除，目录不可见的既有ID仍在原列表中可编辑。不改变“一实例选择一个集群”的Placement语义。
- 保存和执行仍用现有校验、expectedRevision和固定修订提交。Schema不能替代引用/跨字段/资源校验；目录不可用不返回假选项。
- 无新增Java/表/HTTP/SPI，无Execution主链变化。yaml依赖实际用于注释保留的文档修改。表单不支持安全表示的超大整数等文档保留源码编辑，不静默截断值。

## Kestra参考

UI-02b的Loop.values使用Array/引用切换、逐项添加/删除/排序以及对象字段和嵌套数组编辑。Array回写原LITERAL.value；引用仍是原INPUT/VARIABLE/TASK_OUTPUT，切换来源/非空值类型需确认，引用转Array可显式复制已引用Input的数组默认值，但不自动删除Input或创建别名。错误数字阻止保存/排序，零、false、空字符串、重复元素及输入次序保留。FedAvg/FedProx的clients不再放在Flow Inputs，训练ITEM和其余配置不变。

参考同一Kestra提交的TaskAnyOf.vue（类型切换）、TaskArray.vue（逐项编辑/排序）、Loop.java（values属于任务自身）。本项目不支持通用字符串表达式/URI集合，因此用“引用”而非假装支持String；不新增Binding类型、Java/API/表/SPI。新增LoopValuesField.vue和JsonValueField.vue的真实消费者仅是现有SchemaField中的Loop.values。Sites技能用于保持现有Vue/Docker工程及交互/窄屏验证，不注册或迁移为其他托管站点。

本地D:/Project/Kestra/kestra提交0354ddf8cb：ui/src/components/flows/MultiPanelFlowEditorView.vue的flowYaml共享源、TaskEditPanes.vue的Form/Source、useNoCodePanels.ts的按路径编辑。官方：https://kestra.io/docs/ui/flows 。沿用职责和操作方式，不复制组件或协议；当前仅支持本系统任务，采用单配置面板而不是完整任意多面板工作台。不新增插件市场/表达式调试器/局部重跑。

## 验收

1. YAML与表单反复切换、未知字段/注释、false/0/空字符串、非法YAML/重复键保持正确。
2. 新增/嵌套/排序/移组/删除保护，DAG定义顺序与依赖分开；同名Task不得创建。
3. FedAvg/FedProx的Repeat/Loop/ITEM/文件/参数原语义往返；未显示字段不丢失。
4. 真实API校验、修订冲突和回退；通过No-code创建流程并执行成功，不用mock Execution结果。
5. 浏览器可用性、目录失败与大任务树切换，构建/单测/既有E2E和scaffold检查。
6. 候选集群初始回显、多选与重复点击取消、源码反向同步、固定/LITERAL切换、保存回读、禁用限制和窄屏样式，见[UI-02a验证](../verification/VER-UI-002a-cluster-selection.md)。
7. Loop.values就地创建对象/嵌套数组、增删排序、类型及来源切换确认、移除后重新设置空Array、保存回读与真实Loop执行；FedAvg/FedProx不再要求clients启动输入，见[UI-02b验证](../verification/VER-UI-002b-loop-values.md)。

验证结果见[VER-UI-002](../verification/VER-UI-002-no-code.md)。当前覆盖11种任务的既有Schema字段；任务ID改名、offload研究配置等仍通过YAML编辑，未展示字段保留不删除。121节点/30次切换检查不等于长期内存压力/OOM验收。
