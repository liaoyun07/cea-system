# UI-08 核心镜像、部署与资源用量验证

实现验证日期：2026-09-12（Asia/Shanghai）。源码基线：main `2a64c48fedb6ab79b3c48838245815579289ce37` + UI-08修改，最终功能提交`63fda36c64b5edb9c566af0edff34088bdc29629`。实现阶段不发布CEA；用户随后于2026-09-13授权“部署”，实际发布见末节，不改已保存Flow/执行/旧系统。

## 环境与参考

- Windows、JDK21（ms-21.0.12.1）、Node24、Maven、Docker Desktop；真实隔离MySQL、K3s1.30、Registry、MinIO、Skopeo。测试自行创建/清理容器和网络，不复用CEA业务数据库或算法集群。
- 指标采集使用Metrics Server v0.7.2。官方registry.k8s.io拉取遇到EOF/超时，改用[Rancher官方镜像映射](https://github.com/rancher/artifact-mirror/blob/master/config.yaml)的`rancher/mirrored-metrics-server:v0.7.2`，核对程序`--version`为v0.7.2。通过临时Skopeo下载并导入宿主缓存，下载容器已经删除；测试再导入各自的临时K3s，未安装到CEA。
- 清单来自[上游v0.7.2](https://github.com/kubernetes-sigs/metrics-server/releases/download/v0.7.2/components.yaml)，仅替换官方映射镜像并为本地自签Kubelet增加insecure-tls。真实外部集群不能原样沿用此TLS设置。
- 部署完成条件依据[Kubernetes Deployment](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#complete-deployment)，本批不改变Kestra参考的Flow/Execution模型或调用链。

## 覆盖内容

1. 实际Docker save文件经multipart上传、Skopeo导入Registry并验证digest，再登记原ApplicationVersion。无效归档不登记，已有版本409、只读用户403，成功/失败暂存文件清理；没有执行上传镜像。测试桥只解决Windows路径进入Linux测试Skopeo容器，不是生产Runner。
2. 原prepare/prepareForExecution公共分发路径记录实际成功/失败、发起人、源/目标引用、时间；授权分页与命名空间隔离。不能把层复用等同于完整镜像字节传输。
3. 实际HTTP readiness Deployment就绪、配置回读/编辑/乐观锁冲突、保留操作员添加的环境变量/注解/资源限额；仅副本变更不再次分发。缺省replicas拒绝，no-op不生成新测量，纯版本注解修改不计作部署，缩到0成功但无有效耗时。
4. 部署观察使用同UID/generation。未确认超期、重建/替代、观测间隔中断不产生有效耗时。观察器不提交或重放工作负载。
5. 真实Metrics API节点和配置namespace容器用量；cores/working-set换算、capacity/limit分母、零值、缺失、过期、未来采样与权限边界。窗口返回ISO-8601时长，不是Java对象调试字符串。
6. Vue接通上述真实接口；桌面及650px窄屏、表格横向滚动、上传失败和成功、部署历史、只读用量。保留原No-code、Execution、产物和Metrics页面回归。

## 执行记录

- 初次定向回归7项有1项409：测试在模拟外部操作员触发滚动后立即使用旧resourceVersion；补等待同代滚动完成，不放宽生产CAS。重跑该部署编辑/缩放测试通过。
- 第二次定向回归6项有1项外部镜像拉取失败；部署、契约和用量换算测试通过。按上面的官方镜像映射解决下载问题，没有跳过Metrics API验收。
- 第一轮完整Maven于21:33:18结束：已执行225项，224通过、1错误，Failsafe未进入。唯一错误是Java测试K3s自带Metrics Server与本批清单的server-side apply字段所有权冲突；FedAvg/FedProx真实训练、聚合和评估均通过。修正测试启动参数：保留Testcontainers原命令并追加`--disable=metrics-server`，与CEA和浏览器夹具一致；不使用force-conflicts覆盖另一控制器，也不关闭指标测试。
- 第一轮完整浏览器：47/47通过（2.5分钟），真实JAR/Registry/K3s/API，无业务Mock。
- 视觉复核发现表格列挤压和采样窗口对象字符串，修正限定表格宽度/横向滚动及窗口序列化，增加窗口断言；最终完整回归结果待记录。
- 修改后Node单测45/45、Vite构建、Prettier检查通过。
- 定向测试启动命令一度因PowerShell拆分未引用的`-Dsurefire.failIfNoSpecifiedTests=false`参数而未进入测试；引用完整参数后重跑，未修改验收标准。
- 最终定向回归：ContractTest 3、KubernetesUsageTest 1、ImageDistributionTest 3，共7项通过；其中实际Metrics API、纯注解版本变更和缺省replicas HTTP拒绝均通过。随后重新package成功，开始最终Maven和浏览器全量回归。
- 第二轮浏览器47/47通过（2.5分钟），已包含窗口格式和表格修正。字段审查发现历史表单列digest无独立消费者、与target_image引用重复；按AGENTS约束删除该尚未发布的字段/API属性，Registry摘要核验不变。停止仅本次Maven/Surefire测试进程，重新package及完整verify，未停止CEA服务；被中止的第二轮Maven不计通过。
- `docker compose ... config --quiet`通过；临时Nginx容器挂载新配置执行`nginx -t`通过，临时容器自动删除。未执行CEA发布脚本或apply。
- 独立构建`cea-backend:ui08-verify-20260912`通过，未替换CEA现有标签/容器。以镜像默认用户、无网络临时运行`id`及两个上传目录的`test -w`，UID/GID均10001，两个目录可写，退出码0；临时容器自动删除。镜像配置ID为`sha256:df35612b6636d50dbfe10a5b6690d4f27132e683394c30a0334f001d9170ea15`；这是镜像构建/文件权限验证，不是业务部署。

最终结果：21:54:30完整Maven verify通过，227项（runtime35、server191、实际JAR Failsafe1），失败/错误/跳过均0。ImageDistributionTest的42项含实际FedAvg/FedProx和数据库短时中断恢复全部通过；最终打包JAR空库迁移/认证/提交执行通过。此前负向升级拒绝和主动数据库中断的ERROR日志不是被忽略的测试失败。

最终浏览器于21:45完成，47/47通过（2.4分钟），使用21:41:32重新构建的最终JAR；桌面与650px截图复核通过。45项Node、构建、格式检查及scaffold通过（8模块、93个Java、32功能编号；链接数随后文档收尾增长）。没有旧系统或CEA发布动作。

本地证据（均在Git忽略目录）：`.local/ui08/verify.log`、`verify-final2.log`、`final-focused.log`、`frontend/.local/evidence/ui08-e2e-final2.log`、`operations-upload-history.png`、`operations-deployment-narrow.png`、`operations-node-usage.png`。不提交归档、凭据、构建文件或临时运行日志。

## 架构变化与未验收项

新增4个生产Java类、7个HTTP操作、V18/V19两张操作记录表；93个生产Java、64个HTTP操作、77个公开record映射、25张业务表。字段消费者见[协议](../contracts/ui08-deployment-operations.md)，文件职责见[架构索引](../01-code-architecture.md)。不增加SPI、调度器、第二套Execution/Worker/Binding。

这是核心功能验证，不是申报书30秒部署或系统开销的正式性能验收。部署耗时包含本次镜像准备至同代全部副本就绪；本地镜像缓存、单机网络和正常轮询时延必须说明，不能拿小型测试容器推断所有算法均达标。CPU/内存为近期资源用量，不是平台自身开销结论。

实现阶段未做CEA发布（后续发布见下节）。仍未做：物理多云基准、最大2GiB上传压力测试、崩溃残留文件/Registry未引用tag自动GC、容器日志、数据文件上传、HPA、历史监控、告警、DQN和数据处理速率。Registry与MySQL跨系统登记失败可能保留未引用tag，接口失败需查询版本状态，不自动重传覆盖。

## CEA发布（2026-09-13，用户已授权）

1. 发布前读取实际业务和容器快照：FedAvg r5、FedProx r3；4条Execution（2成功、1失败、1取消）、38个TaskRun及其Attempt均为终态，待处理wf_message为0，无活动afterExecution。专用MySQL以single-transaction导出153436字节，确认正常结束；配置、原RBAC和业务快照保留在D盘忽略目录`.local/ui08-release-20260913/`，原镜像保存为`cea/backend:before-ui08-20260913`及`cea/frontend:before-ui08-20260913`。D盘剩余约450GiB。数据库备份未做独立恢复演练，不宣称已验收自动回滚。
2. 复用已验收JAR，重新运行45项Node测试和Vite构建PASS，Compose构建前后端成功。前端资源为`index-CE2zMEwx.js`、`index-D_YoeK1G.css`。未重新构建或推送算法镜像，未重新执行完整227项Maven/47项隔离浏览器；它们是前一实现批次结果。
3. 确认四集群均无清单中的Metrics Server资源，备份并比较原RBAC与UI-07一致，用resourceVersion/rules前置检查只替换既有Role/ClusterRole规则。导入缓存的Rancher v0.7.2镜像并安装采集器，各Deployment 1/1就绪、APIService Available=True。实际验证后端SA允许节点用量及cea-lab Pod用量读取，拒绝default Pod用量、指标写入、Namespace list及Service create。没有重建后端SA/Secret、重启K3s或放宽到其他命名空间。
4. 02:50执行`compose up -d --no-deps --wait backend frontend`，仅替换这两个容器；后端02:50:39成功校验19项迁移并从V17升级至V19。新增两张记录表均为空，不回填旧历史。`cea_upload-scratch`卷创建，实际后端UID/GID10001可写multipart/import目录。前后端健康检查通过，Nginx重新加载；没有重置数据库、MinIO或Registry。
5. 运行镜像ID：后端`sha256:4891bbaeeee1ae42e388b875c70ae9218ca01313588d8cb4fc1232907498cb4f`，前端`sha256:2f7c9bce2125ba041bbcb97ec58aeb2a03f3e2eacf3cea746c7746fdea373c73`。它们为本机Docker实际容器Image字段，不将构建manifest/config摘要混写成同一个标识。
6. 02:51原上线脚本PASS。扩充UI-08只读检查后，首次因在应用详情尚未返回列表就点击上传按钮而超时；只修正验证脚本导航，未改业务代码。02:53:34完整重跑PASS：四集群节点采样AVAILABLE且CPU/内存为真实数值，容器用量严格cea-lab范围；5个应用的分发历史可查为空，上传表单可见；原管理页、总览、两联邦Flow编排、拓扑、历史产物与两轮Metrics一致，桌面/窄屏检查通过，无pageerror。
7. 当前业务Pod已全部结束，没有近期容器样本，API和页面正确显示MISSING/空值，不补0或推算历史用量。四个K3s共用Docker宿主，节点用量反映同一Linux主机视角，不能四者相加冒充独立物理多云资源。
8. 发布前后深比较PASS：所有Flow及修订、Execution、TaskRun与Attempt不变，其余10个CEA容器ID/StartedAt/Image完全相同。四集群cea-lab原Job/Pod/Deployment的UID/spec/status集合分别22/9/9/9项完全保留。仅新增kube-system采集器；临时导入tar和容器内SQL备份副本已清理，D盘原始归档和SQL备份保留。旧Harbor/Kestra及旧系统未操作。

本次不向CEA新增测试应用、镜像上传、按需分发、常驻部署或训练。上述写操作核心闭环已在实现阶段的真实隔离集成测试验证；上线验证覆盖实际部署、配置/权限、采集器、读取和页面，不据此声称生产首次上传/扩缩容或30秒指标已实测达标。

本地证据：`.local/UI08-deploy-baseline.json`、`UI08-deploy-after.json`；`.local/ui08-release-20260913/`内数据库/配置/RBAC备份、构建和rollout日志、浏览器失败及最终日志、workload-preservation.json；`.local/cea/browser/result.json`及usage/upload-form/distribution-history截图。运行数据、凭据和备份均不提交Git。发布只新增验证脚本覆盖及文档，不增加Java类、字段、表、API或SPI（V18/V19为已提交功能的首次应用），Execution主链和Kestra参考语义不涉及变更。

回退注意：前端可使用保留镜像；后端已经应用V18/V19，不能把“重打旧标签”当已验证数据库回退。需要停止新增提交、备份发布后新记录、检查旧程序与schema的兼容性后决定回退方案；未授权不自动restore、删除新表或repair Flyway。

## UI-08a：删除容器用量页面（2026-09-13）

用户要求“直接删了就行”。基线7f114f6；只移除KubernetesResourcesPage.vue的容器用量标签、表格、空态、样式及请求分支，保留节点用量和其余两类资源。更新真实浏览器和上线检查：剩余三标签、节点采样和刷新仍可用、前端不发usage/pods请求，桌面/窄屏无溢出。示例操作文档改为查看节点整体用量，不冒充单容器用量。没有新的页面入口、提示、平台Java/表/API/SPI或执行链变更，不涉及Kestra执行语义；后端Pod API、RBAC与采集器保留。

45项Node、47项完整真实浏览器（2.5分钟）、Vite构建和Prettier检查通过；静态资产index-D-4VlOJj.js、index-DO-puOAs.css。scaffold通过（8模块、93个Java、32功能编号、500链接），git diff --check通过。没有重新执行Maven或声称后端重新验收。

用户确认“更新CEA前端”后，发布前深比较Flow/修订、Execution、TaskRun与Attempt及12个容器均未变化、无活动执行；保留实际原前端镜像为`cea/frontend:before-ui08a-20260913`。只构建frontend，并于03:18执行`compose up -d --no-deps --wait --wait-timeout 120 frontend`，新容器健康。实际容器Image为`sha256:7a8972bf6c376f940f0ce8b79a8defa6d6023bd323d0ee2146c26411a8d9bb3a`，StartedAt为`2026-09-12T19:18:53.232796382Z`。

03:20:33实际18080完整只读浏览器复核PASS：四集群节点近期采样AVAILABLE，剩余三个标签与API对应，页面没有usage/pods请求或pageerror，桌面和650px视觉检查通过；原No-code/SELECT/管理页/历史指标与输出检查仍通过。发布后深比较PASS：仅frontend ID/Image更换，其余11个容器ID/StartedAt/Image不变；FedAvg r5、FedProx r3及历史、4条Execution、38个TaskRun及Attempt完全保留。未修改保存流程、部署配置、数据库或集群，没有运行新的算法任务，也未操作旧系统。

本地证据（均不提交Git）：`frontend/.local/evidence/ui08a-e2e.log`、`operations-node-only-narrow.png`；`.local/UI08a-deploy-baseline.json`、`UI08a-deploy-after.json`、`ui08a-deploy-build.log`、`ui08a-deploy-rollout.log`、`ui08a-deploy-browser.log`；`.local/cea/browser/result.json`及`usage-cloud.png`、`usage-narrow.png`。保留原前端镜像可回退；本批只删除前端代码，可从Git恢复，不删除业务数据。
