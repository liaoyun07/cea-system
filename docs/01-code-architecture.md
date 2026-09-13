# 项目结构与 Java 文件索引

UI-10增量（验收/发布状态见进度）：5个新生产Java文件，共104个；新增12个HTTP操作，共89个；6个新公开record映射，共94个。V21/V22/V23分别增加Flow头、Execution、DatasetVersion的deleted列；V24增加sec_user人员表（26张业务表），没有构建历史表、第二个Executor/Worker或新模块依赖。

| Java 文件 | 当前职责 |
|---|---|
| `platform-dataflow/src/main/java/com/project/platform/dataflow/definition/DatasetRemovalService.java` | 通过resource事务与dataset行锁、deployment公开契约引用查询协调删除，不访问跨模块Repository |
| `platform-deployment/src/main/java/com/project/platform/deployment/upload/ImageBuildService.java` | 有界ZIP展开、独立BuildKit客户端进程/输出归档/日志、并发与超时；成功后复用ImageUploadService |
| `platform-server/src/main/java/com/project/platform/server/api/ImageBuildController.java` | ZIP/contract multipart身份适配，不直接构建或访问仓库 |
| `platform-server/src/main/java/com/project/platform/server/api/UserController.java` | 6个用户/个人资料API，委托已有IdentityDirectory执行两角色及范围校验 |
| `platform-server/src/main/java/com/project/platform/server/api/HealthController.java` | 无凭据的最小DB readiness，仅UP/DOWN；通过ExecutionService读取DB时间，不直读业务表 |

既有IdentityDirectory成为数据库人员账号的认证源；CONNECT机器身份仍外置。FlowService/JdbcFlowRepository、ExecutionService/JdbcExecutionStore、ResourceCatalogService/JdbcResourceRepository分别拥有本域逻辑删除；SchedulerEngine.remove移除未来触发，FlowExecutionService提交与删除共用Flow头事务锁。ApplicationCatalogService登记契约与Dataset删除共用资源事务/锁。新增ExecutionController.definition读取原Execution快照，由ExecutionGraph消费，删除Flow后不丢历史图。前端UsersPage、既有列表/CatalogPage提供操作；生产构建进程不依赖宿主Docker。协议见[UI-10](contracts/ui10-cleanup-users-build.md)。

UI-09（验证/发布状态见进度）：新增6个生产Java文件，共99个；新增13个HTTP操作，共77个；新增11个公开record映射，共88个。V20只给dep_application_version增加deleted列，删除目录后禁止版本号复用；已保留契约的image仍经ApplicationCatalogService.knownImages提供给Registry作为现场查询候选，不恢复执行契约或活动目录。无新表、模块依赖、执行状态或SPI。

| Java 文件 | 当前职责 |
|---|---|
| `platform-resource/src/main/java/com/project/platform/resource/kubernetes/KubernetesManagementService.java` | Namespace/Service实时CRUD、默认范围及所有权保护、CAS删除、地址/Pod详情和工作负载引用检查；不修改Runner默认Namespace |
| `platform-server/src/main/java/com/project/platform/server/api/KubernetesManagementController.java` | 7个管理HTTP操作，身份适配后调用resource |
| `platform-deployment/src/main/java/com/project/platform/deployment/distribution/RegistryHttpClient.java` | 管理员配置的Distribution v2目录、标签、manifest/config和删除；有界响应、匿名/htpasswd、禁止重定向凭据；传输仍由Skopeo执行 |
| `platform-deployment/src/main/java/com/project/platform/deployment/distribution/RegistryManagementService.java` | 实际库存与详情；已知无标签候选必须现场核验；删除前检查目录、工作负载、分发和索引引用；不GC |
| `platform-server/src/main/java/com/project/platform/server/api/RegistryController.java` | 5个Registry查询/删除HTTP操作，禁止请求指定任意地址 |
| `platform-dataflow/src/main/java/com/project/platform/dataflow/definition/ApplicationRemovalService.java` | 通过公开Flow/资源/应用服务检查所有已存Flow修订及工作负载，单独移除目录；保留版本身份，不删除Registry文件 |

前端新增RegistryPage.vue、KubernetesManagement.vue；现有CatalogPage增加目录删除，KubernetesResourcesPage保留节点展示并接入按Namespace管理。协议见[UI-09](contracts/ui09-registry-kubernetes.md)。

这是当前代码结构的权威索引。状态与计划见[实施计划](03-implementation-plan.md)和[进度](04-progress.md)。包根为 `com.project.platform`，不沿用旧 DTO/包依赖。

UI-06增量（2026-09-12）：新增ExecutionOutputService（下表列出）和1个GET output-json操作；ObjectStorage增加精确成功产物的有界读取，既有Controller/异常映射/装配新增当前消费者。执行链、依赖边界及表/列不变。该批完成时为87个生产Java文件、52个HTTP操作、58个显式公开record映射和23张业务表；后续UI-07增量见下文。前端ExecutionMetrics/execution-metrics为按需读取/图表/明细消费者，详见[边界](features/UI-06-execution-metrics.md)。

UI-04 SELECT增量（2026-09-12）：只修改既有FlowDefinition.Input（增加values及SELECT枚举）、FlowValidator（选项定义/默认值约束）、BindingResolver（运行输入类型/成员校验）、FlowSchema（选项字符串数组编辑结构）。Input.values以List<Object>保留原始JSON元素类型，避免数字/布尔被反序列化为字符串而绕过校验；合法定义只允许非空白、不重复的字符串。消费者为保存校验、预览、统一prepare及No-code/执行表单。无新增/删除Java文件、表/列、SPI或模块依赖；仍使用原Flow修订与Execution快照JSON，无DB migration。完整语义见[SELECT输入](features/UI-04-select-input.md)。

## 工程结构

UI-08增量（已验证，未发布CEA）：4个新生产Java文件，总数93；7个新增HTTP操作，总数64；77个显式公开record映射；V18/V19增加2张业务表，总数25。无新增模块依赖、工作流状态机或SPI。现有DeploymentService改为读回配置、CAS保留非托管字段并支持仅副本修改；KubernetesResourceService增加近期Metrics API查询（不存储时序数据）。

| Java 文件 | 当前职责 |
|---|---|
| `platform-deployment/src/main/java/com/project/platform/deployment/distribution/JdbcImageDistributionRepository.java` | 保存按需分发尝试，授权服务查询历史时将超期未确认操作投影为UNKNOWN |
| `platform-deployment/src/main/java/com/project/platform/deployment/upload/ImageUploadService.java` | 限制归档大小/导入并发，受控中心仓库导入与digest核验后登记应用，清理本次临时文件 |
| `platform-deployment/src/main/java/com/project/platform/deployment/service/JdbcDeploymentRecordRepository.java` | 操作计量证据：起点、UID/generation、目标副本、观测连续性、结果；不存储期望Pod配置 |
| `platform-deployment/src/main/java/com/project/platform/deployment/service/DeploymentRolloutTracker.java` | 后台仅观察已接受的Deployment变更，确认同版本就绪及计时，不apply、不重试、不调度 |

