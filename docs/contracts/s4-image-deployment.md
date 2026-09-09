# S4 镜像准备与常驻部署

S4-02b/c。源契约仍为 ApplicationVersion；不派生 Flow 输入，不新增 alias/binding。此接口不创建 Execution、TaskRun 或一次性 Job。

## 真实调用链与状态

准备：HTTP → ImageDistributionService → 应用/资源公开目录 → Skopeo inspect/copy/inspect。源 Registry 必须配置；目标由 namespace/clusterId 映射选择，调用者不能输入目标地址。先固定源 digest，复制所有 manifest/layers，核验目标 digest 后返回 PreparedImage。同步操作，超时/失败返回502，不伪称已准备。重试按内容寻址复制；不新增业务 checksum 或分发状态表。

部署：HTTP → DeploymentService → 契约显式值校验 → 镜像准备 → Fabric8 Kubernetes API。Kubernetes Deployment 是期望/实际状态的唯一存储；应用版本通过 annotations 标识，平台 namespace/资源所有权通过 labels 校验。没有第二套数据库部署状态。

## API

全部继承现有 Basic 身份与 namespace 权限。准备和部署修改要求 READ+WRITE；查询要求 READ。契约/集群找不到404，参数/未配置连接422，版本或所有权冲突409，外部操作无法确认502。部署返回200只说明资源已创建/更新，不代表容器已就绪。

- POST `/api/namespaces/{namespace}/applications/{applicationId}/versions/{version}/preparations/{clusterId}`：返回实际 digest 固定的目标镜像。
- GET `/api/namespaces/{namespace}/clusters/{clusterId}/deployments`：只列本系统且同平台 namespace 的资源。
- GET 同路径 `/{name}`：返回 replicas、readyReplicas、observed、Kubernetes conditions、resourceVersion。
- PUT 同路径 `/{name}`：显式 applicationId/version、replicas、parameters 和 command。缺省参数使用镜像契约默认值，unknown/type/required/choices 均校验；不生成 Flow 定义。首次不传 resourceVersion；更新必须传刚读取的版本，客户端禁止在冲突后自动刷新版本覆盖。
- DELETE 同路径 `/{name}?resourceVersion=...`：版本前置条件删除，返回202；通过查询确认资源消失。不是同步保证全部 Pod 已退出。

停止使用 PUT replicas=0；再次启动使用 replicas>0。命令是 argv 数组，不由后台 shell 拼接。Pod 禁止自动挂载服务账号 token、禁止提权、删除 Linux capabilities。镜像仍必须可信；本阶段没有实现不可信多租户沙箱。

示例创建体：

```json
{"applicationId":"service","version":"v1","replicas":1,"parameters":{"GREETING":"hello"},"command":["/bin/sh","-c","exec sleep 300"]}
```

## 管理员配置与凭据

配置示例见 [s4-runtime-config.yaml](../../examples/s4-runtime-config.yaml)。路径指**后端运行环境**的实际文件；测试使用 docker exec 只是隔离测试工具，不是要求业务镜像携带 Skopeo。生产运行镜像准备的后端需安装 Skopeo，使用外部挂载 auth.json。用户名/密码不放到准备接口或进程参数。

Kubernetes 必须显式指定 kubeconfig、context、实际 namespace；未配置时拒绝操作，不自动使用开发者当前 kubectl context。凭据由 kubeconfig/挂载文件提供，生产应只给目标 namespace 的必要 Deployment/ReplicaSet/Pod 权限。Registry 拉取认证须在目标集群配置，独立于 Skopeo 复制认证。

TLS默认开启；仅独立测试 Registry 使用明文。HTTP API仍默认环回监听。本次没有自动开放公网、创建真实集群凭据或改旧系统配置。

## 边界

此批提供常驻容器管理，不配置 Service/Ingress 对外路由，不声称已经完成一次性容器 Flow、资源预约、数据路径注入或脚本。数据集规则只校验所选 id/version 是否允许；真实路径/产物接入由 S4-03 的 Task 消费者实现。镜像准备不保证业务镜像启动成功；失败/未就绪从真实 Deployment 状态读取。
