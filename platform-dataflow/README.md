# platform-dataflow

职责：流程定义、版本与执行管理入口。

已实现Flow不可变版本/CAS/回滚、权限校验和执行管理和取消门面。仅拥有wf_flow_head、wf_flow_revision；无消费者的版本checksum已删除。通过runtime公开执行服务操作运行状态，不直接访问运行表。S3保存定义与同步runtime并发/Schedule在同一事务中；启用Schedule还须EXECUTE权限。

S4-02a增加ApplicationBindingService，通过deployment公开目录读取契约，派生既有Input/Literal/InputRef并解析参数。该API只读，不保存Flow或执行镜像；resource项目依赖尚无直接调用，不为使用依赖增加空接口。

- [模块边界与 Java 文件索引](../docs/01-code-architecture.md)
- [功能索引](../docs/02-feature-index.md)
- [当前进度](../docs/04-progress.md)

依赖：`workflow-runtime`、`platform-deployment`、`platform-resource`、`platform-foundation`。实际调用及依赖约束以Java索引为准。