前端现有CatalogPage/CatalogForm增加镜像上传和按需分发历史，DeploymentsPage增加配置回读/编辑/副本调整/操作计时，KubernetesResourcesPage增加节点和命名空间容器用量；operations.js只格式化有效值，api.js保留浏览器FormData边界。所有执行仍走原Execution/Worker/Runner。

UI-07增量：2个新Java文件（89个总数），5个只读GET（57个总数），无新增表/列/SPI或执行链。ExecutionService中的Overview/DayCount/Recent由JdbcExecutionStore聚合、FlowExecutionService鉴权透出，消费方是总览；资源查询DTO仅传输实时展示字段。ExecutionOutputService.OutputSource从执行快照返回任务ID/声明端口，避免跨USER/EDGE_POLICY管理入口查Flow。

| Java 文件 | 当前职责 |
|---|---|
| `platform-resource/src/main/java/com/project/platform/resource/kubernetes/KubernetesResourceService.java` | READ授权后查询Node/Service/配置Namespace及近期Metrics API用量；节点按capacity、容器按明确limit，缺样不补零；不调度或写资源 |
| `platform-server/src/main/java/com/project/platform/server/api/KubernetesResourceController.java` | 5个只读GET的身份、参数与响应适配（UI-08增加节点/容器用量） |

前端新增OverviewPage.vue/overview.js为窗口汇总展示，ExecutionArtifacts.vue为声明产物与按需JSON预览，management/KubernetesResourcesPage.vue为资源目录选择、只读分页。Metrics和产物页共同读取output-files，不再从Flow管理入口解析源码；数值读取和统计语义不变。

DEPLOY-01新增`deploy/cea/`：Dockerfile/Compose负责12个CEA常驻容器与独立卷；application.yaml/.env.example负责显式连接；initialize/start/seed-federated/verify-federated脚本分别负责本地配置、服务启动、首次业务登记、真实算法验收，verify-browser.mjs读取实际工作台。详细范围见[部署文档](../deploy/cea/README.md)。未新增Java文件/表/API/SPI；现有`KubernetesJobRunner.upload`改为InputStream文件内容上传，避免非root Linux后端的tar归属信息与受限Pod权限冲突，执行主链不变。

UI-01新增仓库内`frontend/`独立npm工程，不增加Maven模块或Java文件。实际调用：Vue → 同源/api代理 → 既有Controller/公开服务 → 原Execution链。生产文件如下，启动和测试见[前端README](../frontend/README.md)。

| 前端文件 | 当前职责 |
|---|---|
| `frontend/src/main.js` | 挂载Vue及全局样式 |
| `frontend/src/App.vue` | 内存认证、命名空间、列表/搜索/分页、页面切换和未保存提示 |
| `frontend/src/FlowEditor.vue` | YAML源、服务端校验/Schema、CAS修订、输入预览、固定请求幂等提交 |
| `frontend/src/no-code/document.js` | 唯一YAML的Document路径编辑、任务分组操作、引用删除保护和作用域选项；无执行状态 |
| `frontend/src/no-code/NoCodeEditor.vue` | 任务选择、Schema与实际目录读取、原source修改事件、表单错误状态 |
| `frontend/src/no-code/TaskTree.vue` | 递归分组任务块、折叠、添加/移动/删除事件 |
| `frontend/src/no-code/SchemaField.vue` | 原Schema字段编辑，不建立第二套Flow模型 |
| `frontend/src/no-code/BindingField.vue` | 原五种Binding显式编辑、作用域/契约选项 |
| `frontend/src/no-code/FlowRevisions.vue` | 分页历史、源码并排比较、原CAS回退接口 |
| `frontend/src/ExecutionDetail.vue` | 实际Execution/TaskRun/Attempt、增量日志、结果与后处理、取消/轮询释放 |
| `frontend/src/api.js` | Basic、同源请求、超时和结构化错误，无新服务状态 |
| `frontend/src/model.js` | 六种输入转换、提交快照、日志去重/窗口、显式插入的Log草稿 |
| `frontend/src/management/catalogs.js` | 新API路径、目录表列与表单值到既有请求体转换；无后端模型或第二套Binding |
| `frontend/src/management/CatalogPage.vue` | 七类目录的分页/详情/登记/启停、应用镜像准备、策略CAS保存、取消过期读取 |
| `frontend/src/management/CatalogForm.vue` | 集群/数据集位置/应用契约/网关/终端字段，策略复用同源NoCodeEditor |
| `frontend/src/management/DeploymentsPage.vue` | 按集群创建/查询/配置回读/CAS编辑/手动扩缩容/删除Deployment；展示操作历史和有效就绪耗时 |
| `frontend/src/style.css` | Kestra参考方向的工作台、编辑区、执行标签、响应式样式 |
| `frontend/vite.config.js` | 独立构建、开发/本地预览同源代理 |

测试：`frontend/tests/unit/model.test.js`（转换/请求/错误）和`frontend/tests/e2e/console.spec.js`（实际JAR浏览器闭环）；`frontend/tests/run-e2e.mjs`管理仅本次临时MySQL/JAR/预览生命周期。无Java/表/字段/API/SPI变更。

UI-02新增`frontend/tests/unit/no-code.test.js`（文档往返/引用/分组）与`frontend/tests/e2e/no-code.spec.js`（无代码创建/执行、动态作用域、目录、修订和大任务树）。新增yaml依赖用于真实AST编辑保留注释，不参与后端执行。`deploy/cea/verify-browser.mjs`只读复核实际部署页面；所有证据见[UI-02验收](verification/VER-UI-002-no-code.md)。生产Java仍为86份。

UI-03新增management单测/浏览器测试与`frontend/tests/runtime-fixture.mjs`真实临时Registry/K3s夹具，由既有run-e2e统一启动清理。目录请求分别到Resource/Application/Edge/Offloading Controller；常驻部署直接复用DeploymentController，策略只用EdgeController保存单一Flow。没有新增生产Java、HTTP操作、表、字段、SPI或跨模块依赖。

根 `pom.xml` 是独立父工程，聚合八个模块。server 是 Spring Boot 可执行 JAR，其余模块为普通 JAR。生产Java共86份（含8份包声明），测试类另列。

## S6-02至04实际增量

