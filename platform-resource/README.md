# platform-resource

职责：资源、数据集、存储位置与预约。

S4-01已实现集群目录、数据集版本/位置的MySQL持久化及只读候选本地性检查。公开入口为ResourceCatalogService，复用命名空间READ/WRITE授权；仅本模块读写res_*表。协议见[资源API](../docs/contracts/s4-resource-catalog.md)，测试在server的真实MySQL集成测试中。

尚未实现资源观测、对象连通性检查、最终选址与容量预约/释放；目录登记不等于集群或数据真实可用。

- [模块边界与 Java 文件索引](../docs/01-code-architecture.md)
- [功能索引](../docs/02-feature-index.md)
- [当前进度](../docs/04-progress.md)

项目依赖：`platform-foundation`，实际用于AccessPolicy。外部依赖spring-jdbc沿用父BOM版本；不依赖workflow-runtime，不访问其状态或表。
