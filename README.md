# 云边端协同平台新后端

MET-04（2026-09-14）：小/中/大三个真实用途HTTP示例已部署CEA edge-a，18080“应用部署”可看`met04-*`及各5条历史。12次测量全部≤30s并核对业务输出；首次约2.19/4.37/12.32s，热缓存平均约1.64/1.90/3.38s。只代表当前单宿主缓存条件，完整冷缓存尚未测试；平台前后端未改动/重启。[完整结果](docs/verification/VER-M04-edge-deployment.md)、[示例与复测](examples/deployment-benchmark/README.md)。

OFF-04已于2026-09-14发布CEA：所属网关运行六维Double DQN，原Placement/Runner继续执行；真实48次探索→47条完整转移→固定模型→五基线各12次比较通过。255项Maven、52项Node、60项浏览器和30项本批Python测试PASS，实际18080“卸载观测”可查看模型/层/六维/端到端时间。仅更新前后端/网关，无DB migration，原业务对象与16个其他服务保留。本次DQN平均4.005s，全终端2.207s，未证明优化收益或30ms达标；[完整结果](docs/verification/VER-OFF-04-double-dqn.md)、[计算与职责](docs/contracts/off04-double-dqn.md)。以下批次是历史时点，以本批和进度为准。

OFF-03已于2026-09-14发布CEA：六维真实观测、接纳后未完成工作量、近期传输估计、终端端到端反馈和按决策顺序的next关联已接通。18080“卸载观测”可看状态/耗时/奖励/样本完整性。完整251项Maven、最终28项定向回归、52项Node、59项浏览器、41项Python及CEA六次真实执行/乱序完成核验PASS。原执行链不变，新增3份Java、2张资源事实表和1个反馈API；Double DQN与五基线比较留OFF-04。[计算协议](docs/contracts/off03-measurement.md)、[验证与限制](docs/verification/VER-OFF-03-measured-feedback.md)。以下批次记录保留其当时状态，以本批及进度为准。

OFF-02已于2026-09-14发布CEA：终端先经网关只发文件元数据，FIXED/RULE选层后，本地执行不上传原始文件，边缘/云执行才经网关上传到所属边缘；同一镜像沿原Worker执行，小JSON结果经网关返回。加入终端代理和独立DinD（不挂宿主Docker socket），仅更新backend/gateway，frontend只reload。244项Maven、51项Node、58项浏览器、25项Python及CEA四条真实路径/存储数值/页面核验PASS。18080“边缘处理记录”可看offload-terminal/edge/cloud/rule；[示例与回放](examples/offloading/README.md)、[验收与限制](docs/verification/VER-OFF-002-terminal-gateway.md)。六维状态、端到端反馈和Double DQN仍待OFF-03/04。

EP-02已于2026-09-13发布CEA前后端：18080“边缘与终端 → 边缘处理记录”支持策略/状态筛选、分页、可信来源和原执行详情/结果。240项Maven、50项Node、最终57项浏览器回归PASS；实际三策略记录及summary/diagnosis/report JSON预览通过，原流程/10条执行/数据集和其余15服务不变。新增1个只读API，无新Java文件/DB/执行状态链；[范围与边界](docs/features/EP-02-processing-records.md)、[验证](docs/verification/VER-EP-002-processing-records.md)。

EP-01已于2026-09-13发布CEA：终端容器真实HTTP上传到网关，文件先落边缘，再通过原执行链运行液压清洗留边缘、轴承诊断返回终端、表面检测摘要送中心三策略。18080的边缘处理策略页可见，网关本机入口18086；[回放命令及数据说明](examples/edge-processing/README.md)。237项后端回归、19项新Python测试及三次真实执行/存储/数值核验PASS，原Flow/7条执行历史保持。不新增Java/DB/DSL；[实测与限制](docs/verification/VER-EP-001-terminal-edge.md)。

FILE-01已于2026-09-13发布CEA：Kubernetes文件由Pod公共助手传输，输出先写实际执行位置的存储，跨域下游直接读取源存储。新增三个边缘MinIO及独立卷，只更新backend，frontend仅reload；不修改算法镜像或Flow定义。现场FedAvg/FedProx各两轮、11个Job及独立数值复核通过，历史中心产物保持可读。数据集未迁移，终端Docker文件链未改，详见[部署验证](docs/verification/VER-FILE-001-pod-artifacts.md)。

UI-10已于2026-09-13发布CEA：删除管理、简单ADMIN/USER与个人中心、在线Dockerfile构建。新增独立rootless BuildKit、专用缓存和DB人员认证；不挂宿主Docker socket，不清理现有数据/工作负载。235项完整后端回归、追加删除竞争验证、45项前端单测和54项浏览器通过，详见[进度](docs/04-progress.md)及[行为与限制](docs/contracts/ui10-cleanup-users-build.md)。`.env`人员凭据从本批起只用于首次初始化，在线改密后以数据库为准，重启不会恢复原密码。

