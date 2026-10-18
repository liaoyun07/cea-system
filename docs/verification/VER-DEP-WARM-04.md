# DEP-WARM-04：服务部署 HPA＋预热接入验证

日期：2026-10-18。基于 main `5e496184f5a56cf9faf4889c96246f4e874fa2d4`；提交以本记录所在提交为准。仅中心云 `cea-lab` 和 `cea-lab-warm-ui-20261018`。原生 K3s v1.30.6、已安装 Agent Sandbox v1.0.2；不改 CRD、集群级权限或三个边缘集群。

## 实际能力与调用链

原边缘服务部署创建页选择应用/参数/资源，启用 HPA，可勾选预热池。普通模式沿 Deployment，预热模式沿 WarmService→adapter→SandboxClaim→Agent Sandbox。两者仍由原生 HPA 决定期望副本。Service/Ingress 沿原入口；预热备用 Pod 不加入业务 Service。流程 `platform.Deployment` 共用相同服务与字段，不引入另一套输入输出或生命周期管理。

新增 DeploymentWorkloads、DeploymentScalingTracker、JdbcScalingRepository 三个生产类，V36 两个观测表，命名空间预算接口和部署伸缩历史接口；明细用于资源、轨迹与耗时展示，不是另一个调度状态机。运行时不依赖 platform 模块。Kestra 参考及有意简化见 [ADR](../decisions/ADR-DEP-WARM-04-platform.md)。

## 真实隔离验证

测试应用 `warm04-baseline`、`warm04-warm` 使用同一个公共 Grafana 镜像；CPU request100m/limit500m、内存128Mi/512Mi、相同 HTTP 就绪探针和 Service。短测 HPA min1/max3、CPU目标10%，仅用于快速核验调用链，**不是原热点切换性能实验**。

- 两模式创建、Service HTTP 200，HPA scaleTargetRef 分别为 Deployment/WarmService。
- 先各执行一次1→2→1；预热策略根据实际扩容需求生成2个备用，内存额度1024MiB，未设命中率。
- 70秒 HTTP 负载产生20121个成功请求、0错误，原生 HPA 将两者扩到3。请求数不同不能作为本批吞吐收益结论。
- 数据库独立复核：预热1→2和2→3扩容各复用1个之前Ready的备用 Pod，UID和containerID不变。前者在同次采样内完成（不是精确0ms），后者观测1859ms。
- 基线HPA的1→2事件被后续目标替代，状态SUPERSEDED且耗时为空；2→3为39917ms。不能拿被替代事件当成功，也不能将这些不同事件简单相除宣称提升比例。
- 手动首次扩容预热28900ms、0命中，基线14443ms；记录全部保留，未挑掉首次冷启动。
- 预热应用配置更新到CPU limit600m，池和Claim替换，Service选择器与ClusterIP保持，HTTP仍200。过期预算版本及创建后改部署模式均被拒绝。
- 实际页面创建 `warm04-page`（公共Nginx），HPA和预热字段持久化；详情宽1600px/窄650px无溢出、无JS错误，资源、业务/备用用途、轨迹和事件可见。
- 实际Flow `verify-warm-service-flow` 修订1，成功执行 `7fb90ae6-02f7-4fca-bfd2-53779a415e02`：创建预热Grafana、HPA、Service，就绪后任务SUCCESS。无对外地址配置时endpoint为空，未伪造地址。

## 发现的问题与修复

1. Agent Sandbox 不允许 Claim 注入原先采用的标签域；改用其允许的 `sandbox.users.io/` 业务标识，不放宽集群配置。adapter 更新使用 Recreate，避免两个实例短时竞争。
2. 首次流程创建发生 KubernetesClientException；现场模板尚未写入所有者关联，开源控制器已添加标签。将整对象 update 改为仅 ownerReferences 的 merge patch，避免标签/状态并发变更冲突。原失败执行 `77e2d6eb-50fb-4f37-accb-9946a3d27137` 和资源快照保留；清理其本批派生物后新执行通过。
3. 中心云现有集群没有CoreDNS，Service DNS请求失败；未擅自安装或变更DNS，本批通过Service ClusterIP验证HTTP。页面展示的集群域名仍依赖环境DNS配置。外部压测使用原Service/Ingress入口。
4. 本地验证脚本曾错误声明不存在的deploymentName输出、遗漏执行提交幂等键；均在API校验阶段失败，修正为原endpoint契约及原幂等提交后再验证。不是新增产品字段。

## 回归与发布

- JDK21执行完整 `scripts/verify.ps1`。原工作树一处迁移数量断言34→35需随V36更新；隔离候选全量330项中329通过，1项旧失败容器测试在Pod重启后过早读取Deployment状态。该断言改为等待控制器收敛，不修改业务就绪判断。最终隔离定向复验21项（含该失败项、Deployment相关、契约、真实MySQL与打包启动）全部通过；未把首次全量执行写成全绿。
- 前端75项单元测试通过，构建通过；最终26项部署/HPA/资源/镜像页面回归全部通过。Python策略6项通过；脚手架检查通过。
- 发布前保留 `cea/backend:before-dep-warm-04`、`cea/frontend:before-dep-warm-04`，数据库备份61485939字节。V36迁移成功；只更新backend/frontend，服务健康、真实API与页面核验通过。
- 旧2946条执行、89个Flow列表内容保持；四集群旧Deployment/Service/HPA/Role/RoleBinding规格及UID不变；除已授权backend/frontend外旧容器启动与镜像不变。
- 已删除本批四个测试应用、三个测试Service和负载Pod，未删除历史记录。测试命名空间中WarmService/Claim/Pool/Template/HPA均为0；两个已授权命名空间的adapter和预算配置保留供正式使用。

证据位于本机 `.local/cea/dep-warm-04-20261018/`（不上传数据库备份或凭据）：`hpa.json`、`identity-and-budget-audit.json`、`load-result.json`、`update.json`、`page-created.json`、`warm-history*.png`、`flow-fixed-result.json`、`deleted.json`、`before.json/after.json`、`data-audit.json`。完整回归和独立候选日志位于 `.local/dep-warm-04-*`。

本批没有重新跑30分钟热点切换性能对照，没有证明固定20%或其他新的效率提升；提供的是正式系统内可操作、可观察、可保存记录的接入能力。
