# 中心云 Agent Sandbox 安装与验证

DEP-WARM-01，仅操作 `cea-cloud-1`。固定使用 Kubernetes SIGs [Agent Sandbox v1.0.2](https://github.com/kubernetes-sigs/agent-sandbox/releases/tag/v1.0.2) 的 `sandbox-with-extensions.yaml`，不安装路由器、SDK、gVisor/Kata 或额外数据库。

2026-10-16 已安装并验证。**不要再次执行安装命令**；当前保留控制器和 CRD，专用测试命名空间已删除，三个边缘集群未安装。

## 本批执行过程

从 `backend/` 运行，需要 Docker CLI、Node.js，以及已安装的前端 `yaml` 依赖。脚本固定本批环境和证据目录，不是覆盖式通用安装器。

```powershell
node deploy/agent-sandbox/inspect.mjs
node deploy/agent-sandbox/install.mjs check
node deploy/agent-sandbox/install.mjs install
node deploy/agent-sandbox/verify.mjs run
node deploy/agent-sandbox/verify.mjs cleanup
node deploy/agent-sandbox/verify.mjs audit
```

- `inspect`：下载固定发布清单；保存四集群 Deployment/HPA/CRD/Namespace 和原 Docker 服务快照。已有证据时拒绝覆盖。
- `check/install`：先核对对象不存在并做服务端兼容校验，再安装。相对上游仅给控制器增加 requests `100m/128Mi`、limits `500m/512Mi`。
- `run`：独立 `cea-warm-verify` 中创建非特权 Nginx 模板、2 实例池、0 实例池、共享 Service 和探测 Pod。两次领取验证原 Pod/容器被复用、Service 仅接纳已领取实例、自动补回 2 实例、空池新建以及删除 Claim 后回收。
- `cleanup`：只删除本批专用命名空间，测试配置已保存在本地证据，可重建；不删除组件或旧应用。
- `audit`：检查原 31 个 Docker 服务未重启、四集群原 23 个 Deployment 及 HPA 不变、其他集群未新增组件；保存控制器状态、资源和原始日志。

证据保存在 `.local/cea/agent-sandbox-cloud-20261016/`，不提交到公开仓库。若测试中断，先检查证据与集群实际状态，不覆盖原始记录或重复安装。

## 查看安装状态

```powershell
docker exec cea-cloud-1 kubectl get pods -n agent-sandbox-system
docker exec cea-cloud-1 kubectl top pods -n agent-sandbox-system
docker exec cea-cloud-1 kubectl get sandboxwarmpools,sandboxclaims,sandboxes -A
```

安装后没有默认业务预热池。需要使用时创建 `SandboxTemplate → SandboxWarmPool → SandboxClaim`，由控制器领取已经运行的实例，池自行补充库存。释放 Claim 时本批使用 `shutdownPolicy: Delete`，销毁已使用实例，不把带运行状态的实例放回池。

这是 Sandbox 资源的实例池，不会透明接管 Deployment/ReplicaSet/HPA。现有平台扩容按钮仍调用原生 Deployment scale；接入页面/服务副本管理仍属于后续工作，不能把安装冒烟耗时当作提升率。

DEP-WARM-02后续独立对照已完成：Grafana同镜像/单实例资源、1→3各10次普通/预热扩容，平均14.369/0.566秒；初建/补池/资源代价及空池、超库存补测均已记录，实验资源已清理。该结果未改变现有平台扩容方式。[实验方案与脚本](SCALE-BENCHMARK.md) · [完整实测](../../docs/verification/VER-DEP-WARM-02.md)。

如以后卸载，先检查四类 CRD 是否已有业务对象并获得对应删除授权；不能直接删除 CRD 导致业务 Sandbox 一并丢失。

[功能边界](../../docs/features/DEP-WARM-01.md) · [本次实测](../../docs/verification/VER-DEP-WARM-01.md)
