# CEA 独立本地部署（DEPLOY-01）

固定 Compose 项目名 `cea`。源码与配置在 D 盘 backend 仓库，Docker Desktop 数据盘必须先切到 D 盘；命名卷实际存于该 Linux VHDX，不把 MySQL/K3s 数据库直接绑定到 NTFS。启动脚本检查路径，不负责再次迁移 Docker 数据。

这是**单机上的四个独立 K3s 集群**：cloud、edge-a/b/c 各有自己的 API、状态库、containerd 和 Registry，不是四个目录项映射到同一个集群，也不是跨地域物理多云。对象存储当前为独立中央 MinIO，三个训练分片按位置登记，不宣称数据已存放在三台物理边缘设备。

不导入 web-platform 数据、旧模板或旧执行历史；不连接旧数据库/Harbor，不切换旧系统。DQN、数据处理速率、物理终端/网关代理不在本批范围。

## 第一次安装

UI-08新增上传暂存卷`cea_upload-scratch`（D盘Docker数据盘）、namespace中心Registry映射及V18/V19记录表。只构建不会发布或修改数据库；更新后端时Flyway创建新增表，不回填历史。默认上传2 GiB、导入并发2，接收和导入可能双份占盘，至少预留8 GiB暂存余量并监视D盘容量。进程崩溃残留文件/未引用镜像tag不自动GC，确认没有活动上传后才做维护清理，不删除整组数据卷。

