# UI-08 核心镜像、部署与资源用量验证

日期：2026-09-12（Asia/Shanghai）。源码基线：main `2a64c48fedb6ab79b3c48838245815579289ce37` + 本批UI-08修改；最终提交见Git历史。本批只实施和测试，不发布CEA，不改已保存Flow/执行/旧系统。

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

未做：CEA真实发布、物理多云基准、最大2GiB上传压力测试、崩溃残留文件/Registry未引用tag自动GC、容器日志、数据文件上传、HPA、历史监控、告警、DQN和数据处理速率。Registry与MySQL跨系统登记失败可能保留未引用tag，接口失败需查询版本状态，不自动重传覆盖。
