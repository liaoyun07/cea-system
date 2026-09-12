# ADR-0021 管理资源不拥有执行状态

日期：2026-09-13。范围：UI-09，用户授权四项管理能力以及测试通过后的CEA前后端、Registry删除开关和管理RBAC发布。

决策：Registry V2库存与Kubernetes资源保持现场查询；不把历史记录或目录登记当成实际存在，也不新增镜像库存表、Service表或Namespace表。标准V2不提供任意无标签manifest完整枚举，已知分发digest必须再查manifest。仅删除manifest；共享blob的GC必须另行维护，不在运行期自动执行。

目录删除使用V20的deleted标记。真实消费者为get/list过滤及register/upload不可复用检查；如果物理删除目录行，同一版本号可以重新登记不同契约，历史分发含义会改变。原始契约保留不是第二份活动目录，不增加恢复API。Flow引用扫描通过dataflow公开服务，资源查询通过resource公开服务，deployment不读取其它模块的表。

Service/Namespace管理使用已有Kubernetes连接；增加的范围只用于管理，不能暗中改变JobPlacementService或Runner默认Namespace。平台拥有的新Namespace带工作空间标签与名称前缀，默认和非托管资源受保护。删除前现场检查、对象版本约束和用户精确确认不等于分布式锁；外部管理员并发变更需维护窗口协调。

取舍：为当前多Namespace创建/管理增加ClusterRole权限，API层做租户范围隔离；Kubernetes RBAC本身不能表达名称前缀创建授权。这不是强多租户隔离方案，也不凭空增加Admission Webhook。不同信任域部署可使用独立后端身份/集群，当前不实现。

参考：[Distribution V2](https://distribution.github.io/distribution/spec/api/)、[Registry GC](https://distribution.github.io/distribution/about/garbage-collection/)、[Service API](https://kubernetes.io/docs/reference/kubernetes-api/core/service-v1/)、[Kubernetes API并发控制](https://kubernetes.io/docs/reference/using-api/api-concepts/)、[finalizer](https://kubernetes.io/docs/concepts/overview/working-with-objects/finalizers/)。本批不修改通用工作流执行语义，不复制Kestra Executor/Worker或新的状态模型。
