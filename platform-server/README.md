# platform-server

职责：HTTP 入口与运行角色装配。

已实现Boot启动、HTTP API、本地Basic身份适配与Executor/Worker/Scheduler运行角色装配。Controller只调用dataflow或resource公开门面，不操作数据库。S4-01新增资源目录和候选检查接口，未增加执行角色。拥有真实MySQL、HTTP、Worker强杀/接管/超时/取消/升级、DAG/条件/FIFO/双Scheduler事务、资源登记原子性/本地性/权限、ArchUnit与协议防漂移测试。启动方法见根README。

- [模块边界与 Java 文件索引](../docs/01-code-architecture.md)
- [功能索引](../docs/02-feature-index.md)
- [当前进度](../docs/04-progress.md)

依赖：`workflow-runtime`、`platform-foundation`、`platform-resource`、`platform-deployment`、`platform-offloading`、`platform-edge`、`platform-dataflow`。实际调用及依赖约束以Java索引为准。
