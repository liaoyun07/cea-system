# DEP-HPA-01 原生部署自动扩缩容

部署详情开放HPA创建、编辑、关闭、CPU/内存当前与目标利用率、当前/期望副本、最近伸缩时间及原生条件。只针对平台所有的常驻Deployment，不是Flow Job、集群节点扩容或跨集群迁移。

调用链：页面 → DeploymentController → DeploymentService（原READ/WRITE、工作空间、集群、Kubernetes Namespace、Deployment所有权）→ DeploymentAutoscaling → Kubernetes autoscaling/v2。Metrics Server采集，原HPA控制器计算，Deployment控制器增减Pod。平台不自建伸缩算法、表、缓存或调度服务；状态在打开详情/刷新时读取。

- 副本范围1..100，至少一项CPU/内存正整数利用率，可超过100%；分母为requests而非limits或节点容量。多指标取更大副本需求，稳定窗口/伸缩速率沿用Kubernetes默认。
- 所选指标要求每个普通容器有正requests；提交部署时允许原生limit→request默认规则。资源编辑不能移除HPA所需的requests/limits。
- 零副本先手动启动再启用；关闭只删除HPA、保留实际副本。发现任意目标HPA即禁止手动scale；部署编辑保留读取时的replicas，原resourceVersion条件更新防止覆盖控制器并发变化。
- HPA附带Deployment UID ownerReference，部署删除后原生垃圾回收。只编辑本平台拥有且表单支持的配置，不接管外部/重复HPA，不覆盖同名其他资源。
- 历史部署默认关闭。HPA自主伸缩不记录为手动操作，不套用原30秒部署计时；伸缩介入可使原部署观察记录变为SUPERSEDED。

用户已授权四集群后端账号增加autoscaling/horizontalpodautoscalers的get/list/create/update/delete；只向原ClusterRole追加此规则，不增加scale子资源或其他权限。实际伸缩使用HPA控制器自身权限。

这是原生能力的UI子集，不代表新的伸缩算法或启动提速。未开放自定义/外部指标、behavior、ContainerResource和自动从0启动。参考[Kubernetes HPA](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/)、[Rancher HPA](https://ranchermanager.docs.rancher.com/how-to-guides/new-user-guides/kubernetes-resources-setup/horizontal-pod-autoscaler/)。不修改通用工作流语义、不涉及Kestra执行引擎。

[接口](../contracts/deployment-hpa.md)、[验证](../verification/VER-DEP-HPA-01.md)。
