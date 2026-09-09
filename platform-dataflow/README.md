# platform-dataflow

职责：流程定义、版本与执行管理入口。

已实现Flow不可变版本/CAS/回滚、权限校验和执行管理和取消门面。仅拥有wf_flow_head、wf_flow_revision；无消费者的版本checksum已删除。通过runtime公开执行服务操作运行状态，不直接访问运行表。S3保存定义与同步runtime并发/Schedule在同一事务中；启用Schedule还须EXECUTE权限。

只管理Flow保存、编辑、版本和提交；S4-02a自动派生服务已撤销，不读取Application参数生成Flow Inputs。作者显式定义的Flow是唯一事实源，未来No-code编辑同一份定义，当前没有No-code。POM中的deployment/resource依赖白名单沿用原工程边界，目前没有直接生产调用，不新增占位消费者。

- [模块边界与 Java 文件索引](../docs/01-code-architecture.md)
- [功能索引](../docs/02-feature-index.md)
- [当前进度](../docs/04-progress.md)

依赖：`workflow-runtime`、`platform-deployment`、`platform-resource`、`platform-foundation`。实际调用及依赖约束以Java索引为准。