文件与生命周期已实现，212项Maven和12项Python完整验收通过。主链仍为FlowExecutionService/终端策略/Scheduler → ExecutionService（首次提交Checks）→ FlowExecutor → WorkerEngine。主终态先落库，随后原Executor继续AFTER_EXECUTION阶段；失败不改主结果。SLA由同一个Executor使用DB时间记录。ApplicationTaskRunner读取固定Namespace文件修订到原Prepared.inlineFiles。字段、事务和有意简化见[协议](contracts/s6-files-lifecycle.md)。

| Java 文件路径（相对 backend） | 职责 | 关键接口 | 状态/事务 | 功能 | 验证入口 |
|---|---|---|---|---|---|
| `platform-dataflow/src/main/java/com/project/platform/dataflow/definition/NamespaceFileService.java` | 命名空间小型文本不可变修订、版本CAS和执行读取 | save/get/list/forExecution | 只读写本模块df_namespace_file；唯一主键仲裁并发CAS | WF-015 | FlowManagementTest/ImageDistributionTest |
| `platform-server/src/main/java/com/project/platform/server/api/NamespaceFileController.java` | 文件保存/精确版本读取/目录 | save/get/list | READ/WRITE，委托服务 | WF-015 | FlowManagementTest/ContractTest |
| `platform-server/src/main/java/com/project/platform/server/api/WebhookController.java` | 认证Webhook到统一提交 | trigger | EXECUTE、幂等键及Flow opt-in；无第二触发队列 | WF-014 | FlowManagementTest/ContractTest |

修改既有FlowDefinition/Validator/BindingResolver/FlowService/FlowExecutionService/ExecutionService/SchedulerEngine，加入显式声明、校验、统一门禁和预览；ExecutionRecord/ExecutionController公开slaViolatedAt；FlowExecutor/JdbcExecutionStore支持告警与终态后处理；RuntimeConfiguration/JobConfiguration装配文件服务。新增Check、Sla、NamespaceFile及三个文件API record。V16新增1张文件修订表，V17新增1个SLA时间列并扩大既有phase列。无新SPI/Runner/Binding/Executor或模块依赖。当前51个HTTP操作、58个显式公开record映射，23张业务表。

## S6-01实际增量

S6-01新增FlowSchema从现有FlowDefinition record、Jackson字段别名/Binding多态和Validator支持类型生成结构Schema；FlowService.schema为实际消费者。校验/输入预览复用FlowParser/FlowValidator/BindingResolver；导入复用原save事务，按flowId排序取得head锁；搜索只读dataflow自己的最新USER修订。该批5个新HTTP操作、5个请求/响应record，无新DSL/表/字段/迁移/状态/SPI。完整语义见[协议](contracts/s6-flow-editing.md)和[ADR-0018](decisions/ADR-0018-flow-editing.md)。本轮增量见上节。

| Java 文件路径（相对 backend） | 职责 | 关键接口 | 状态/事务 | 功能 | 验证入口 |
|---|---|---|---|---|---|
| `workflow-runtime/src/main/java/com/project/platform/runtime/definition/FlowSchema.java` | 从运行模型生成编辑用结构Schema；不替代语义校验 | generate | 无状态/缓存/数据库 | WF-016 | FlowManagementTest |

## S5-04b实际增量

S5-04c修正：以下offloading调用仅用于显式offload。普通CLUSTER和固定TERMINAL不再创建/读取观测；JobPlacementService新增releaseTerminal(namespace,key)重载，ApplicationTaskRunner在未准备完成的取消/失败路径通过真实预约释放槽位，Prepared存在时使用其实际终端位置。删除observe门面，无新类/字段/表/API/SPI；见[ADR-0017](decisions/ADR-0017-offloading-decoupling.md)。

ApplicationTaskRunner调用offloading公开服务冻结决策、记录画像与反馈，调用resource公开服务进行终端FIFO准入；普通CLUSTER不调用决策。Executor/Worker归并主链不变，无新Runner/SPI。JobConfiguration装配服务及终端context/slots；ObjectStorage.size读取真实对象大小。FlowDefinition.Container增加Offload，仍使用原Binding。完整字段消费者见[卸载协议](contracts/s5-terminal-offloading.md)。

| Java 文件路径（相对 backend） | 职责 | 关键接口 | 状态/事务 | 功能 | 验证入口 |
|---|---|---|---|---|---|
| `platform-offloading/src/main/java/com/project/platform/offloading/DqnModel.java` | 13维单步Q网络校验、推断与不可用动作屏蔽 | validate/predict/choose | 无持久状态 | OFF-001 | OffloadingTest/ImageDistributionTest |
| `platform-offloading/src/main/java/com/project/platform/offloading/JdbcOffloadingRepository.java` | 画像观测、首次决策和不可覆盖模型版本 | begin/started/finish/estimate/register | 仅off两表；Attempt唯一键、首次反馈条件更新 | OFF-001、OFF-002 | OffloadingTest |
| `platform-offloading/src/main/java/com/project/platform/offloading/OffloadingService.java` | 显式终端卸载规则、状态构造、模型选择和反馈门面 | decide/started/finish/samples | 不读写运行或资源表 | OFF-001、OFF-002 | OffloadingTest/ImageDistributionTest |
| `platform-server/src/main/java/com/project/platform/server/api/OffloadingController.java` | 模型注册/查询及真实样本导出 | register/model/samples | 仅服务调用；WRITE/READ授权 | OFF-001、OFF-002 | OffloadingTest/ContractTest |

V14增加resource的res_terminal_reservation，JobPlacementService以既有网关资源行锁串行化FIFO入队/准入/释放。V15增加off_task_observation、off_dqn_model；共22张业务表、V1–V15，42个HTTP操作和47个公开record映射。没有第二份Execution状态表。新增OffloadingTest，测试类共11个。离线训练位于[algorithms/offloading](../algorithms/offloading/README.md)，不是新增服务模块。

## S5-04a实际增量

04a新增下列两个runtime类；ApplicationTaskRunner复用契约/文件准备，通过server注入的可信终端目标选择Docker。EdgeAccessService的executionOrigin/workerActor权限只来自持久接入关系。04a本身无新表/API，04b依赖/表及规则/模型增量见上节；Executor主链始终不变。完整字段消费者见[终端协议](contracts/s5-terminal-docker.md)。

| Java 文件路径（相对 backend） | 职责 | 关键接口 | 状态/事务 | 功能 | 验证入口 |
|---|---|---|---|---|---|
| `workflow-runtime/src/main/java/com/project/platform/runtime/worker/ContainerTask.java` | 两种容器执行器共用的命令、文件和启动包装 | Spec/Filesystem/name | 无业务状态 | RUN-001 | ImageDistributionTest |
| `workflow-runtime/src/main/java/com/project/platform/runtime/worker/DockerTaskRunner.java` | 可信context上的真实容器执行、文件传递、停止和同Attempt确认 | run | 不写Execution表；复用TaskContext租约 | RUN-001 | ImageDistributionTest |

