# 云边端协同平台新后端

独立重构工程，旧实现位于同级 `web-platform/`。目前实现S1–S3：定义与版本、幂等提交、Worker恢复/失败语义、DAG/条件/嵌套并行、Flow并发排队与Cron触发；S4首批新增集群目录、数据集版本/位置和候选本地性检查。真实叶子任务仍只有Log/Sleep；没有迁入旧数据，也未实现容器任务、DQN或前端。S4未整体验收，当前状态见进度文档。

## 文档入口

- [系统总览](docs/00-overview.md)：模块边界与目标。
- [项目结构和全部 Java 文件](docs/01-code-architecture.md)：职责、事务、测试。
- [实施计划](docs/03-implementation-plan.md) / [当前进度](docs/04-progress.md) / [功能索引](docs/02-feature-index.md)。
- [当前 API、DSL 与 Worker 协议](docs/contracts/README.md) / [文档维护规则](docs/05-documentation-guide.md)。
- [生产部署保障范围](docs/06-deployment-safeguards-review.md)：已确认保留、最小实现与后置项，随后续阶段落实。

## 构建和测试

JDK 21、Maven 3.8.8–3.x；Spring Boot 4.1.1、Jackson 3、MySQL 8、Flyway，版本由父 POM 锁定。
完整验证需要运行中的 Docker，Testcontainers 自动创建独立 MySQL 及清理容器，不连接旧数据库。首次需要下载依赖和测试镜像；缺少 Docker 会失败，不跳过集成测试冒充通过。