资源用量需要显式安装[metrics-server.yaml](metrics-server.yaml)和更新[rbac.yaml](rbac.yaml)，不随后端启动安装。本地K3s1.30使用Rancher镜像的metrics-server v0.7.2，官方镜像映射见[Rancher配置](https://github.com/rancher/artifact-mirror/blob/master/config.yaml)。清单中的Kubelet insecure-tls只适用于当前本地自签环境，外部生产集群应提供受信任证书并移除此参数。不接入历史监控/HPA。

获得部署授权后，在backend根目录执行以下命令（当前代码任务未执行这些命令）：

```powershell
. .\deploy\cea\common.ps1
foreach ($taskCluster in @('cloud','edge-a','edge-b','edge-c')) {
    Get-Content -Raw .\deploy\cea\rbac.yaml | Invoke-CeaCompose exec -T $taskCluster kubectl apply -f -
    Get-Content -Raw .\deploy\cea\metrics-server.yaml | Invoke-CeaCompose exec -T $taskCluster kubectl apply -f -
    Invoke-CeaCompose exec -T $taskCluster kubectl rollout status deployment/metrics-server -n kube-system --timeout=180s
    Invoke-CeaCompose exec -T $taskCluster kubectl top nodes
}
```

这会在每个集群增加一个采集Pod，但不改变已有算法Flow；四个同宿主集群的容量/用量不可相加充当四台物理机器。页面30秒部署目标只展示有有效观测的创建/更新结果，不因安装采集器或代码测试通过就宣布达标。

UI-07只读资源页需要更新后的`rbac.yaml`：原cea-lab Role新增Service get/list，原节点观察ClusterRole新增仅名为cea-lab的Namespace get。没有Namespace list或Service写权限；既有部署须在获批发布时更新这两项授权，不需要重启K3s或执行数据库迁移。

在 backend 根目录、Docker Desktop 已运行时执行：

```powershell
.\deploy\cea\build.ps1 -JavaHome 'D:\IDE\IntelliJ IDEA 2025.1.3\jbr' -MavenCommand 'D:\developevn\maven\bin\mvn.cmd'
.\deploy\cea\initialize.ps1
.\deploy\cea\start.ps1
.\deploy\cea\seed-federated.ps1
.\deploy\cea\verify-federated.ps1 -Algorithm fedavg
.\deploy\cea\verify-federated.ps1 -Algorithm fedprox
node .\deploy\cea\verify-browser.mjs
```

build 执行完整 Maven verify、前端单测和构建，再构建两个部署镜像。需要网络下载依赖；失败即停止，不自动退回旧代码或关闭检查。

initialize 首次从 [.env.example](.env.example) 生成随机凭据，后续复用已有 .env；生成服务连接文件、Registry 认证及 pause 镜像离线包。已有凭据不自动换一套。连接配置见 [application.yaml](application.yaml)。

start 只启动/核验 cea，向四个新集群应用 [rbac.yaml](rbac.yaml)、生成最小权限连接、建立两桶及独立存储账号，再启动后端/前端。不会创建业务 Flow 或 Execution。不要修改已有 MySQL 的 .env 密码就认为数据库密码也随之更改；凭据轮换须单独操作并保持一致。

seed 是**显式首次登记**：构建新联邦镜像、7项算法单测、真实MNIST下载/完整性检查、中央镜像推送、数据上传、四个资源/两个数据集/五份契约/两份 Flow 首版。默认训练60000、测试10000。已有 fedavg/fedprox 时拒绝覆盖，后续通过修订 API/前端编辑。这里不是Java启动自动seed，也不迁移旧版本。

verify-federated 会真实提交一次两轮执行，保留失败记录；验证11个Job位于预期四集群，导出产物并独立重算训练、加权聚合和全局评估。不会把取消或缺文件算成功。verify-browser 是只读检查，不创建额外演示模板。

复核已有执行可加 `-ExecutionId <UUID>`，不再次提交训练；仅用于对应算法的两轮默认参数验收。自定义轮数/超参数需调整相应验收，不能套用本脚本宣称数值正确。

## 日常使用

- 工作台：http://127.0.0.1:18080
- API：http://127.0.0.1:18085
- 账号：`.env` 中 `BACKEND_USER`（默认 developer）；密码：`BACKEND_PASSWORD`；命名空间 lab。
- MySQL：127.0.0.1:18306，库 cea，应用账号/密码在 `BACKEND_DB_USER/PASSWORD`。
- MinIO API：127.0.0.1:18900；控制台：http://127.0.0.1:18901，使用 `MINIO_ROOT_USER/PASSWORD`。
- Registry 与 Kubernetes API 不映射宿主端口，只在 cea 网络中被后端访问。管理集群可使用 `docker compose -p cea -f deploy/cea/compose.yaml exec cloud kubectl get pods -n cea-lab`。
- 所有对宿主发布的端口仅绑定127.0.0.1；旧前端开发端口18100不在此部署中。
- 当前工作台可查看任务实例、产物URI及成功JSON预览，另有执行总览与只读集群资源；仍不会把算法Pod stdout汇入Execution日志，纯Application联邦Flow的日志页为空。排查容器输出使用对应集群的 `kubectl logs -n cea-lab job/cea-<taskRunId>-a1`，不是把空日志当成采集成功。

```powershell
# 查看
docker compose -p cea --env-file deploy/cea/.env -f deploy/cea/compose.yaml ps
# 正常启动，不再重复 seed
.\deploy\cea\start.ps1
# 停机：先等待所有执行和 afterExecution 结束
docker compose -p cea --env-file deploy/cea/.env -f deploy/cea/compose.yaml stop
```

不要执行 `down -v`、全局 prune 或清空卷；这些会丢业务数据。脚本没有自动删除历史Job和产物，需要后续明确保留策略。

更新代码后先等待活动执行结束，重新执行build，再执行start。start会重载前端代理以刷新重建后端的地址；不重复initialize/seed，不清空卷。`.env`中的端口是宿主入口，服务之间使用Compose服务名和固定容器端口。

## 服务与边界

12个常驻容器：frontend、backend、mysql、minio、四个Registry、四个K3s。两个 tools profile 服务仅在初始化/导出时临时运行。所有容器/网络/命名卷属于 cea。

- backend 组合Java21与Skopeo1.20，与测试依赖一致；构建时检查 `--no-tags`/`--preserve-digests`。非root运行，只读挂载应用配置及最小凭据，**不挂宿主Docker socket**。API/Executor/Scheduler/Worker同进程，主调用链不变。
- Kubernetes连接是cea-lab ServiceAccount，不给后端admin kubeconfig；nodes list用于选址与只读展示，UI-07另增加cea-lab中Service get/list及仅名为cea-lab的Namespace get，不授予其他Namespace读取或Service写权限。应用Pod不自动挂ServiceAccount token。当前使用显式长期SA token文件，未做自动轮换。
- 存储账号只可读datasets并读写cea-artifacts，不使用MinIO root；root仅供初始化/运维。Registry需要Basic认证；HTTP仅用于本机隔离网络，不是公网TLS方案。
- K3s容器需要privileged用于嵌套集群；不是给业务镜像额外权限，不构成敌对多租户沙箱。
- 本批只需文件型联邦算法；K3s未部署Traefik、ServiceLB、metrics-server、CoreDNS和local-storage。Pod内部服务DNS/Ingress/动态PVC不在当前部署验收范围，不能拿它当完整生产Kubernetes平台。
- Compose设置日志轮转和内存上限，Worker并发4、每边缘1个Job槽/云2槽，Flow自身Loop上限6仍保留；平台槽不是CPU物理独占。

## 本地文件与复核

`.env`、`secrets/`、`.local/cea/`、镜像archive和浏览器截图均不提交Git。.dockerignore也排除它们，构建上下文只包含JAR/静态前端/对应Dockerfile。

`.local/cea/mnist/manifest.json`记录实际MNIST规模；`.local/cea/evidence/<算法>/<executionId>/`包含执行、TaskRun、Job、真实模型和数值审计；`.local/cea/browser/`为只读浏览器截图与结果。计量口径后置，不从镜像复制速度推导算法吞吐量。

本次实际成功/失败与限制见 [DEPLOY-01验证记录](../../docs/verification/VER-DEPLOY-001-cea.md)。

## 参考与有意简化

[Compose就绪依赖](https://docs.docker.com/compose/how-tos/startup-order/)用于健康检查后启动；[K3s私有仓库配置](https://docs.k3s.io/installation/private-registry)用于每个节点的认证和镜像源。通用工作流领域、执行语义和状态所有权未修改，本批不新增Java类、表、API或SPI，不需要复制Kestra的新机制。

修正既有KubernetesJobRunner文件上传：只传字节，不恢复非root后端的宿主文件归属；保持业务Pod权限限制。参考Kestra文件内容/工作目录边界及Fabric8现成InputStream API，细节见[Job协议](../../docs/contracts/s4-job-execution.md)。

当前不保证HA、TLS终止、自动备份/恢复、跨地域容灾、外部多机/ARM或旧系统切换。四集群复核是本机独立部署验收，不是吞吐/精度/安全审计报告。