S5-02算法应用单独位于[algorithms/federated](../algorithms/federated/README.md)：Python数值核心、文件CLI、数据准备及数值验证。五份Application契约和两份Flow YAML位于examples/federated，经[注册脚本](../scripts/register-federated.ps1)写入既有数据库，不新增Maven模块或生产Java文件。Java调用链仍为FlowExecutionService → FlowExecutor → WorkerEngine → ApplicationTaskRunner → KubernetesJobRunner。

## S5-02b实际增量

无新增生产Java文件/模块/API/SPI。`FlowDefinition.java`增加Loop record、ITEM Binding及candidateClusters统一反序列化；`FlowValidator.java`校验作用域/边界；`BindingResolver.java`解析当前item，`CommonTaskRunner.java`复用该解析入口。`FlowExecutor.java`按同一执行锁推进动态组和屏障；`JdbcExecutionStore.java`仅创建当前动态作用域并查询已接纳的局部序号。

`ApplicationTaskRunner.java`解析动态集群及URI数组，Prepared.inlineFiles在既有prepared_json保存JSON清单；`ObjectStorage.java`复用同一输入URI权限检查，在派发前拒绝确定非法输入，避免进入远程不确定结果恢复。`KubernetesJobRunner.java`无新增分支，仍搬运命名本地文件。V11只替换TaskRun唯一索引以包含父作用域，无新业务表/列；完整字段消费者见[协议](contracts/s5-loop.md)。

## 模块依赖白名单

依赖指向被使用方。跨模块只调用公开接口；POM白名单由结构脚本检查；ArchUnit检查包环、runtime方向、model不依赖Spring/JDBC及Controller不访问持久化。

| 模块 | 允许的项目依赖 |
|---|---|
| workflow-runtime | 无 |
| platform-foundation | 无 |
| platform-resource | platform-foundation |
| platform-deployment | platform-resource, platform-foundation |
| platform-offloading | workflow-runtime, platform-resource, platform-foundation |
| platform-edge | workflow-runtime, platform-resource, platform-foundation, platform-dataflow |
| platform-dataflow | workflow-runtime, platform-deployment, platform-resource, platform-foundation, platform-offloading |
| platform-server | workflow-runtime, platform-foundation, platform-resource, platform-deployment, platform-offloading, platform-edge, platform-dataflow |

runtime 与 foundation 是两个底层边界；runtime 不能通过 foundation 间接依赖业务。业务模块不能互相读取表。选址/镜像准备/外部执行等接口放在其真正使用方的 API/SPI，由 server 注入实现，避免 runtime → 业务模块的反向依赖。未来必要依赖先修改 ADR/白名单，再改代码。

## 当前全部生产 Java 文件

S5-03增加6份生产Java，合计76份（含8份package-info）；新增4张edge业务表和Flow head管理范围字段，共19表、V1–V13。新增12个HTTP操作、8个公开record映射，总数39/43。edge仅通过dataflow公开服务进入现有执行链，runtime没有修改；字段与事务边界见[接入协议](contracts/s5-edge-access.md)。

| Java 文件路径（相对 backend） | 职责 | 关键接口 | 状态/事务 | 功能 | 验证入口 |
|---|---|---|---|---|---|
| `platform-edge/src/main/java/com/project/platform/edge/EdgeAccess.java` | 接入登记、策略及事件record | Gateway/Terminal/Policy/Event | 不含Execution状态 | EDGE-001、EDGE-002 | EdgeAccessTest/C |
| `platform-edge/src/main/java/com/project/platform/edge/JdbcEdgeRepository.java` | edge四表持久化及可信执行来源查询 | putGateway/putTerminal/putPolicy/receipt/record/executionOrigin | 终端锁、唯一事件路由、接入回执；不读运行表 | EDGE-001、EDGE-002 | EdgeAccessTest |
| `platform-edge/src/main/java/com/project/platform/edge/EdgeAccessService.java` | 归属检查、策略范围、统一提交/查询及内部执行鉴权 | submit/event/result/executionOrigin/workerActor | 接入回执及Execution同事务；不复制运行状态 | EDGE-001、EDGE-002、SEC-001 | EdgeAccessTest/A |
| `platform-server/src/main/java/com/project/platform/server/api/EdgeController.java` | 管理HTTP入口 | gateway/terminal/policy/list | READ/WRITE；外部CONNECT账号检查 | EDGE-001、EDGE-002 | EdgeAccessTest/C |
| `platform-server/src/main/java/com/project/platform/server/api/EdgeAccessController.java` | 网关HTTP入口 | heartbeat/submit/event/result | CONNECT；202在事务完成后返回 | EDGE-001、EDGE-002 | EdgeAccessTest/C |
| `platform-server/src/main/java/com/project/platform/server/configuration/EdgeConfiguration.java` | 装配edge公开服务 | edgeRepository/edgeAccessService | 使用既有同库TransactionTemplate | EDGE-001、EDGE-002 | EdgeAccessTest/A |

S5-03修改既有FlowService/JdbcFlowRepository/FlowExecutionService，增加EDGE_POLICY范围保存/读取/提交及USER范围检查；AccessPolicy增加CONNECT，IdentityDirectory拒绝CONNECT和管理权限混用。无新Runner/SPI/Executor/Binding。

所有路径相对backend。生产文件逐一登记；测试别名：D=DefinitionTest，I=DurableWorkflowTest，C=ContractTest，A=ArchitectureTest，L=LifecycleTest，T=ControlFlowTest，J=ImageDistributionTest（路径见下文）。S4-03当前增加真实一次性Job；验证状态见进度。

