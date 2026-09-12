# ADR-0020 核心镜像、部署与资源查看

日期：2026-09-12。状态：已实现并验证，未发布CEA。范围：UI-08；DEP-001/002、RES-001。RES-002选址与资源预约不变。

## 决策

- deployment负责归档导入、应用版本登记协作、按需分发记录及Deployment操作计时；resource负责授权范围内的Kubernetes用量查询；server装配和提供原Controller的扩展接口。
- 不改变Flow/Execution/Worker/Binding，不新增调度器或通用Operation抽象。Deployment期望和实际状态仍由Kubernetes拥有，数据库只保存操作和计量证据。
- 复用现有Skopeo、Registry连接和ApplicationCatalogService。归档仅支持单镜像docker-save tar；导入后按digest登记不可变版本，不执行归档内容，不开放任意仓库地址。不新增上传会话表。
- 公共分发入口记录每次实际发起的Skopeo分发操作，包含手动、部署、执行准备；层复用不等于全量传输，不推算字节数。无法确认的操作不是成功。
- 部署计时从通过校验并接受请求开始，包含本次分发、拉取和启动，直到后台首次观察本次UID/generation全部副本就绪。30秒是申报书目标，不是接口返回期限。更新/扩缩容与首次部署区分；无变化、停到0、观测中断不作为有效部署样本。
- 资源使用率来自metrics.k8s.io，节点容量为百分比分母，容器仅在有limit时给出limit百分比。缺失/过期为不可用，不是0；不建立时序库，不把近期用量冒充系统开销验收。

## 参考与差异

本地Kestra提交0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4的Runner日志采集、RunContextLogger、DefaultIndexer和LogController已经审查；日志本批后置，不照搬其队列/Indexer。云边镜像管理不是通用工作流状态，沿用现有业务模块。部署完成参考[Kubernetes Deployment](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#complete-deployment)；用量参考[Metrics Server用途/兼容性](https://github.com/kubernetes-sigs/metrics-server)。当前K3s1.30需兼容0.7.x，不能直接用最新版。

## 数据消费者

dep_image_distribution由分发服务写、历史接口读；Registry digest参与真实目标校验并保留在target_image引用中，不单独增加重复digest列。dep_deployment_record由部署服务写入目标身份/起点，由观察器完成及页面查询；UID/generation防止同名重建或后续变更串计，计量有效性避免中断后伪造耗时。无新增无消费者hash、Binding或SPI。
