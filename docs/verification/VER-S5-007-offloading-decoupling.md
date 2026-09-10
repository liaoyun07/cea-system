# VER-S5-007：普通执行与卸载观测最小解耦

日期：2026-09-10。基线：1a62a6252456969d82ef217a151ffc5447552784，backend/main。范围S5-04c，关联RES-002/RUN-001/OFF-002和[ADR-0017](../decisions/ADR-0017-offloading-decoupling.md)。本次源码由包含此记录的Git提交追溯。

## 环境与命令

Windows、JDK21.0.7（IDEA jbr）、Maven3.8.8、Docker29.5.3。测试使用隔离MySQL、Registry、K3s、MinIO、Docker终端和独立JVM；没有操作旧业务库、已有服务或旧镜像。

在backend运行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1 -JavaHome 'D:\IDE\IntelliJ IDEA 2025.1.3\jbr' -MavenCommand 'D:\developevn\maven\bin\mvn.cmd'`。本次日志在platform-server/target/s5-04c-verify.log，逐项结果见各模块Surefire/Failsafe XML。日志和临时算法证据不提交仓库。

## 结果：PASS

标准verify于22:27:16 +08:00完成，BUILD SUCCESS，退出码0。188项Maven及12项Python全部通过，零失败/错误/跳过；不是沿用04b历史结果，也不累加重复运行次数。

| 范围 | 数量 | 结果 |
|---|---:|---|
| runtime定义/生命周期/控制流 | 32 | PASS |
| 持久化/队列/恢复 | 86 | PASS |
| 接入/权限/策略 | 17 | PASS |
| 真实Registry/K3s/Docker/产物/联邦学习 | 32 | PASS |
| 卸载模型/画像/反馈/FIFO | 10 | PASS |
| HTTP/SQL | 6 | PASS |
| 协议/示例与架构 | 4 | PASS |
| 打包JAR空库迁移/启动 | 1 | PASS |
| Python联邦数值/卸载训练器（另计） | 7+5 | PASS |

关键新断言：仅在ImageDistributionTest独享临时MySQL中暂时改名卸载观测表，真实固定终端→集群命名产物链仍成功，再于finally恢复表名。固定终端失败/retry、Worker接管、排队取消不产生卸载观测；实际资源槽正确释放。同Attempt接管不重复业务执行，FIFO取消不复活已释放预约。保留显式RULE三位置、实际反馈训练/注册/单步Q执行回归。

测试包含原有预期迁移拒绝、故障注入和延迟远端协调日志，所属测试最终均通过；未关闭这些检查。最初将日志重定向到不存在的根target目录时命令未启动，改用现存platform-server/target后运行上述完整verify，不属于业务测试失败。

收尾check-scaffold通过：8模块依赖无环、82份Java已索引、32个功能编号、339个本地链接。git diff --check通过；结构检查不替代上述业务测试。

## 行为与限制

修改3个生产类，无新增Java类、字段、record、表、迁移、HTTP API或SPI。删除无消费者的OffloadingService.observe；新增JobPlacementService.releaseTerminal(namespace,key)公开重载，由ApplicationTaskRunner实际消费。主Execution/Worker/Runner链未变，资源释放不再以卸载观测为依据。

历史普通任务观测不清理，既有RULE/单步Q协议和候选集不重新设计；显式offload仍依赖卸载模块，不宣称整体模块可移除。S5-05仅设计，用户选择先讨论口径，未新增SDK/速率接口或计算，不宣称多云性能或2GB/s达标。