| Java 文件路径（相对 backend） | 职责 | 关键接口 | 状态/事务 | 功能 | 验证入口 |
|---|---|---|---|---|---|
| `workflow-runtime/src/main/java/com/project/platform/runtime/worker/TaskRunner.java` | 被Worker真实消费的外部任务执行边界 | run | 不定义第二套状态 | RUN-001 | J/A |
| `workflow-runtime/src/main/java/com/project/platform/runtime/worker/TaskContext.java` | 租约作用域的冻结计划及停止请求 | job/check/prepared/prepare/cancellation/stop | 只访问Worker传输表；旧owner禁止写计划 | RUN-001 | J |
| `workflow-runtime/src/main/java/com/project/platform/runtime/worker/KubernetesJobRunner.java` | 一次性Job接管、文件暂存/收集、远程停止 | run；使用ContainerTask.Spec/Filesystem | Job事实属于Kubernetes，结果交Worker；不写Execution表 | RUN-001 | J/A |
| `platform-resource/src/main/java/com/project/platform/resource/placement/JobPlacementService.java` | Ready节点/数据本地性与平台槽原子预约 | reserve/get/release | resource表；集群行锁；取消前置墓碑避免迟到预约 | RES-002 | J |
| `platform-resource/src/main/java/com/project/platform/resource/storage/ObjectStorage.java` | namespace S3文件下载/发布/存在校验 | download/publish/published | 管理员凭据文件；产物前缀隔离 | RES-001、RUN-001 | J |
| `platform-dataflow/src/main/java/com/project/platform/dataflow/execution/ApplicationTaskRunner.java` | 契约/显式Binding/资源/镜像到runtime Kubernetes或Docker的适配 | run/TerminalTarget | prepared_json冻结cluster/dockerContext/digest/env/文件；不改Execution状态 | RUN-001、DEP-001 | J/A |
| `platform-server/src/main/java/com/project/platform/server/configuration/JobConfiguration.java` | 作业槽、S3/终端Docker连接及可信TaskRunner装配 | Settings/Beans | 外部配置，无业务状态；通过edge公开服务注入来源/权限 | RUN-001、SEC-001 | J |
| `workflow-runtime/src/main/java/com/project/platform/runtime/model/FlowDefinition.java` | 统一DSL、嵌套Task/Concurrency/Schedule与显式Binding记录 | record构造与immutable | 只读定义；嵌套值提交后序列化冻结 | WF-001、WF-002 | D/C |
| `workflow-runtime/src/main/java/com/project/platform/runtime/model/ExecutionState.java` | 执行/任务状态 | terminal | Execution无RETRYING/SKIPPED；TaskRun可RETRYING/SKIPPED；QUEUED仅Execution | WF-004 | I |
| `workflow-runtime/src/main/java/com/project/platform/runtime/model/ExecutionRecord.java` | 运行、TaskRun、Attempt、日志、幂等回执记录 | record访问器 | 承载持久状态；区分mainState/cleanupError、phase/retryAt；parentTaskRunId/iteration标记Repeat轮次 | WF-004、WF-006 | I/C |
| `workflow-runtime/src/main/java/com/project/platform/runtime/model/WorkflowException.java` | 领域校验/冲突/未找到异常 | invalid/missing/conflict | 不暴露SQL或模板上下文 | WF-001 | D/I |
| `workflow-runtime/src/main/java/com/project/platform/runtime/definition/JsonCodec.java` | 统一JSON序列化与请求规范摘要 | write/read/map/flow/hash | map键排序SHA256 | WF-001、WF-005 | D/I |
| `workflow-runtime/src/main/java/com/project/platform/runtime/definition/FlowParser.java` | 单文档JSON/YAML与未知/重复/尾随文档拒绝；规范YAML导出 | parse/yaml | 无写入；限源文本长度 | WF-001、WF-016 | D/C/FlowManagementTest |
| `workflow-runtime/src/main/java/com/project/platform/runtime/definition/FlowValidator.java` | 叶子/控制树、DAG环、Cron/输入、跨阶段ID与Binding校验 | validate/identifier | 保存前校验；表达式引用运行时检查 | WF-001、WF-002 | D/I |
| `workflow-runtime/src/main/java/com/project/platform/runtime/definition/BindingResolver.java` | 类型检查、默认输入、变量与最终输出 | prepare/resolve/outputs | 仅根据作者定义的Flow准备输入/变量，不从Application派生 | WF-002 | D/I |
| `workflow-runtime/src/main/java/com/project/platform/runtime/definition/TemplateRenderer.java` | 严格Pebble表达式 | validate/render | 无模板语句；限制渲染长度 | WF-002 | D/I |
| `workflow-runtime/src/main/java/com/project/platform/runtime/persistence/JdbcExecutionStore.java` | 运行状态、消息、日志及Flow准入锁 | transaction/create/createIteration/nextMessage/admission/promote/controlState/requestCancel | 状态、日志、消息同一JDBC事务；数据库时间与消费行锁 | WF-004、WF-005、WF-008 | I |
| `workflow-runtime/src/main/java/com/project/platform/runtime/execution/ExecutionService.java` | runtime公开提交/查询入口 | submit/configureConcurrency/transaction及查询取消 | 准入/提交事务+唯一幂等键；不自己验证HTTP身份 | WF-004、WF-005、WF-006 | I |
| `workflow-runtime/src/main/java/com/project/platform/runtime/executor/FlowExecutor.java` | 唯一状态推进者：控制树解释、叶子派发归并、三段处理 | processNext | 短事务；Repeat轮次屏障/反馈与按作用域读取；分支持久化、并行失败收敛、清理及额度释放；不执行叶子代码 | WF-005、WF-008、WF-009、WF-010 | I |
| `workflow-runtime/src/main/java/com/project/platform/runtime/executor/ExecutionReducer.java` | 同组节点就绪与固定重试时间的纯决策 | ready/retryAt | 无I/O；供Executor使用 | WF-008 | L/I |
| `workflow-runtime/src/main/java/com/project/platform/runtime/persistence/JdbcWorkerStore.java` | Worker传输表与结果持久化 | dispatch/result/remove/claim/heartbeat/finish | 领取短事务；owner/epoch/租约/deadline隔离；不写运行状态表 | WF-007 | I/A |
| `workflow-runtime/src/main/java/com/project/platform/runtime/worker/WorkerJob.java` | 派发载荷及Lease/Result记录 | record访问器、Result.success/failed | 冻结Task/上下文；TaskRun+Attempt定位，epoch隔离持有者 | WF-007 | I |
| `workflow-runtime/src/main/java/com/project/platform/runtime/worker/WorkerEngine.java` | 事务外执行Log/Sleep或委派真实TaskRunner，心跳和协作中断 | runOnce/close | 不拥有Execution状态；关闭/失租不报告业务失败 | WF-007、WF-008 | I/A |
| `platform-server/src/main/java/com/project/platform/server/configuration/WorkerPump.java` | 可关闭的Worker轮询角色 | poll | 默认每进程最多4个叶子任务；许可限制并行派发，不阻塞调度线程 | WF-007 | I |
| `platform-foundation/src/main/java/com/project/platform/foundation/identity/AccessPolicy.java` | Actor与命名空间/action授权 | require | 无存储；拒绝越权 | SEC-001 | I |
| `platform-dataflow/src/main/java/com/project/platform/dataflow/definition/FlowRevision.java` | 版本内容和列表摘要 | record访问器 | 不可变版本与来源；删除无业务消费者checksum | WF-003 | I/C |
| `platform-dataflow/src/main/java/com/project/platform/dataflow/definition/JdbcFlowRepository.java` | 仅定义头/版本表持久化及USER源搜索 | save/get/history/search | 锁稳定head，CAS保存；只追加版本 | WF-003、WF-015 | I/FlowManagementTest |
| `platform-dataflow/src/main/java/com/project/platform/dataflow/definition/FlowService.java` | 定义管理及编辑门面 | save/get/history/list/search/rollback/schema/validate/preview/export/importFlows | WRITE/READ授权；启用Schedule另需EXECUTE；修订/并发配置/Schedule同事务，批量全有或全无 | WF-003、WF-015、WF-016、SEC-001 | I/FlowManagementTest |
| `platform-dataflow/src/main/java/com/project/platform/dataflow/execution/FlowExecutionService.java` | 提交、取消与运行查询门面 | submit/get/list/tasks/attempts/logs/cancel | 授权；原始请求hash优先查幂等，解析版本后委托runtime | WF-004、WF-006、SEC-001 | I |
| `platform-dataflow/src/main/java/com/project/platform/dataflow/execution/ExecutionOutputService.java` | 授权读取已有JSON及快照输出声明 | readJson/declarations/OutputSource/Unavailable | 真实TaskRun/成功Attempt/执行固定快照；声明查询兼容管理范围但无回退分支；JSON 256KiB；无写入 | UI-06/07 | J |
| `platform-server/src/main/java/com/project/platform/server/BackendApplication.java` | Boot standalone启动 | main | 无业务状态 | FND-001 | I |
| `platform-server/src/main/java/com/project/platform/server/configuration/RuntimeConfiguration.java` | 显式构造服务/存储/执行器Bean | 各@Bean工厂 | 共享DataSource与READ_COMMITTED事务；租约/截止/触发使用DB时间 | WF-005 | I |
| `platform-server/src/main/java/com/project/platform/server/configuration/ExecutorPump.java` | 有限批次内置消息推进 | poll | 每步由Executor独立事务；DB故障下次再试 | WF-005 | I |
| `platform-server/src/main/java/com/project/platform/server/security/SecurityProperties.java` | 首次人员bootstrap及外置CONNECT账号/命名空间/actions/人员role | record访问器 | 不提交密码；后续不覆盖DB人员修改 | SEC-001 | I |
| `platform-server/src/main/java/com/project/platform/server/security/IdentityDirectory.java` | sec_user认证/两角色管理/改密；外部机器身份 | loadUserByUsername/actor/profile/list/create/update/changePassword/resetPassword | DB人员事实源；认证返回独立对象以免凭据清除污染机器账号 | SEC-001 | I/UI-10 |
| `platform-server/src/main/java/com/project/platform/server/security/SecurityConfiguration.java` | HTTP Basic与无会话安全链，Flyway后初始化身份 | apiSecurity/identityDirectory | 无SSO/复杂IAM；GET health只返回DB状态 | SEC-001 | I |
| `platform-server/src/main/java/com/project/platform/server/api/FlowController.java` | 定义/版本/编辑HTTP适配 | save/get/revisions/rollback/list/schema/validate/preview/export/importFlows | 不直接访问任何Repository或表 | WF-003、WF-015、WF-016 | I/C/A/FlowManagementTest |
| `platform-server/src/main/java/com/project/platform/server/api/ExecutionController.java` | 执行HTTP适配与返回View | submit/get/list/tasks/attempts/logs/cancel | 202在提交/取消事务完成后；不泄露内部定义快照 | WF-004、WF-006 | I/C/A |
| `platform-server/src/main/java/com/project/platform/server/api/ApiExceptionHandler.java` | 领域和请求错误HTTP映射 | workflow/forbidden/malformed | 400/403/404/409/422；基础设施错误不改业务状态 | SEC-001、WF-004 | I |
| `workflow-runtime/src/main/java/com/project/platform/runtime/package-info.java` | 根包职责声明 | 无 | 无 | FND-001 | 结构检查 |
| `platform-foundation/src/main/java/com/project/platform/foundation/package-info.java` | 根包职责声明 | 无 | 无 | FND-001 | 结构检查 |
| `platform-resource/src/main/java/com/project/platform/resource/package-info.java` | 根包职责声明 | 无 | 无 | FND-001 | 结构检查 |
| `platform-deployment/src/main/java/com/project/platform/deployment/package-info.java` | 根包职责声明 | 无 | 无 | FND-001 | 结构检查 |
| `platform-offloading/src/main/java/com/project/platform/offloading/package-info.java` | 根包职责声明 | 无 | 无 | FND-001 | 结构检查 |
| `platform-edge/src/main/java/com/project/platform/edge/package-info.java` | 根包职责声明 | 无 | 无 | FND-001 | 结构检查 |
| `platform-dataflow/src/main/java/com/project/platform/dataflow/package-info.java` | 根包职责声明 | 无 | 无 | FND-001 | 结构检查 |
| `platform-server/src/main/java/com/project/platform/server/package-info.java` | 根包职责声明 | 无 | 无 | FND-001 | 结构检查 |
| `workflow-runtime/src/main/java/com/project/platform/runtime/persistence/JdbcScheduleStore.java` | 持久Schedule载荷和游标 | configure/peek/lockDue/advance | 调用者持Flow锁；游标与执行同事务 | WF-011 | I |
| `workflow-runtime/src/main/java/com/project/platform/runtime/scheduler/ScheduleCalculator.java` | 六字段Cron/ZoneId校验和下一时间 | validate/next | 复用Spring CronExpression，无运行状态 | WF-011 | T/I |
| `workflow-runtime/src/main/java/com/project/platform/runtime/scheduler/SchedulerEngine.java` | 到期点通过统一ExecutionService提交 | configure/runOnce | Flow→Schedule锁；提交和游标原子推进 | WF-010、WF-011 | I |
| `platform-server/src/main/java/com/project/platform/server/configuration/SchedulerPump.java` | 可关闭的有限批次定时轮询 | poll | 每次触发独立事务；故障保留游标重试 | WF-011 | I |
| `platform-resource/src/main/java/com/project/platform/resource/catalog/ResourceCatalog.java` | 集群、数据集版本/位置、候选请求与结果记录 | 嵌套record及Kind | 不可变请求/响应值；版本指注册描述，不保证对象内容未变 | RES-001、RES-002 | I/C |
| `platform-resource/src/main/java/com/project/platform/resource/catalog/ResourceException.java` | 资源域非法请求、未找到与冲突异常 | invalid/missing/conflict | 无运行状态依赖；HTTP统一映射 | RES-001 | I |
| `platform-resource/src/main/java/com/project/platform/resource/catalog/JdbcResourceRepository.java` | 仅res_*目录表持久化 | putCluster/cluster/clusters/dataset/datasets/register | 版本和位置同事务；唯一键冲突后读已提交版本判断相同注册或冲突 | RES-001 | I/A |
| `platform-resource/src/main/java/com/project/platform/resource/catalog/ResourceCatalogService.java` | 资源目录公开门面与候选本地性检查 | putCluster/registerDataset/placementOptions及查询 | READ/WRITE授权；校验URI、同namespace位置与版本；预览不预约 | RES-001、RES-002、SEC-001 | I |
| `platform-server/src/main/java/com/project/platform/server/api/ResourceController.java` | 7个资源HTTP操作 | 集群/数据集版本读写、列表、placementOptions | Principal映射身份；仅调用资源公开门面，不读取Repository | RES-001、RES-002 | I/C/A |
| `platform-deployment/src/main/java/com/project/platform/deployment/application/ApplicationVersion.java` | 应用版本及Parameter/DatasetRule/DatasetRef契约记录 | 嵌套record、DatasetRef.key | 不可覆盖描述；数据集值为明确id/version | DEP-001 | I/C |
| `platform-deployment/src/main/java/com/project/platform/deployment/application/ApplicationContractValidator.java` | 标量规范化、默认值/choices/数据集声明和镜像引用校验 | normalize/parameters/identifier/token | 目录注册与常驻部署参数消费者；不派生Flow，不探测镜像 | DEP-001 | I |
| `platform-deployment/src/main/java/com/project/platform/deployment/application/ApplicationException.java` | 应用域校验/冲突/未找到错误 | invalid/missing/conflict | 领域错误映射422/409/404，不依赖runtime | DEP-001 | I |
| `platform-deployment/src/main/java/com/project/platform/deployment/application/JdbcApplicationRepository.java` | 仅dep_application_version持久化 | register/get/list | 单行原子插入；冲突后读原版本判断相同或409 | DEP-001 | I/A |
| `platform-deployment/src/main/java/com/project/platform/deployment/application/ApplicationCatalogService.java` | 应用目录公开门面 | register/get/list | READ/WRITE授权；通过资源公开接口检查数据集版本/格式 | DEP-001、SEC-001 | I |
| `platform-server/src/main/java/com/project/platform/server/api/ApplicationController.java` | 应用版本注册/查询/分页3个HTTP操作 | register/get/list | 只访问ApplicationCatalogService | DEP-001 | I/C/A |

