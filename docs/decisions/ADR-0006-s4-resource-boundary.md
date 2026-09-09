# ADR-0006 S4资源目录与执行环境边界

2026-09-09，ACCEPTED。用户授权开始S4；本决策确定S4-01资源目录闭环，不代表整个S4已完成。

## 已核对来源

本地Kestra D:/Project/Kestra/kestra，提交0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4：

- core/src/main/java/io/kestra/core/models/tasks/RunnableTask.java：Runnable在Worker中执行，通过RunContext获得上下文。
- core/src/main/java/io/kestra/core/models/tasks/runners/TaskRunner.java：Runner负责本地/远程执行环境以及文件传入传出，拥有停止回调；不是新的Execution状态所有者。
- core/src/main/java/io/kestra/core/models/tasks/runners/RemoteRunnerInterface.java：远端工作目录同步是Runner能力。
- core/src/main/java/io/kestra/core/storages/StorageInterface.java：存储URI及namespace隔离与文件读写分开处理。

只沿用职责，不复制上游SPI全集。云边数据集物理位置及不可迁移数据约束是本项目业务差异，归platform-resource，而不是放入通用Worker或DQN。

## 本批决定

1. platform-resource拥有命名空间内Cluster、不可变DatasetVersion及其Location目录。HTTP资源管理/候选位置查询是当前真实消费者。
2. Cluster只保存id、CLOUD/EDGE类型和enabled。enabled是管理员允许使用，不是实时健康状态；没有观测来源前不伪造CPU/内存/在线指标，不添加endpoint或credential引用空字段。
3. DatasetVersion由datasetId/version定位，format及注册时locations不可变；同内容重复注册返回原记录，不同内容409。变更内容使用新版本。此处仅注册位置，不上传、探测或复制数据，不声称验证了对象存在。
4. Location由clusterId与不带凭据的s3://bucket/key对象URI表达；同版本每集群一个位置，允许同一版本多个副本。URI是对象定位，不含对象存储endpoint/密钥；连接和实际传输在后续批次接入。
5. placement-options是只读的候选集群检查：候选必须已注册、enabled、具有全部请求数据集的指定版本，且format符合请求约束。返回每个集群的eligible、拒绝原因和可用位置，不自动选址、预约、派发或迁移；不调用卸载DQN。
6. namespace READ/WRITE权限复用既有AccessPolicy；Controller只调用ResourceCatalogService，不跨模块访问Repository。资源错误使用本领域异常，由HTTP适配统一映射，不引入resource→runtime依赖。
7. 新增三张目录表，复用同一个DataSource和TransactionTemplate；数据集及所有位置一个事务。无额外状态机/hash/修订辅助字段/Manager/SPI/缓存。

## 后续边界，不提前实现

后续实际Job接入时才引入有消费者的资源观测/原子预约、运行位置快照和Runner接口；runtime负责Attempt及Job恢复，deployment负责镜像契约/准备和常驻Deployment。数据集位置约束与镜像契约格式约束都应进入该链，不能把只读候选检查宣称为已完成调度。

S4退出条件仍是原计划全部条件；本批只完成S4-01，RES-001/RES-002保持IN_PROGRESS。独立测试集群、镜像管理、Job/产物、HTTP/SQL/隔离脚本和P04/P05/P06/P11验收不被删除或后置到S5。
