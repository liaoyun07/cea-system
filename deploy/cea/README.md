# CEA 独立本地部署（DEPLOY-01）

FLPAR-11（2026-09-16，已部署）：四K3s经 `k3s-entrypoint.sh`（LF）启动，保留host cgroup namespace，分别配置 `/cea-cloud`、`/cea-edge-a`、`/cea-edge-b`、`/cea-edge-c`，不得共享默认/kubepods；原2GiB/3CPU仍仅限制外层控制容器。保留卷，不执行down -v或清理旧cgroup；后端授权先于Pod启动，无SQL变化。264项Java及18客户端四次实际运行通过，启动Warning为0，正式51～53秒、主容器峰11～14，算法峰5～7；Worker24/槽6保持。旧backend已标记 `cea/backend:pre-flpar11`，原42个K8s对象/Flow/数据/历史及14非目标服务保持。[发布与结果](../../docs/verification/VER-FLPAR-11-startup.md)。

OFF-04发布入口为`release-offloading-dqn.ps1 -Capture/-Publish/-Verify`，测试后只更新backend/frontend/edge-gateway，保持19个常驻服务、原16个无关服务和业务对象；无DB migration。`run-offloading-dqn.ps1`是**主动实验**，会新增6个研究策略、模型与114条执行，不是普通健康检查，遇错不能直接重跑覆盖。操作和边界见[研究说明](../../algorithms/offloading/README.md)，实际上线状态与结果见[验证](../../docs/verification/VER-OFF-04-double-dqn.md)。下列批次状态为历史。

OFF-03于2026-09-14已发布，仍为19个常驻服务。测试后`upgrade-offloading-measurement.ps1`仅更新backend/frontend/edge-gateway/terminal-agent与edge-a/cloud公共文件助手；V26/V27已应用，发布前完整备份数据库并保留旧镜像/私有存储配置。原15个无关服务、Flow、策略、历史和数据集不变；不需要再次初始化或升级。旧edge-b/c助手不参与本批终端卸载测量，若将来扩展其卸载入口，需要更新对应助手。六次实际执行/乱序关联及18080“卸载观测”已验证，见[证据与回退边界](../../docs/verification/VER-OFF-03-measured-feedback.md)。

OFF-02于2026-09-14已发布，当前19个常驻服务；真实三层/RULE、文件存储、结果和页面验证通过，见[发布证据](../../docs/verification/VER-OFF-002-terminal-gateway.md)。下列安装脚本不是日常重复运行任务的入口，回放请使用示例中的terminal-compute命令。

OFF-02新增可选`terminal-offloading`服务组：terminal-agent、独立terminal-engine，以及一次性terminal-compute工具。引擎只监听专用Unix socket卷、不挂宿主Docker socket、不开放Docker TCP端口；仅engine特权。当前安装状态见进度。运行前先测试/保存CEA基线和回退镜像；`setup-offloading-paths.ps1`仅生成私有待发布配置与合成终端信号，`-Publish`才更新backend/gateway及新增服务、注册4个新策略。原17服务中只重建backend/gateway；frontend只reload，不改原3策略或FedAvg/FedProx。新增4个卷承载独立Docker缓存、socket、工作文件与取消标记，暂不自动GC。示例操作见[三路径说明](../../examples/offloading/README.md)。

OFF-01 升级：`application.yaml` 的 `platform.jobs.central-clouds.lab: [cloud]` 只限定终端卸载的云层范围，不改变普通 Flow 候选。EDGE 由可信终端归属限定。V25 仅允许卸载观测的 target_id 在预约前为空；新 DQN 执行暂停至 OFF-04。发布前须确认无活动执行/WorkerJob，并检查保存修订和执行快照没有旧 offload.candidateClusters（若有则停止发布，不能悄悄改历史）。备份数据库/配置与旧镜像后，仅更新 backend/frontend 并刷新 nginx；不重启存储、Registry、网关或算法集群。详细边界见[当前卸载协议](../../docs/contracts/s5-terminal-offloading.md)。

FILE-01已于2026-09-13发布并现场验收（见[记录](../../docs/verification/VER-FILE-001-pod-artifacts.md)）：新增 minio-edge-a/b/c 三个服务和独立卷（共16个常驻服务），不新增宿主端口；四集群使用公共文件助手，原算法镜像不变。中心保留 datasets/历史 cea-artifacts，新的边缘 Job 输出写到对应 cea-artifacts-edge-*；不是数据集迁移。新增三个存储的内存上限各512MiB，实际磁盘随产物增长，暂不自动GC。

旧版本现场升级须先获授权、检查无活动Execution/WorkerJob、保存恢复镜像/配置/Role并停止backend（防止旧Runner在pods/exec撤销后继续接任务），再应用新storage配置并执行`setup-files.ps1`；发布测试后的backend镜像，仅`up -d --no-deps --wait backend`，最后`exec -T frontend nginx -s reload`。本次已完成，不必重复初始化。setup-files只增加边缘存储、Bucket权限、助手Registry副本及Secret RBAC，并生成ignored的`secrets/backend/storage-endpoints.yaml`（Pod可达内网IP和助手digest）；它不重启原服务、不提交Flow、不迁移数据。存储容器重建/IP改变后应重新生成并更新backend；新安装的start已调用该步骤。禁用CoreDNS的本地设置不能直接照搬到物理多云。