| `platform-deployment/src/main/java/com/project/platform/deployment/distribution/SkopeoImageClient.java` | 委托Skopeo解析/复制并验证镜像digest | digest/copy | 有界外部进程；认证使用外置authfile；不访问执行表 | DEP-002 | ImageDistributionTest |
| `platform-deployment/src/main/java/com/project/platform/deployment/distribution/ImageDistributionService.java` | 显式按目标集群准备应用镜像 | prepare | READ/WRITE及源/目标白名单；实际返回固定digest镜像；不创建Execution | DEP-002 | ImageDistributionTest |
| `platform-server/src/main/java/com/project/platform/server/configuration/DistributionConfiguration.java` | Skopeo/Registry/目标配置与装配 | Settings/RegistrySettings/Bean | 仅管理员外部配置地址、TLS、authfile及目标映射 | DEP-002 | ImageDistributionTest |
| `platform-server/src/main/java/com/project/platform/server/api/ImageDistributionController.java` | 镜像准备HTTP入口 | prepare | Principal→deployment公开门面，失败不返回准备成功 | DEP-002 | ImageDistributionTest/C |

## 表与事务所有权

| 实际生产文件（S4-02c新增） | 职责与消费者 | 状态所有权 | 测试 |
|---|---|---|---|
| `platform-resource/src/main/java/com/project/platform/resource/kubernetes/KubernetesConnections.java` | 按平台namespace/cluster显式打开配置的Kubernetes连接 | 外部kubeconfig，不读取默认开发者context | ImageDistributionTest |
| `platform-deployment/src/main/java/com/project/platform/deployment/service/DeploymentService.java` | 契约参数校验、配置回读、CAS创建/更新/缩放/删除；保留非托管配置，记录操作身份及计时起点 | Kubernetes为唯一期望/实际状态源；数据库只存操作证据 | ImageDistributionTest |
| `platform-server/src/main/java/com/project/platform/server/configuration/KubernetesConfiguration.java` | 外部连接配置与部署装配 | 不增加业务状态 | ImageDistributionTest |
| `platform-server/src/main/java/com/project/platform/server/api/DeploymentController.java` | 4个常驻部署HTTP操作 | 身份→deployment门面；不写运行表 | ImageDistributionTest/C |

