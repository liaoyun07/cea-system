# platform-dataflow

职责：流程定义、版本与执行管理入口。

S5-04a的ApplicationTaskRunner根据显式execution选择Docker或Kubernetes；终端来源由server注入，dataflow不依赖edge或其Repository。两者复用契约、参数、镜像准备、文件/S3和原prepared_json，见[终端执行协议](../docs/contracts/s5-terminal-docker.md)。

已实现Flow不可变版本/CAS/回滚、权限校验和执行管理和取消门面。仅拥有wf_flow_head、wf_flow_revision；无消费者的版本checksum已删除。通过runtime公开执行服务操作运行状态，不直接访问运行表。S3保存定义与同步runtime并发/Schedule在同一事务中；启用Schedule还须EXECUTE权限。

管理Flow保存、编辑、版本和提交；S4-02a自动派生服务已撤销，不读取Application参数生成Flow Inputs。作者显式定义的Flow是唯一事实源，未来No-code编辑同一份定义，当前没有No-code。ApplicationTaskRunner已通过deployment/resource公开服务准备镜像、选址和文件，并调用runtime的Job Runner。

S5-03区分USER/EDGE_POLICY管理范围：两者共享Flow修订表和定义模型，普通模板入口不显示或修改策略；edge通过savePolicy/getPolicy/submitPolicy公开方法复用此模块，定义的校验和执行链不复制。详见[接入协议](../docs/contracts/s5-edge-access.md)。

- [模块边界与 Java 文件索引](../docs/01-code-architecture.md)
- [功能索引](../docs/02-feature-index.md)
- [当前进度](../docs/04-progress.md)

依赖：`workflow-runtime`、`platform-deployment`、`platform-resource`、`platform-foundation`。实际调用及依赖约束以Java索引为准。