K8s Runner不再需要pods/exec，替换为执行Namespace内secrets get/create/update/delete；助手授权挂载不进入算法。参考[协议](../../docs/contracts/file01-pod-artifacts.md)。部署后`verify-federated.ps1`同时检查四存储输出、助手/Secret隔离及两轮模型数值，不适用于断言旧中心-only历史执行已具备新存储行为。接收边缘产物后不能简单回退到只识别中心的旧backend。

UI-10新增builder（第13个常驻容器）、buildkit-socket和buildkit-cache专用卷，仍在D盘Docker数据盘。rootless BuildKit v0.33.0保留process sandbox；只调整builder的seccomp/AppArmor/systempaths，不挂宿主Docker socket，不给privileged，不暴露TCP端口；backend通过共享UNIX socket连接，builder处于单独build-network，不加入CEA业务网络。可信实验室源码构建环境，不是敌对多租户沙箱。2CPU/2GiB内存限制；缓存沿BuildKit默认GC，非硬磁盘配额，应继续保留至少8GiB暂存余量及缓存余量。

V21–V23增加逻辑删除列，V24增加sec_user。管理员账号由外部配置首次导入，之后只认数据库密码/权限；修改`.env`不会重置人员账号。初始默认developer为ADMIN；外部显式users数组须给预期管理员设置`role: ADMIN`，其余默认USER。CONNECT仅机器账号、保持外置。改密后命令行脚本若仍使用旧BACKEND_PASSWORD也会401，应使用当前凭据，不用重启覆盖。GET /health不依赖管理员凭据，只返回DB readiness。

已安装环境本批只发布builder/backend/frontend。先备份数据库、保留旧镜像、确认无活动执行和上传；构建测试通过后依次`up -d --no-deps --wait builder`、`up -d --no-deps --wait backend frontend`，最后刷新nginx。不重新运行initialize/start覆盖已配置服务/SA，不重建MySQL、MinIO、Registry、算法集群。不删除业务对象；回退涉及已删除可见性和DB人员密码，不能只用旧镜像把新账号语义当作仍有效，应结合发布前DB备份明确回退范围。

在线构建入口为“应用与镜像 → 在线构建”，选择ZIP（根Dockerfile）及应用/版本/契约。当前100MiB压缩、512MiB展开、并发1、10分钟、linux/amd64、输出≤2GiB；日志仅本次响应。私有基础镜像认证、持久构建历史、前端取消、Git仓库拉取和多架构构建未实现。成功后使用原镜像部署/分发功能；[示例源码](../../examples/deployment-demo/README.md)可打ZIP上传，根目录必须保持Dockerfile和app.py同级。修改权限在Dockerfile中完成。

UI-09发布准备：启用Registry manifest删除开关（不运行GC），ClusterRole增加Namespace/Service管理和引用检查所需读取；V20给应用版本加deleted列，保留旧版本身份。管理Namespace不会改变算法默认`cea-lab`。现有安装只更新已授权的前后端、4个Registry及ClusterRole规则，不重新运行initialize/start或覆盖SA/Secret。发布状态见[VER-UI-009](../../docs/verification/VER-UI-009-registry-kubernetes.md)。RBAC扩大后的工作空间隔离由管理API强制执行，不等同于Kubernetes原生按标签授权。

固定 Compose 项目名 `cea`。源码与配置在 D 盘 backend 仓库，Docker Desktop 数据盘必须先切到 D 盘；命名卷实际存于该 Linux VHDX，不把 MySQL/K3s 数据库直接绑定到 NTFS。启动脚本检查路径，不负责再次迁移 Docker 数据。

这是**单机上的四个独立 K3s 集群**：cloud、edge-a/b/c 各有自己的 API、状态库、containerd 和 Registry，不是四个目录项映射到同一个集群，也不是跨地域物理多云。FILE-01前只有中央MinIO，FILE-01新增按位置分开的产物存储；三个训练分片仍在原中心datasets桶，按位置登记，不宣称数据已迁移至物理边缘设备。

不导入 web-platform 数据、旧模板或旧执行历史；不连接旧数据库/Harbor，不切换旧系统。DQN、数据处理速率、物理终端/网关代理不在本批范围。

## 第一次安装

UI-08新增上传暂存卷`cea_upload-scratch`（D盘Docker数据盘）、namespace中心Registry映射及V18/V19记录表。只构建不会发布或修改数据库；更新后端时Flyway创建新增表，不回填历史。默认上传2 GiB、导入并发2，接收和导入可能双份占盘，至少预留8 GiB暂存余量并监视D盘容量。进程崩溃残留文件/未引用镜像tag不自动GC，确认没有活动上传后才做维护清理，不删除整组数据卷。

