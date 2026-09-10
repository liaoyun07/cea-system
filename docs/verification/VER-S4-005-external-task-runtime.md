# VER-S4-005 外部任务执行与S4收尾

日期2026-09-10；基线Git `fd285e9a9101f44ec879c729500f112a3cca6953` 加本批源码、测试及文档；发布提交包含本记录，可从Git追溯。范围S4-03/04/05及S1–S4回归，不进入S5。

## 最终验证

统一 `scripts/verify.ps1` 于 **2026-09-10 13:07:08 +08:00** 结束，BUILD SUCCESS。123项，0失败、0错误、0跳过；包含最后的HTTP路径边界修正。之后只更新文档，不修改生产代码和测试。收尾结构检查通过：8模块、70份Java索引、30功能编号、219个本地链接；git diff --check通过。隔离测试容器及本批测试JVM已退出。

命令：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1 -JavaHome 'D:\IDE\IntelliJ IDEA 2025.1.3\jbr' -MavenCommand 'D:\developevn\maven\bin\mvn.cmd'`。

| 测试类 | 数量 | 内容 |
|---|---:|---|
| DefinitionTest | 14 | 定义、显式Application绑定、输出引用可达性、HTTP/SQL范围 |
| LifecycleTest | 3 | 生命周期基础 |
| ControlFlowTest | 6 | 通用控制流定义 |
| DurableWorkflowTest | 72 | 真实MySQL执行/恢复/控制/调度/目录回归 |
| ImageDistributionTest | 17 | 真实Registry、Kubernetes、MinIO、镜像部署、Job与故障 |
| CommonTaskTest | 6 | 真实HTTP/SQL成功、错误、超时、认证、参数与POST未知结果 |
| ContractTest | 3 | 27个操作、33个record映射与示例 |
| ArchitectureTest | 1 | 类级模块依赖 |
| DeploymentSmokeIT | 1 | package后的实际JAR、空库迁移、401、保存/提交/结果 |
| 合计 | 123 | Surefire 122 + Failsafe 1；0失败/错误/跳过 |

环境：Windows11，JDK21.0.7，Maven3.8.8，Docker Desktop29.5.3。隔离MySQL8.0、两个认证Registry2、Skopeo1.20.0、K3s v1.30.6-k3s1、真实MinIO RELEASE.2025-04-22T22-12-26Z；实际Alpine和Python3.11容器。没有以mock Kubernetes、伪S3或固定成功结果代替执行。

## 本批新增真实验收

1. Application显式参数解析与默认值；数据集下载到Pod，命名输出上传真实MinIO，下游下载并核验实际内容；镜像按digest固定，Pod不持有存储密钥。
2. 缺少声明输出明确失败；取消/超时等待远端Pod停止，再释放预约、完成Attempt和运行Finally。
3. 两个并发预约者争用一个平台槽，只有一个获准；释放后另一个可获准；无本地数据拒绝，取消先到的释放记录阻止迟到预约。
4. Worker对象重建和独立Worker JVM强杀后接管同Job UID、同Attempt；没有把连接恢复当作新的业务重试。
5. 暂停隔离MySQL约4.5秒，恢复后归并已接受任务，保持同Job/Attempt。故障过程中通信异常属于注入证据，不伪造成功。
6. Python在真实Pod内计算并发布结果6；宿主不执行用户Python/Shell。
7. HTTP带配置认证读取真实响应，验证503、超限、未配置目标、相似路径前缀/编码父目录拒绝；合法base路径可用。POST正常发送一次，超时/接管未知结果不自动重发。
8. MySQL只读业务账号、真实PreparedStatement参数/NULL/结果，错误和超时不输出伪数据；定义层拒绝写SQL、多语句和POST retry。
9. 使用打包后的可执行JAR启动独立进程及新空库，匿名请求401，授权保存/提交后获得真实Log结果；不是Spring测试切片或测试类路径替代部署。
10. Registry认证、namespace内Kubernetes Role、跨namespace拒绝继续回归；S4新增nodes list用于健康观测，不允许管理节点。

## 过程中的失败与修正

- Fabric8文件上传发现commons-compress版本冲突/可选依赖未显式进入生产：锁定1.28.0并加入runtime实际依赖；真实传输回归通过。
- 远端缺输出的停止等待与恢复标记不足：持久停止原因、缩短Pod终止宽限并等待确认，旧Worker的停止写入受owner/epoch租约约束。
- 既有迁移测试预期7个版本，新增V8/V9后修正为9；未跳过迁移测试。
- 首轮JAR验收遇到Windows日志删除占用；保留日志到忽略的target/deployment-evidence，仍严格停止自身子进程。独立JAR重跑通过，再运行完整验证。
- 首次真实MinIO镜像拉取出现EOF，重试成功；没有用旧工程的轻量S3替代。
- HTTP路径审查发现同前缀/编码父目录边界，修正并增加实际请求链拒绝测试，最终统一验证包含该版本。
- 13:02:22的一轮123项已通过；之后的HTTP边界修正以本记录上方最终复验为准。Flyway保护的预期ERROR与DB故障注入WARN，不等于被忽略的测试失败。

## 代码与状态所有权

新增8份生产Java：TaskRunner、TaskContext、KubernetesJobRunner、CommonTaskRunner、ApplicationTaskRunner、JobPlacementService、ObjectStorage、JobConfiguration。全部路径和职责见[代码索引](../01-code-architecture.md)。

新增Flow内Container/Http/Sql配置record；仍消费既有四种Binding，不自动派生Flow Input、不创建第二套alias/binding。没有新HTTP API。新增resource预约表res_job_reservation；Worker传输新增cancel_reason/prepared_json，实际消费者见[Job协议](../contracts/s4-job-execution.md)。当前70份生产Java、15张业务表、V1–V9；没有无消费者hash/字段/空SPI。

主链仍是Executor派发→Worker持久租约→实际Runner→持久结果→Executor归并。Application取消增加远端停止确认，不创建第二套状态机。Kestra职责来源及阶段简化见[ADR-0009](../decisions/ADR-0009-s4-job-execution.md)、[ADR-0010](../decisions/ADR-0010-s4-common-tasks.md)。

## 明确未覆盖/未实现

- 单机隔离集群测试，不是实际跨地域多云性能/容灾验收；无永久节点丢失、强删Job/Pod后的通用exactly-once保证。
- 平台Job槽不代表CPU/内存物理预约；Ready节点检查不是完整Prometheus利用率体系。
- SQL仅只读SELECT，HTTP仅GET/POST；Linux镜像须包含sh/tar/sleep等基本命令，未支持Windows/distroless或敌对多租户安全沙箱。
- 无自动历史Job/对象清理、TLS终止、高可用或备份恢复。最小P04/P05/P06/P11在S4已验收，S7最终部署仍须复验。
- Repeat、FedAvg/FedProx迁移、终端接入/DQN、S5计量与前端No-code未实现；不把目标写成现状。
- 仅创建/销毁本批测试资源，不修改旧web-platform/amis、旧数据库、旧集群、旧镜像或启动/停止已有服务。测试日志/构建产物和临时凭据不提交Git。
