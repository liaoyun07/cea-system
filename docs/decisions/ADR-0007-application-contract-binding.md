# ADR-0007 应用契约和运行参数派生

2026-09-10，ACCEPTED。用户授权开始S4-02；本次先完成S4-02a应用契约与参数绑定闭环，S4-02b镜像准备/分发和S4-02c常驻部署仍保留原验收要求。制定本决策时未授权新Git提交；后续用户已授权发布S4-02a。S5仍未授权。

## 已核对来源

本地Kestra提交0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4：

- core/src/main/java/io/kestra/core/models/flows/Input.java：Flow输入拥有类型、required和默认值，不由Worker拥有。
- core/src/main/java/io/kestra/core/models/tasks/RunnableTask.java：叶子任务在Worker中执行。
- core/src/main/java/io/kestra/core/models/tasks/runners/TaskRunner.java：运行环境负责命令/环境和文件传输，不拥有第二套Execution状态。

旧fedprox-client-train及tep-anomaly-inference/image-contract.json只作为业务需求证据：镜像声明业务参数、默认值、允许的数据集及本地数据格式。新后端不兼容旧schema，也不迁入旧库/镜像。

## 决定

1. deployment拥有不可覆盖的ApplicationVersion：applicationId/version/image/parameters，一张dep_application_version表保存完整契约JSON。按路径指定版本；同规范内容重放成功，不同内容409。版本真实用于编辑、绑定定位及防止覆盖，不新增辅助hash/revision。
2. 契约当前只覆盖标量业务参数及其数据集约束。参数类型STRING/INTEGER/NUMBER/BOOLEAN，声明required/defaultValue/choices及可选dataset规则。dataset仅用于STRING，值用datasetId/version；规则列出明确版本并校验资源目录和format。未声明dataset不按参数名猜测数据集。
3. dataflow负责别名到Flow Input/Literal/InputRef的派生，复用runtime既有类型和BindingResolver；deployment不依赖runtime。不会为镜像再建一套执行状态或输入绑定语言。
4. 输入来自任务的aliases；不命名即固定值或契约默认值。fixedValues与aliases不可同时给同一参数；拼错或未知参数拒绝。每个目标参数只有一个来源，一个别名可以供多个目标使用。
5. 共用别名必须类型相同、同为普通参数或同为数据集参数。choices取交集，无交集拒绝；公共默认值仅在所有目标默认值相同且符合交集时使用，否则要求用户显式输入，绝不按节点顺序选第一个默认值。
6. 两个只读API分别返回派生输入/绑定和按给定输入解析后的任务参数。它们是当前编排检查消费者，不保存Flow、不创建Execution、不启动镜像。真实容器Task接入前不往FlowValidator加入可保存却不能执行的任务类型。
7. 权限复用READ/WRITE。注册含数据集规则时需READ以访问同namespace资源目录；编排解析需READ，不假装执行所以不要求EXECUTE。不含外部凭据、Runner空接口或无消费者的准备状态。

## 明确剩余部分

应用名称不是可执行成功证明，image目前仅校验引用结构，不访问Registry。命名产物端口、运行路径注入和绑定持久化随真实Runner消费者接入；不冒充本批已支持。镜像准备/分发、常驻Deployment及独立环境验收继续在S4-02，Job/预约在S4-03。全阶段退出条件不变。