- dataflow：[V2__flow_revisions.sql](../platform-dataflow/src/main/resources/db/migration/dataflow/V2__flow_revisions.sql)，wf_flow_head、wf_flow_revision。
- runtime：[V1__runtime.sql](../workflow-runtime/src/main/resources/db/migration/runtime/V1__runtime.sql)，wf_execution、wf_task_run、wf_task_attempt、wf_message、wf_log。
- 同一个数据库和事务管理器，不代表可跨模块读写表。server配置提供DataSource，但HTTP层不能直接操作存储。
- runtime：[V3__worker_lifecycle.sql](../workflow-runtime/src/main/resources/db/migration/runtime/V3__worker_lifecycle.sql)，增加wf_worker_job、消息唤醒时间、重试时间及阶段/主结果/清理错误。执行租约使用数据库时钟。
- dataflow：[V4__remove_unused_revision_checksum.sql](../platform-dataflow/src/main/resources/db/migration/dataflow/V4__remove_unused_revision_checksum.sql)，删除无行为消费者的checksum；真实幂等request_hash不删除。
- runtime：[V5__control_flow_and_scheduling.sql](../workflow-runtime/src/main/resources/db/migration/runtime/V5__control_flow_and_scheduling.sql)，新增wf_flow_control、wf_schedule和FIFO sequence_no，删除next_task。
- resource：[V6__resource_catalog.sql](../platform-resource/src/main/resources/db/migration/resource/V6__resource_catalog.sql)，res_cluster、res_dataset_version、res_dataset_location。外键限制同命名空间的集群/版本引用；仅资源模块读写。
- deployment：[V7__application_contract.sql](../platform-deployment/src/main/resources/db/migration/deployment/V7__application_contract.sql)，dep_application_version。数据集引用仅经资源API验证，不跨模块读表或建跨域外键；当前资源版本不可删除。
- 当前共22张业务表；V14终端FIFO、V15画像/模型见上节。V12增加Flow head管理范围，V13增加edge四表。V10新增TaskRun轮次/所属Repeat字段；V8修改Worker停止/计划字段，V9增加resource预约表。Executor派发Job与开始Attempt同事务；Worker短事务领取、事务外运行、结果持久化；Executor归并结果/日志/运行状态/续消息同事务。Worker不能直接修改Execution/TaskRun/Attempt。
- S4-02a历史批次只装配应用目录；应用JSON使用父BOM的Jackson，deployment不依赖runtime JsonCodec。自动派生服务及两个API已撤销，BindingResolver.prepare恢复原实现。S4-03在真实Task消费者接入显式Binding及Job，不恢复派生链；字段消费者见[Job协议](contracts/s4-job-execution.md)。
- 资源目录链：HTTP → ResourceCatalogService → JdbcResourceRepository。候选预览不创建Execution、预约或Job；真实执行消费者另外调用JobPlacementService和ObjectStorage。JobConfiguration装配适配器与运行时执行边界；Executor仍独占运行状态。
- S1/S2活动执行必须排空后停机升级，不提供混版本执行兼容。叶子语义见[S2协议](contracts/s2-protocol.md)，控制树/准入/触发/锁顺序见[S3协议](contracts/s3-protocol.md)。

