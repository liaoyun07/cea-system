# UI-13 应用参数类型对齐

范围：应用注册、镜像上传、在线构建共用七种参数类型（STRING、INTEGER、NUMBER、BOOLEAN、OBJECT、ARRAY、SELECT），与 Flow Input 可表达类型对齐。不创建平行参数目录，不自动生成 Flow Input 或改写已保存版本。

SELECT 是字符串枚举，应用契约沿用 choices 字段，必填且非空白、无重复；默认值必须在其中。保留历史 STRING+choices 和数字/布尔允许值。数据集仍是 STRING+dataset，dataset.allowed 管理允许版本，不把数据集路径当作普通 SELECT 选项。

OBJECT/ARRAY 接受真正的 JSON 结构，不接受伪装成对象的字符串。结构支持嵌套和 null，数字必须有限；规范化数字保证注册重放与数据库回读一致。运行时将其编码为 JSON 环境变量，镜像内用 JSON 解析器读取。结构数字使用普通十进制输出，例如 batch=1000 不输出 1E+3，防止 Python 把整数配置读成浮点值。现有四类标量环境变量格式不变。

例如应用参数 MODEL 声明 `{ "type": "SELECT", "choices": ["mlp", "cnn"] }`，绑定 Flow SELECT 输入时仍写 `{ "source": "INPUT", "name": "model" }`；容器环境变量得到 `cnn`，不是带引号的 JSON 字符串。CONFIG 声明 OBJECT、绑定值为 `{ "batch": 1000 }` 时，环境变量是 `{"batch":1000}`，不是 Java 的 `{batch=1000}`。

调用链保持：注册/上传/构建 → ApplicationCatalogService → ApplicationContractValidator → 既有 contract_json；Flow Binding → ApplicationTaskRunner 公共参数准备 → 集群 Job 或网关终端容器；DeploymentService → 同一环境变量编码 → Kubernetes Deployment。部署编辑回读按契约解码并校验，避免 Java Map.toString 或列表字符串损坏结构。无新 Java 类、表、数据库字段、API、跨模块依赖或执行分支。

参考本地 Kestra 源码提交 `0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4`：`core/src/main/java/io/kestra/core/models/flows/input/SelectInput.java` 的字符串单选与允许值验证、`JsonInput.java` 的结构验证、`ArrayInput.java` 的列表语义。只参考输入含义，不照搬动态选项、JSON Schema 或多选等范围外能力；本系统维持已有 OBJECT/ARRAY 命名与应用环境变量协议。

验收覆盖：七类型契约持久化及 HTTP 回读，非法 SELECT/类型拒绝，真实集群与终端容器读取绑定 JSON，常驻部署消费和编辑回读，三个表单入口选项一致，Flow 绑定保留 JSON，旧数据集/四类参数回归。2026-09-17已部署CEA前后端；Java完整回归后修正测试HTTP夹具并定向复测通过，56项Node、73项完整浏览器及现场验证通过，详见[完整验收与复测说明](../verification/VER-UI-013-application-parameter-types.md)。
