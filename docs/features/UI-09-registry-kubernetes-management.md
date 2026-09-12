# UI-09 镜像库存与 Kubernetes 管理

状态：DONE/PASS，已按明确授权部署CEA；仅用户指定四项，不包含在线构建、日志、计量、DQN、旧数据切换。基线 fd1d100。最终230项后端、45项前端单元、50项浏览器及实际部署复核通过，具体证据与修正过程见[验证记录](../verification/VER-UI-009-registry-kubernetes.md)。没有删除CEA既有业务对象。

后续明确授权：修改测试通过后部署前后端；同时允许启用4个Registry删除开关并更新4个集群RBAC，不重启算法集群，不删既有业务对象。详细协议及限制见[UI-09协议](../contracts/ui09-registry-kubernetes.md)。

目录删除保留不可复用的版本身份：V20增加`dep_application_version.deleted`，get/list过滤及register/upload拒绝复用是实际消费者。删除前检查所有保存Flow修订及工作负载；不自动删除对应Registry内容。无新增业务表、工作流状态或SPI。

## 工作包与边界

1. 实际镜像库存：按配置的中心/边缘 Registry 读取 namespace 范围仓库和标签；历史/目录只提供未打标签 digest 的候选，必须实际查询 manifest 后才能显示存在。标准 Registry API 无枚举任意匿名 digest 的端点，不把标签为空解释为仓库为空，不把历史记录当存在证据。
2. 镜像详情/删除：展示 digest、平台、创建时间和压缩层大小；不显示镜像环境变量/认证信息。删除登记与删除仓库 manifest 分开，检查目录引用及实际工作负载，错误拒绝而不是忽略。禁止借浏览器传入任意仓库地址；确认精确 repository/digest，删除后复查。共享 blobs 的离线 GC 不自动执行，不能宣称已释放字节。
3. Service：当前工作空间可管理 Namespace 内创建 ClusterIP/NodePort/LoadBalancer Service，查询真实端口、外部地址及匹配 Pod；仅删除平台创建的 Service，UID/resourceVersion 前置保护。地址返回 Kubernetes 事实，不将 Docker 内部节点地址宣传为 Windows 可直接访问。
4. Namespace：默认执行 Namespace 保留；新增的 Namespace 须属于工作空间，禁止接管同名外部 Namespace、系统 Namespace 和跨租户访问。使用 Kubernetes 名称/归属标签而非另建表；删除保护默认空间、在用工作负载及存储，不强删 finalizer。Runner/Job 仍在既有配置 Namespace，不因管理页选择改变执行位置。

## 验证

真实隔离 Registry/K3s/MySQL：库存与仓库真实状态一致、缺失/错误/分页、精确摘要删除及引用保护；Service 访问/Pod/NodePort/CAS/权限；Namespace 创建/列表/隔离/删除保护；浏览器表单/错误/窄屏以及已有联邦学习/执行回归。补齐 OpenAPI、Java 索引、功能索引、进度和实际验证记录。

参考：CNCF Distribution HTTP API V2、manifest v2 和 garbage collection；Kubernetes Service/Namespace API、resourceVersion/UID 删除前置条件、finalizer。不是通用工作流能力变更，不复制 Kestra Executor/Runner，不增加另一个执行器或状态机。