在 backend 目录运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-scaffold.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify.ps1 -JavaHome '你的 JDK 21 目录'
```

有 JDK 21 的终端可运行 `mvn -B -ntp clean verify`。首次变更编译器参数后使用 clean，以免沿用旧 class。
仅定义单元测试：`mvn -B -ntp -pl workflow-runtime -am test`，不需要 Docker，但不能替代完整验收。
脚本仅在进程内切换 JAVA_HOME 并恢复；不修改全局 Java 8 或旧工程。

## 本地启动

先准备**新后端专用的空 MySQL 8 数据库**和对应账号，不能指向旧系统库。Flyway依序运行V1–V6，创建13张业务表及迁移历史表。
测试库是一次性的，不能用于日常保存数据。最小部署及单机故障验证按后续阶段落实；额外账号管理、TLS、备份恢复现已后置，不宣称当前具备。

在已配置 JDK 21 的 PowerShell 中设置：

```powershell
$env:BACKEND_DB_URL='jdbc:mysql://127.0.0.1:3306/backend_dev?connectionTimeZone=UTC'
$env:BACKEND_DB_USER='新后端专用数据库账号'
$env:BACKEND_DB_PASSWORD='你的数据库密码'
$env:BACKEND_USER='developer'
$env:BACKEND_PASSWORD='你的本地API密码'
$env:BACKEND_NAMESPACES='lab'
java -jar .\platform-server\target\platform-server-0.1.0-SNAPSHOT.jar
```

默认监听 `127.0.0.1:18085`，使用 HTTP Basic；没有默认密码。IDEA 中使用相同环境变量和 JDK 21，运行
`com.project.platform.server.BackendApplication`。其他账号通过外部 Spring 配置的 `platform.security.users` 列表提供，不在请求中传身份。

## 最小调用示例

以下操作只针对你刚启动的新后端，先设置上述 API 用户和密码：

```powershell
$taskBasic = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("$($env:BACKEND_USER):$($env:BACKEND_PASSWORD)"))
$taskHeaders = @{ Authorization = "Basic $taskBasic" }
$taskSource = Get-Content .\examples\s1-log-flow.yaml -Raw -Encoding UTF8
$taskBody = @{ expectedRevision = 0; source = $taskSource } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:18085/api/namespaces/lab/flows/hello/revisions' -Headers $taskHeaders -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($taskBody))
$taskHeaders['Idempotency-Key'] = [guid]::NewGuid().ToString()
$taskRun = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:18085/api/namespaces/lab/executions' -Headers $taskHeaders -ContentType 'application/json' -Body '{"flowId":"hello","inputs":{"name":"Ada"}}'
Invoke-RestMethod -Uri "http://127.0.0.1:18085/api/namespaces/lab/executions/$($taskRun.executionId)" -Headers $taskHeaders
Invoke-RestMethod -Uri "http://127.0.0.1:18085/api/namespaces/lab/executions/$($taskRun.executionId)/logs" -Headers $taskHeaders
```

首次保存用 expectedRevision=0，重复保存会409；后续编辑用最新 revision。提交202代表已持久接受，后台异步推进，立即查询可能仍为QUEUED/CREATED/RUNNING。相同请求重试必须沿用同一个 Idempotency-Key；有意另执行一次才换键。
最终结果是 `Hello Ada; count=2` 和整数 `2`；没有模拟业务成功。

## 版本管理

backend使用独立Git仓库，仓库根为本目录。公开远程仓库为[liaoyun07/cea-system](https://github.com/liaoyun07/cea-system)，使用main分支发布；首次提交收录S1–S3的源码、测试、示例和可追溯文档，不包含旧工程、构建产物或本地缓存。提交身份使用GitHub隐私邮箱，不修改全局Git配置。
已有S0–S3源码SHA256清单保留为首次提交前的历史验收证据；后续变更同时通过Git提交追溯。
旧工程、旧服务、数据库和镜像没有被迁移或重启；S4-01按用户2026-09-10的授权纳入本次Git发布，不自动进入S5。

## S3运行角色与升级

默认一个进程同时运行API、Executor、Scheduler和Worker。Worker在事务外执行任务；并不是Controller直接执行Log。
独立进程使用相同的新后端数据库与凭据，端口不同。例如在两个已配置上述环境变量的JDK21终端分别运行：

```powershell
# API + Executor + Scheduler
java -jar .\platform-server\target\platform-server-0.1.0-SNAPSHOT.jar --platform.worker.enabled=false --server.port=18085
# Worker（本地管理API仍存在；不要暴露到公网）
java -jar .\platform-server\target\platform-server-0.1.0-SNAPSHOT.jar --platform.executor.enabled=false --platform.scheduler.enabled=false --server.port=18086
```

默认租约3000ms，每次等待结果按租约1/3周期续租；Worker丢失后接管同一Attempt。调度线程池默认2，防止长Worker任务阻塞Executor超时/取消推进。
每个Worker进程默认并发执行4个叶子任务，可用platform.worker.concurrency调整（1..100）。Flow并发limit是另一层，约束同namespace/flowId跨版本的活跃Execution；超限QUEUE按持久FIFO准入，FAIL直接产生可查询失败。不是全系统任务优先级队列。

Schedule每Flow一个、Cron六字段含秒、时区默认UTC；Scheduler通过正常提交链创建执行。关闭角色使用platform.scheduler.enabled=false。两个Scheduler共享数据库可以运行，游标和执行创建同事务。

从S1/S2新后端升级时，先备份专用库、停止接收新提交，等待CREATED/RUNNING/KILLING执行排空，然后关闭所有旧版本新后端进程再启动S3。迁移会拒绝未排空的活动执行，不支持S2/S3混跑或在线热升级。不是升级旧web-platform数据库。
若违反前置条件造成Flyway失败，先检查数据库实际状态、按备份/迁移记录处理并在确认安全后修复失败记录；应用不会自动repair或吞掉迁移错误。测试中的repair只针对故意失败的临时库。

S2删除了没有业务判断消费者的FlowRevision.checksum及其列；真实请求幂等request_hash保留。不是删除模板、版本或用户输入。
[S2语义和字段用途](docs/contracts/s2-protocol.md) / [S2示例](examples/s2-retry-cleanup.yaml)。取消调用：

```powershell
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:18085/api/namespaces/lab/executions/$($taskRun.executionId)/cancel" -Headers $taskHeaders
```

202表示取消请求已接受。QUEUED取消直接KILLED且无清理；已准入执行的主任务被终止后仍会执行Finally，清理完成才是KILLED。主失败与清理失败分别查看error、cleanupError及各TaskRun，不用一个错误覆盖另一个。

[S3控制/队列/定时协议](docs/contracts/s3-protocol.md) / [完整定义示例](examples/s3-control-flow.yaml) / [75项测试验收](docs/verification/VER-S3-001-control-scheduling.md)。示例包含乱序DAG、条件、嵌套顺序/并行与清理，Schedule默认禁用。

## S4-01资源目录

[资源API与JSON示例](docs/contracts/s4-resource-catalog.md)提供集群注册/启停、不可覆盖的数据集版本及位置登记、分页查询和候选检查。使用既有Basic与命名空间READ/WRITE权限；目录API不需要EXECUTE权限，因为不会创建任务。

只检查已登记的位置/格式/启用标志，不连接Kubernetes或对象存储验证真实性，也不进行资源预约。后续镜像契约、真实Job与观测仍在S4待实施；不能把预览结果当成可用容量保证。
