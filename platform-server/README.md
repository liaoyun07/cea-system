# platform-server

职责：HTTP 入口与运行角色装配。

已实现Boot启动、HTTP API、本地Basic身份适配与Executor/Worker/Scheduler运行角色装配。Controller只调用dataflow、resource或deployment公开门面，不操作数据库。S4-01提供资源目录/候选检查；S4-02a提供应用契约目录和参数绑定计划/解析，均未增加执行角色。拥有真实MySQL、HTTP、恢复/并发/升级、资源及应用目录/参数绑定、ArchUnit与协议防漂移测试。启动方法见根README。

- [模块边界与 Java 文件索引](../docs/01-code-architecture.md)
- [功能索引](../docs/02-feature-index.md)
- [当前进度](../docs/04-progress.md)

依赖：`workflow-runtime`、`platform-foundation`、`platform-resource`、`platform-deployment`、`platform-offloading`、`platform-edge`、`platform-dataflow`。实际调用及依赖约束以Java索引为准。
