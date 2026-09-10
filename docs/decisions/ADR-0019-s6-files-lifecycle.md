# ADR-0019：S6文件、提交门禁与终态后处理

状态：接受，已实施并通过[验收](../verification/VER-S6-002-files-lifecycle.md)。授权：用户要求继续完成S6剩余部分。不是S7、完整前端或S5计量/DQN授权。

参考本地Kestra提交0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4：`core/models/tasks/NamespaceFiles.java`、`core/models/flows/check/Check.java`、`plugin/core/trigger/Webhook.java`、`core/models/flows/sla/types/MaxDurationSLA.java`（均位于core/src/main/java/io/kestra），以及core/src/test/java/io/kestra/core/runners/AfterExecutionTestCase.java。

## 决定及真实消费者

- Namespace Files由dataflow管理，小型UTF-8脚本/配置按(namespace,path,revision)不可变保存；Application.container.namespaceFiles显式将本命名空间文件版本映射到输入文件名。Runner读取后进入原Prepared.inlineFiles和原容器文件协议。版本必须显式指定，不读取latest、不增添执行快照表；Flow/Execution已保存引用，旧版本不删除，重试/接管不会漂移。单文件64KiB、每任务总256KiB；不是数据集/大型二进制仓库。新增一张文件修订表，revision用于真实CAS和执行读取，无checksum。
- Checks是Flow上的when/message列表，沿用Pebble表达式，只允许inputs/vars数据；统一ExecutionService在首次创建前检查，所有HTTP/定时/终端/策略提交均不能绕过；预览也检查。false、非布尔或求值错误拒绝，不创建失败Execution。最小范围不复制Kestra多种展示样式/行为。
- Webhook显式启用，认证沿用Basic及namespace EXECUTE，JSON正文就是Flow inputs；Idempotency-Key复用原提交幂等并隔离webhook键空间。没有URL明文密钥、匿名入口、任意请求头转发、第二套Binding或触发队列。
- SLA仅maxDuration告警，从执行startedAt到主链（含Errors/Finally）结束，不含准入排队/afterExecution。原Executor定期检查，持久sla_violated_at供查询和后处理上下文读取；不偷偷取消任务或改变结果。仅加这一个有消费者的执行列，不复制监控服务。
- afterExecution是同一Flow上的Task列表，沿用TaskRun/Attempt、原Executor/Worker。先持久主链终态、outputs、endedAt并释放Flow并发名额，再执行后处理；后处理失败由其TaskRun/Attempt查询，不改变主状态/时间/输出。TaskRun增加AFTER_EXECUTION阶段枚举值，无第二个Execution状态机、后处理表或冗余汇总状态。包括准入失败和排队取消的已接受Execution；Checks拒绝未创建Execution，不执行后处理。主执行终态的取消不会取消后处理；它仍使用每个Task的timeout/retry。

## 有意简化及迁移

Kestra支持glob/跨namespace文件、复杂Webhook请求映射、多种Checks/SLA行为；本项目只实现上述有真实消费者的闭环。afterExecution在终态之后执行与Kestra语义一致，不将其伪装成Finally。V16增加dataflow文件修订表；V17增加runtime的sla_violated_at，并扩大既有phase列容纳AFTER_EXECUTION。分两份迁移保持模块数据所有权。旧定义缺失新增可选字段按空集合/null读取，不建立旧模型转换分支。沿用停机排空升级要求，排空范围包含未终态后处理TaskRun。

验收：文件CAS/权限/路径/版本与真实容器执行及恢复；Checks各提交入口和预览；Webhook认证/opt-in/重投；SLA持续执行与重启；afterExecution成功/失败/取消/重试/接管及结果隔离；完整verify和协议/Java索引同步。