UI-08已实现并于2026-09-13发布CEA：单镜像tar上传、持久按需分发历史、Deployment配置编辑/手动扩缩容/就绪耗时与30秒目标对比、近期CPU/内存用量。实现阶段227项Maven、45项Node、47项浏览器通过；发布时重新构建前后端、应用V18/V19两张记录表、上传卷及四集群Metrics Server/只读RBAC，实际18080页面/API复核通过。既有Flow/执行/算法工作负载及其余10个服务不变，执行链不变。[功能与边界](docs/features/UI-08-core-deployment-operations.md)、[实测记录](docs/verification/VER-UI-008-core-deployment-operations.md)。

UI-07已完成并发布CEA：任务产物JSON查看、运行总览与Node/Service/Kubernetes Namespace只读页面；220项Maven、41项Node和44项浏览器测试通过。2026-09-12仅更新前后端及受限只读RBAC，实际18080验收通过，原流程/历史和其余10个容器不变。详情见[进度](docs/04-progress.md)与[功能边界](docs/features/UI-07-readonly-inspection.md)。

DEPLOY-01独立部署已验证：D盘Docker数据、`cea` Compose分组、前后端/MySQL/MinIO/四个Registry/四个K3s；[部署与配置入口](deploy/cea/README.md)。访问 `http://127.0.0.1:18080`，账号developer，随机密码在本地`deploy/cea/.env`的BACKEND_PASSWORD。FedAvg/FedProx已各完成全量MNIST两轮、11个Job及数值复核；整组重启后数据保留。不是旧系统切换或物理多云/吞吐验收，详见[验证记录](docs/verification/VER-DEPLOY-001-cea.md)。

UI-03已将老页面中有现成新API的能力接入[独立前端](frontend/README.md)：应用/镜像分发、部署创建查询删除、集群/数据集、网关/终端、同源边缘策略和卸载观测。CEA的18080前端已更新；其他11个服务未重启、旧数据未导入。29项Node、28项真实浏览器及212项Maven/12项Python回归通过，范围与后端缺口见[UI-03验收](docs/verification/VER-UI-003-management.md)。

UI-02提供Kestra方向的任务块/配置面板、同源YAML并排编辑、显式参数/文件绑定、目录选择和修订比较/回退。保存和执行仍使用原API/CAS及唯一Execution链，不是完整Kestra。开发使用`cd frontend; npm ci; npm run dev`，访问`http://127.0.0.1:18100`；CEA入口为18080。历史验收见[UI-02记录](docs/verification/VER-UI-002-no-code.md)。

S6后端阶段已完成：[编辑与流程管理](docs/contracts/s6-flow-editing.md)，本轮补充[Namespace Files、Webhook/Checks、SLA和afterExecution](docs/contracts/s6-files-lifecycle.md)，212项Maven及12项Python完整回归通过，见[当前进度](docs/04-progress.md)。沿用唯一Flow和执行链；完整前端未实现，DQN研究与S5计量按用户决定后置。

OFF-01（2026-09-14）：按新四步计划开始拆分卸载选层与 Placement。普通CLUSTER和固定TERMINAL仍不访问卸载观测；显式RULE只选层，Resource决定所属边缘/系统中心云范围及具体位置。旧单步Q不用于新任务，Double DQN留到OFF-04；S5-05计量SDK继续后置。见[ADR-0025](docs/decisions/ADR-0025-offloading-layer-placement.md)，测试/发布状态见[当前进度](docs/04-progress.md)。以下S5旧批次结果为历史证据。

独立重构工程，旧实现位于同级 `web-platform/`。S1–S4已完成最小验收；S5已有Repeat、Loop、FedAvg/FedProx、网关/终端后端接入、策略管理和Docker执行。S5-04b此前新增显式终端卸载、规则/单步Q网络、画像反馈和终端FIFO，真实三位置执行及训练闭环、188项Maven和12项Python完整回归均通过，见[最新验收](docs/verification/VER-S5-006-terminal-offloading.md)。S5整体仍进行中；计量SDK、网关代理部署、前端及旧数据切换未实现。真实MNIST/K3s/Docker测试为单机隔离环境，不是物理终端、SSH多机或性能验收；单步Q网络不是长期DQN性能结论。

## 文档入口

- [现有系统与申报书功能审查表](docs/07-proposal-audit.md)：逐项覆盖结论、待补功能、指标验收及本期范围差异，作为申报书视角的进度入口。

- [终端卸载当前协议](docs/contracts/s5-terminal-offloading.md)：显式资格、RULE选层、Placement范围、容量FIFO及配置升级。
- [S5-04a终端Docker执行](docs/contracts/s5-terminal-docker.md)：终端本地执行、可信来源、文件传递和失败/取消基础。

