# ADR-0003 S1 持久顺序Log闭环

历史决策说明：S1执行职责及一次Attempt限制已由[ADR-0004](ADR-0004-s2-worker-lifecycle.md)替代；技术栈、版本管理和身份基线仍沿用。

日期：2026-09-08。状态：ACCEPTED（S1实现基线）。

采用Java21与Spring Boot 4.1.1 BOM，版本依据官方当前稳定文档；Jackson3统一处理新JSON/YAML。Flyway与MySQL驱动随BOM锁定，MySQL8作为真实集成测试，不以H2替代并发/锁语义。

S1只实现内置Log任务。执行分CREATED、RUNNING、SUCCESS、FAILED，TaskRun另含SKIPPED；每个TaskRun暂只一次Attempt。每条持久消息仅推进一个小步骤，Log的可观察副作用是同事务写数据库日志及输出，不调用外部系统。提交、状态、日志、后续消息都使用同一个MySQL事务。短事务竞争消费FOR UPDATE SKIP LOCKED；S2再实现独立Worker投递/租约，不能将S1的事务内Log扩展为事务内网络调用。

流程版本由dataflow拥有；runtime仅接收不可变Flow快照。请求幂等键按namespace+authenticated actor+key隔离，摘要使用原始请求（含显式或省略revision），重投不因latest变化产生新执行。首次解析到的版本、inputs和variables固定。

JSON/YAML使用同一严格模型；Literal/Input/Variable/TaskOutput为显式Binding，字符串Log消息使用成熟Pebble模板引擎。只允许前序Task输出引用，变量依赖必须无环。错误不能静默转空字符串。当前未实现任务类型一律拒绝，不提供空实现。

本地API绑定回环地址，凭据外置，Basic验证身份后再校验namespace和READ/WRITE/EXECUTE权限；不信任X-User等请求头。S1不是完整账号系统或生产TLS方案。

参考：[Boot系统要求](https://docs.spring.io/spring-boot/system-requirements.html)。第三方坐标可用性以实际Maven解析与测试为准。
