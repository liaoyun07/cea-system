# VER-LOCK-01：简化准入锁

2026-10-14。状态：实现、完整回归与后端发布通过；现场模拟终端停止，额外三位置实测未执行。

范围：全局准入锁删除、有界并行准入、卸载网络调用移出资源事务。保留任务租约、资源槽事务及原有执行恢复。不修改算法、槽位配置、历史实验或 DQN 模型。

## 实现

删除 MySQL `GET_LOCK/RELEASE_LOCK` 全局门闩。WorkerPump 在现有 concurrency 内并发调用 runOnce，名额同时覆盖准入和执行；槽满仍 defer 原任务并扫描其他任务。领取保留短事务行锁/租约，资源占用保留原子预约。

卸载链路变为：查询已提交工作量 → 事务外网关决策 → 短事务登记决策、样本后继及工作量 → 原资源预约/Runner。并发状态采样允许略旧，优先级只表示领取偏好，不保证外部检查或占槽完成顺序。没有新表、字段、配置、生产类、HTTP API 或基础设施。

## 源码与定向验证

基于 main `9bcee09751fa870fade9fe6f60f544304f0a02da` 加当前工作树；仓库已有未提交实验/认证等修改保留，本批提交仅包含 LOCK-01 文件/段落。Java 21.0.12、Maven、Docker Desktop、真实 MySQL 8.0 Testcontainers。

- 慢准入与另一 Worker 并行；一项检查阻塞时同一个 Pump 的另一项执行完成；领取无重复、2 个名额覆盖检查到执行；两个 Sleep 实际并行：4 项通过。
- 原 OffloadingTest 24 项通过；并发登记验证未完成总量正确、8 条样本形成 7 个唯一后继。状态不再强制是串行 0..7，而是各次采到的已提交值。
- 新增真实 HTTP 网关测试：网关处理推理请求期间，另一数据库连接用 `FOR UPDATE NOWAIT` 获取云/边资源行，并完成另一个终端预约；结果登记和采样正常。该项单独通过。
- 首轮测试的三处“一次 poll 必须领取所有任务”假设不适合 SKIP LOCKED 并发瞬时跳过；改成与生产一致的定期 poll 后通过。新增网关测试初次使用可能数字开头的 UUID 集群名被合法性检查拒绝，补合法前缀后通过。未放宽生产校验或取消原断言目标。

完整命令：`scripts/verify.ps1 -JavaHome <JDK21> -MavenCommand <mvn.cmd>`；日志 `.local/lock01-verify.log`。16:41完成，18分05秒，**307项、0失败、0错误、0跳过**，包含104项工作流、63项真实容器/文件/联邦执行、25项卸载和打包JAR启动。结构检查：8模块、114生产Java、依赖无环。发布脚本Node语法检查通过。

提交前将新增测试的TerminalTarget构造改为仅模拟所需公开访问器，消除对另一批未提交实验所加构造参数的依赖；该网关回归再次单独通过，生产代码/发布镜像未变。仅本批暂存快照导出到`.local/lock01-source`，独立`-DskipTests package`（包含测试编译）和结构检查通过；此步骤不冒称再跑了一次完整307项。定向日志为`.local/lock01-fixture-check.log`，独立编译日志为`.local/lock01-scoped-build.log`。

## 发布和边界

已确认 2653 条旧执行全部终态、终端负载未启动；保存 82 个旧 Flow、数据集/策略和 26 个 CEA 容器快照，并保存 `cea/backend:before-lock01` 回滚镜像。证据位于 `.local/cea/lock01`；验证脚本 `deploy/cea/verify-lock-admission.mjs`。

仅更新 backend，发布镜像 `sha256:752f2458e0c1b6254db7d709fbda77abac8b3697cb70a7fa62a4cffb38014d5d`，Docker健康检查通过；18080前端API返回200。无数据库迁移。

新增独立 Flow `lock01-parallel-check`，执行 `a8170985-c5e0-4457-b135-f3d3a15a9d93`：两个3秒Sleep全部SUCCESS，每项只有1个Attempt；轮询数据库观测到同时RUNNING的Worker租约峰值2。TaskRun记录区间重叠3196ms，此数不是容器算法计算耗时。

发布后2653条旧执行内容、82个旧Flow修订、数据集/策略保持；25个非backend容器的ID、镜像和启动时间完全不变。保存before/accepted/smoke/after本地证据；原后端镜像仍可回滚。

额外尝试终端、边缘、中心云各一条5MB请求时，三条命令均在Docker exec阶段返回“container is not running”。核实模拟终端 `sim-terminal-001` 为exited，停止于2026-10-14 08:19:08 UTC，早于本次发布；没有提交业务请求或产生失败执行记录。未擅自启动它或其余终端，因此不把这三条现场链路写成通过。真实终端/网关行为已在隔离容器回归中覆盖，现场复测另待启动终端后进行。

没有重跑278请求，不据本批功能测试宣称原235秒平均耗时已降到某个数值；没有增加云边槽数、修改DQN或重启其它服务。