- [S5-03网关/终端与策略](docs/contracts/s5-edge-access.md)：账号配置、管理API、事件触发和正常结果查询。需要管理员登记资源/网关/终端及显式策略Flow，不自动初始化业务模板。

- [系统总览](docs/00-overview.md)：模块边界与目标。
- [项目结构和全部 Java 文件](docs/01-code-architecture.md)：职责、事务、测试。
- [实施计划](docs/03-implementation-plan.md) / [当前进度](docs/04-progress.md) / [功能索引](docs/02-feature-index.md)。
- [当前 API、DSL 与 Worker 协议](docs/contracts/README.md) / [文档维护规则](docs/05-documentation-guide.md)。
- [生产部署保障范围](docs/06-deployment-safeguards-review.md)：已确认保留、最小实现与后置项，随后续阶段落实。

## 构建和测试

JDK 21、Maven 3.8.8–3.x；Spring Boot 4.1.1、Jackson 3、MySQL 8、Flyway，版本由父 POM 锁定。
完整验证需要运行中的 Docker 和PATH中可用的Docker CLI，Testcontainers自动创建独立MySQL、Registry/K3s/MinIO及终端测试引擎并清理容器，不连接旧数据库。首次需要下载依赖和测试镜像；缺少Docker会失败，不跳过集成测试冒充通过。

在 backend 目录运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-scaffold.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify.ps1 -JavaHome '你的 JDK 21 目录'
```

有 JDK 21 的终端可运行 `mvn -B -ntp clean verify`。首次变更编译器参数后使用 clean，以免沿用旧 class。
仅定义单元测试：`mvn -B -ntp -pl workflow-runtime -am test`，不需要 Docker，但不能替代完整验收。
脚本仅在进程内切换 JAVA_HOME 并恢复；不修改全局 Java 8 或旧工程。

## 本地启动

先准备**新后端专用的空 MySQL 8 数据库**和对应账号，不能指向旧系统库。当前Flyway依序运行V1–V27，创建28张业务表及迁移历史表；本批验收/发布状态见进度。
测试库是一次性的，不能用于日常保存数据。最小部署及单机故障验证已完成，步骤见[部署说明](docs/operations/s4-minimal-deployment.md)；UI-10补两角色账号管理，TLS、自动备份恢复仍后置。

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
`com.project.platform.server.BackendApplication`。人员通过管理API/用户页维护；外部 Spring 配置的 `platform.security.users` 只用于首次人员初始化及CONNECT机器账号，不在请求中传身份。

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

目录预览只检查已登记的位置/格式/启用标志，不保证真实可用容量。S4-03执行时另外检查Ready节点、数据本地性并预约平台Job名额，随后创建真实Job；详见[执行协议](docs/contracts/s4-job-execution.md)。

## S4-02a应用契约目录

[应用目录API](docs/contracts/s4-application-catalog.md)支持版本登记、查询及参数类型、默认值、choices、数据集允许范围校验。[契约示例](examples/s4-application-contract.json)引用mnist/v1，登记前需通过资源API注册对应pt数据版本；不会拉取或执行示例镜像。

Flow作者显式定义Inputs和Task参数来源；不从Application契约派生Flow Input，不维护别名绑定模型。已有Log/Sleep及Flow绑定保持原语义。UI-02的YAML与No-code编辑同一份Flow定义。Application Task使用同一份Flow及既有Binding。

S4-02b/c已接入真实Registry复制与Kubernetes常驻部署，配置/API见[部署协议](docs/contracts/s4-image-deployment.md)。一次性Job另见[执行协议](docs/contracts/s4-job-execution.md)及[Flow示例](examples/s4-application-flow.yaml)，示例须先登记实际shell-tools应用并配置资源/存储，不是内置模板。S4已完成，当前S5验收状态见进度。
## S5-01 Repeat

[协议](docs/contracts/s5-repeat.md) · [通用状态反馈示例](examples/s5-repeat-flow.yaml)。每轮创建独立TaskRun，整轮结束后传递反馈，不覆盖前一轮。该示例是Log状态反馈，不是联邦学习训练或吞吐基准；真实FedAvg/FedProx另见下方S5-02。终端卸载与计量仍在后续S5批次。

## S5-02 FedAvg / FedProx

本批仅迁移这两个算法，其他流任务暂不迁移。通过既有Application/Repeat执行，Flow经API保存为数据库修订；没有Java内置模板或启动自动seed。源码、构建、数据准备和首次注册见[运行说明](algorithms/federated/README.md)，范围见[S5-02规格](docs/features/S5-02-federated.md)，实际验证见[验收记录](docs/verification/VER-S5-002-federated.md)。

完整verify新增真实CPU算法镜像构建、MNIST准备及22个Job验证；首次需访问PyPI/PyTorch镜像源和官方MNIST下载站，耗时高于S4。已下载原始文件可在platform-server/target/federated-data/raw复用，仍逐次校验完整性并重新执行训练。网络失败会明确失败，不跳过或回退合成数据。