资源用量需要显式安装[metrics-server.yaml](metrics-server.yaml)和更新[rbac.yaml](rbac.yaml)，不随后端启动安装。本地K3s1.30使用Rancher镜像的metrics-server v0.7.2，官方镜像映射见[Rancher配置](https://github.com/rancher/artifact-mirror/blob/master/config.yaml)。清单中的Kubelet insecure-tls只适用于当前本地自签环境，外部生产集群应提供受信任证书并移除此参数。不接入历史监控/HPA。

2026-09-13已按用户授权在当前CEA发布UI-08。下列命令用于明确授权后的安装；已有集群更新前须检查现有资源归属，不能覆盖其他控制器的Metrics Server。当前实例采用已缓存镜像导入四个containerd，且仅JSON Patch更新既有Role/ClusterRole规则，没有重建SA/Secret。发布记录见[VER-UI-008](../../docs/verification/VER-UI-008-core-deployment-operations.md)。

在backend根目录执行：

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

build 执行完整 Maven verify、前端单测和构建，再构建前端、后端和BuildKit三个部署镜像。需要网络下载依赖；失败即停止，不自动退回旧代码或关闭检查。

initialize 首次从 [.env.example](.env.example) 生成随机凭据，后续复用已有 .env；生成服务连接文件、Registry 认证及 pause 镜像离线包。已有凭据不自动换一套。连接配置见 [application.yaml](application.yaml)。

start 只启动/核验 cea，向四个新集群应用 [rbac.yaml](rbac.yaml)、生成最小权限连接、建立两桶及独立存储账号，再启动后端/前端。不会创建业务 Flow 或 Execution。不要修改已有 MySQL 的 .env 密码就认为数据库密码也随之更改；凭据轮换须单独操作并保持一致。

seed 是**显式首次登记**：构建新联邦镜像、7项算法单测、真实MNIST下载/完整性检查、中央镜像推送、数据上传、四个资源/两个数据集/五份契约/两份 Flow 首版。默认训练60000、测试10000。已有 fedavg/fedprox 时拒绝覆盖，后续通过修订 API/前端编辑。这里不是Java启动自动seed，也不迁移旧版本。

verify-federated 会真实提交一次两轮执行，保留失败记录；验证11个Job位于预期四集群，导出产物并独立重算训练、加权聚合和全局评估。不会把取消或缺文件算成功。verify-browser 是只读检查，不创建额外演示模板。

复核已有执行可加 `-ExecutionId <UUID>`，不再次提交训练；仅用于对应算法的两轮默认参数验收。自定义轮数/超参数需调整相应验收，不能套用本脚本宣称数值正确。

## 日常使用

- 工作台：http://127.0.0.1:18080
- API：http://127.0.0.1:18085
- 初始账号：`.env` 中 `BACKEND_USER`（默认 developer）；初始密码：`BACKEND_PASSWORD`；命名空间 lab。在线改密后使用新密码，以数据库为准。
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
- 本批只需文件型联邦算法；K3s未部署Traefik、ServiceLB、CoreDNS和local-storage。内置metrics-server保持禁用，UI-08以独立清单安装v0.7.2采集器。Pod内部服务DNS/Ingress/动态PVC不在当前部署验收范围，不能拿它当完整生产Kubernetes平台。
- Compose设置日志轮转和内存上限，Worker并发4、每边缘1个Job槽/云2槽，Flow自身Loop上限6仍保留；平台槽不是CPU物理独占。

## 本地文件与复核

`.env`、`secrets/`、`.local/cea/`、镜像archive和浏览器截图均不提交Git。.dockerignore也排除它们，构建上下文只包含JAR/静态前端/对应Dockerfile。

`.local/cea/mnist/manifest.json`记录实际MNIST规模；`.local/cea/evidence/<算法>/<executionId>/`包含执行、TaskRun、Job、真实模型和数值审计；`.local/cea/browser/`为只读浏览器截图与结果。计量口径后置，不从镜像复制速度推导算法吞吐量。

本次实际成功/失败与限制见 [DEPLOY-01验证记录](../../docs/verification/VER-DEPLOY-001-cea.md)。

## 参考与有意简化

[Compose就绪依赖](https://docs.docker.com/compose/how-tos/startup-order/)用于健康检查后启动；[K3s私有仓库配置](https://docs.k3s.io/installation/private-registry)用于每个节点的认证和镜像源。通用工作流领域、执行语义和状态所有权未修改，本批不新增Java类、表、API或SPI，不需要复制Kestra的新机制。

修正既有KubernetesJobRunner文件上传：只传字节，不恢复非root后端的宿主文件归属；保持业务Pod权限限制。参考Kestra文件内容/工作目录边界及Fabric8现成InputStream API，细节见[Job协议](../../docs/contracts/s4-job-execution.md)。

当前不保证HA、TLS终止、自动备份/恢复、跨地域容灾、外部多机/ARM或旧系统切换。四集群复核是本机独立部署验收，不是吞吐/精度/安全审计报告。
