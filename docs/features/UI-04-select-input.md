# UI-04：SELECT流程输入

2026-09-12用户要求“输入需要再加个SELECT类型，和kestra一样”。本批为WF-002/WF-016的增量，不新增功能编号；验收状态见[验证记录](../verification/VER-UI-004-select-input.md)。

## 语义

```yaml
inputs:
  region:
    type: SELECT
    values: [edge-a, edge-b, cloud]
    defaultValue: edge-a
    required: true
```

完整可运行Log示例为[select-input.yaml](../../examples/select-input.yaml)。SELECT是固定字符串单选，传递给INPUT Binding和表达式的值仍为字符串；不是集群/镜像/数据集专用类型，不自动访问资源目录或派生选项。

- values必须提供非空数组；元素只能是非空白、不重复字符串，按原次序展示，匹配大小写敏感，不trim/转换原值。数字/布尔/null/对象选项拒绝，数字文本应写成带引号的字符串。
- defaultValue可省略或为null；非null时必须为列表中的字符串。required默认false，保留既有语义：省略使用默认值；显式null不回退默认值，required=true时拒绝、false时保留null。没有默认值不自动选择第一项。
- 非SELECT输入不允许非null的values。旧定义未声明values自然为null，无旧逻辑适配器或迁移分支；旧输入的类型和默认值逻辑不变。
- 同源No-code中选择SELECT后可逐项编辑values，并从列表选默认值。删掉被默认值引用的选项，不自动改默认值，保存时提示成员错误。保存修订后，运行表单显示下拉，预览与API提交均验证成员；前端校验不能替代后端校验。
- 选项改变通过原修订CAS保存；已提交Execution继续使用原修订和输入快照。没有自动把Flow Input与Application契约choices求交集；Application自身契约执行检查仍保留。

## 职责、调用链与字段消费者

FlowDefinition.Input.values唯一声明选项；FlowValidator消费它检查定义/默认值；BindingResolver.validateInput由原prepare和默认值校验调用，检查实际值。FlowSchema为现有SchemaField生成字符串数组编辑结构，FlowEditor/makeFields/inputValues消费同一保存定义展示下拉并提交字符串。values使用List<Object>保留解析原类型，交Validator拒绝非字符串，避免隐式字符串转换；有效数据并不支持任意JSON选项。

调用链仍为Flow保存/validate/preview → 原Parser/Validator/prepare；提交 → 原prepare/Checks → Execution快照 → Executor/Worker/Runner。普通执行、Webhook、定时和策略等正常入口沿用同一输入准备，不新建提交或绑定模型。

无新增Java类、表、列、HTTP操作、SPI或状态机。仅扩展Input记录与枚举，存入现有Flow修订/Execution JSON，无DB migration。使用SELECT的Flow要求前后端同批升级；旧服务不能解析新枚举。不改已存FedAvg/FedProx或其历史。用户已当次确认测试后更新CEA前后端；其余服务及业务Flow保持不变，发布结果以验证记录为准。

## Kestra参考与有意简化

参考本地Kestra提交0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4：core/src/main/java/io/kestra/core/models/flows/input/SelectInput.java及对应SelectInputTest.java；官方[Inputs](https://kestra.io/docs/workflow-components/inputs)。共同点是SELECT为单个字符串、values给出候选值、默认值/必填和服务端成员校验。

本阶段只实现固定字符串列表，不实现expression动态选项、allowCustomValue、自选首项、radio、label/value对象或MULTISELECT。本项目保留已有defaultValue名称和inputs映射结构，不改成Kestra的defaults及inputs列表，不新增第二套DSL。Sites技能用于沿用已有Vue样式/组件并检查实际窄屏交互，不迁移托管或新增依赖。

## 验收

1. YAML/JSON保存、读取/导出保持SELECT和values；新定义/默认值错误在保存前拒绝。
2. 预览和API/触发入口拒绝选项外/非字符串值，拒绝时不创建Execution；修订更新不污染已提交快照。
3. No-code新增输入、编辑values/默认值/required、删除默认选项、修正后保存；执行下拉、默认预选/无默认不预选，数值文本仍为字符串。
4. 既有六类输入、绑定、Loop/FedAvg/FedProx及完整后端回归；桌面与650px窄屏可用。
