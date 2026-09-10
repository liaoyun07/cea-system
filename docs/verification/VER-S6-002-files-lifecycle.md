# VER-S6-002：S6剩余文件与生命周期

状态：PASS。S6-02/03/04按已授权最小范围完成；结合已验收的S6-01，S6后端阶段完成。不是完整前端、DQN研究或数据处理速率验收。

基线：8ef1908739fdaa0261a3e42b60ad573763202396；变更见本批Git提交。设计[ADR-0019](../decisions/ADR-0019-s6-files-lifecycle.md)，协议[S6文件/生命周期](../contracts/s6-files-lifecycle.md)。JDK21.0.7、Maven3.8.8、Docker29.5.3、MySQL8临时容器；不连接旧系统。

已执行：编译通过；FlowManagementTest新增文件CAS/路径/权限、Checks/调度拒绝推进、Webhook幂等、SLA、afterExecution失败/取消/准入/租约接管。21项于2026-09-10 23:45:14 +08:00通过。

失败与修正保留：第一次命令未引用PowerShell中带点的-D属性导致Maven参数错误，未执行测试；一次测试Map泛型编译错误已修正；首轮19项测试出现3项数据库phase长度错误，V17扩大现有列后上述21项重测通过。不是隐藏失败或跳过断言。

## 最终结果

2026-09-11 00:02:08 +08:00，JDK21执行`scripts/verify.ps1`完整通过，耗时11分37秒：212项Maven测试，零失败/错误/跳过。分项为runtime33、Architecture1、CommonTask6、Contract3、DurableWorkflow86、EdgeAccess18、FlowManagement21、ImageDistribution33、Offloading10、DeploymentSmokeIT1。另真实算法容器中的7项联邦数值Python测试和5项单步Q Python测试通过；不重复累加定向复测。

真实文件验证：通过API服务保存脚本revision1，提交固定引用后发布不同revision2；Worker执行原脚本产出original。运行中丢弃Worker后接管，Job UID不变、只有一个Attempt，内容仍为revision1；引用不存在revision999明确FAILED且不创建Job。不是仅验证文件CRUD。

门禁验证：普通HTTP/统一runtime提交/preview、Webhook、Cron、终端和策略均检查；拒绝无Execution或edge回执；Cron拒绝后推进；Webhook验证401/403/opt-in、422、409以及编辑/禁用后的同键重投返回原执行。终端和事件修正后可以正常接受。

生命周期验证：SLA记录并在重建Executor后保留，排队和后处理耗时不计入；SLA只告警不改SUCCESS。afterExecution在Finally与主终态之后运行，失败重试、后续通知、主失败、主取消、排队取消及准入拒绝均验证；过期Worker结果被拒绝，同Attempt接管完成，原state/outputs/endedAt不变。新增后处理测试使用真实MySQL、重建Executor和Worker租约接管；不是额外的物理多机故障实验，既有独立JVM/DB短时中断回归仍通过。

结构检查：8模块、86份生产Java、32功能ID、373个本地文档链接通过；git diff --check通过。OpenAPI 51个HTTP操作/58个record映射与Java一致，全部YAML示例往返验证通过。生产新增3类、4HTTP操作、6个嵌套record、1张表、1个时间列及phase列扩容；无新SPI/Runner/Binding/执行链。

本地未入Git证据：platform-server/target/s6-remaining-verify.log、s6-remaining-targeted.log、s6-remaining-contract.log及Surefire/Failsafe XML。所有数据来自隔离Testcontainers，未改旧web-platform/amis、既有数据库或服务。没有声称物理多云、生产高可用或吞吐达标。按持续授权提交到cea-system/main，提交号由本文件对应Git历史追溯。