## S4通用任务实现

| Java 文件路径（相对 backend） | 职责 | 关键接口 | 状态/事务 | 功能 | 验证入口 |
|---|---|---|---|---|---|
| `workflow-runtime/src/main/java/com/project/platform/runtime/worker/CommonTaskRunner.java` | HTTP GET/POST和只读SQL、限时/限量/连接边界 | run；HttpConnection/SqlConnection | Worker结果，POST开始标记用既有prepared_json；不新建表 | WF-012 | CommonTaskTest/C |

## 测试入口

- UI-08：[KubernetesUsageTest](../platform-server/src/test/java/com/project/platform/server/KubernetesUsageTest.java)验证真实单位、分母、有效期和缺样语义；ImageDistributionTest增加镜像导入/历史/部署观察/近期Metrics API。测试辅助SkopeoTestBridge仅负责Windows测试归档转发到隔离Linux Skopeo，不进入生产类路径或Runner。

- [FlowManagementTest](../platform-server/src/test/java/com/project/platform/server/FlowManagementTest.java)：11项真实MySQL/HTTP编辑Schema、无副作用预览、导出再导入运行、原子批次、反序并发CAS、权限/范围/搜索及全部示例格式往返。

- [OffloadingTest](../platform-server/src/test/java/com/project/platform/server/OffloadingTest.java)：10项真实MySQL/HTTP模型、权限、画像、反馈和终端FIFO并发测试。真实三位置训练/模型执行在ImageDistributionTest中，完整结果以最新验证记录为准；以下旧批次计数是历史入口说明。

- [EdgeAccessTest](../platform-server/src/test/java/com/project/platform/server/EdgeAccessTest.java)：16项真实MySQL/HTTP接入、多节点、管理隔离、权限归属、幂等、事务回滚及进程上下文重启测试；不是物理网关/终端网络验收。

- D：[DefinitionTest](../workflow-runtime/src/test/java/com/project/platform/runtime/definition/DefinitionTest.java)，14项模型/类型/绑定/模板测试。
- I：[DurableWorkflowTest](../platform-server/src/test/java/com/project/platform/server/DurableWorkflowTest.java)，72项真实MySQL/HTTP/并发/故障/重启测试：原63项、7项应用目录测试、2项方向修正回归（已撤销接口404、应用登记不改Flow输入/定义/执行结果）。移除8项自动派生测试，保留并改写目录示例和HTTP测试。
- L：[LifecycleTest](../workflow-runtime/src/test/java/com/project/platform/runtime/definition/LifecycleTest.java)，3项时长/重试校验、跨阶段定义约束、纯决策测试。
- C：[ContractTest](../platform-server/src/test/java/com/project/platform/server/ContractTest.java)，3项路由/record字段与引用/示例防漂移检查，不等同完整OpenAPI规范验证器。
- A：[ArchitectureTest](../platform-server/src/test/java/com/project/platform/server/ArchitectureTest.java)，1项包含多条依赖约束的架构测试。

- T：[ControlFlowTest](../workflow-runtime/src/test/java/com/project/platform/runtime/definition/ControlFlowTest.java)，9项控制定义/拓扑/分支/额度/Cron/时区DST及Repeat作用域测试。

- [ImageDistributionTest](../platform-server/src/test/java/com/project/platform/server/ImageDistributionTest.java)：20项独立真实Registry/Skopeo/MySQL/K3s/MinIO验证，覆盖镜像分发与常驻部署、Application Job、数据集/命名产物、平台槽并发、取消/超时、同Job接管、Python执行及Worker JVM强杀/DB短时故障；S5包含两轮真实文件反馈与评估屏障，以及FedAvg/FedProx真实MNIST训练、聚合和全局评估。

- [CommonTaskTest](../platform-server/src/test/java/com/project/platform/server/CommonTaskTest.java)：6项真实HTTP/MySQL通用任务测试。
- [DeploymentSmokeIT](../platform-server/src/test/java/com/project/platform/server/DeploymentSmokeIT.java)：Failsafe在package后启动实际JAR，空库迁移/认证/提交执行；不是测试类路径启动。

## 后续实现位置规划

此表描述包边界，不预先创建空类。每次真正增加 Java 类，必须在上表登记实际路径、职责、关键接口、状态所有权和测试入口。大型模块可拆出明细文件，但本页保留统一入口。

| 模块 | 计划内部包 | 主要实现阶段 |
|---|---|---|
| workflow-runtime | model、definition、executor、scheduler、worker、persistence已实现；不预建port/spi/runner空包 | S1–S4 |
| platform-dataflow | definition、execution、query、metrics | S1–S4 |
| platform-resource | catalog、kubernetes、storage、placement已实现；预约归placement，不重复创建reservation层 | S4 |
| platform-deployment | application、contract、registry、distribution、deployment | S4 |
| platform-edge | gateway、terminal、policy、delivery | S5 |
| platform-offloading | eligibility、decision、profile、feedback | S5 |
| platform-foundation | identity、authorization、configuration | S1 起按需求增加 |
| platform-server | api、bootstrap、configuration | S1 起按需求增加 |

S1–S3模型采用record及嵌套record，不是每个领域名都拆成独立文件。ExecutionReducer已有真实调用者；WorkerCoordinator、通用插件SPI尚未创建。未来接口按消费者与验收需求设计，不机械复制旧版181文件清单。

## 自动检查的边界

[check-scaffold.ps1](../scripts/check-scaffold.ps1) 检查 POM 与文档模块集合、依赖白名单/环、生产 Java 索引、功能编号及本地文档链接。它不能替代 Java 语义测试、真实数据库并发测试或类级依赖测试。
S5-01没有新增生产Java文件。FlowDefinition新增Repeat嵌套record；FlowValidator、FlowExecutor、JdbcExecutionStore与ExecutionRecord承担定义、屏障推进、轮次持久化和查询字段。详见[Repeat协议](contracts/s5-repeat.md)。
