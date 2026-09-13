# UI-10 删除、用户与在线构建

状态：DONE / PASS，2026-09-13已发布CEA；235项完整后端回归、追加1项删除竞争验证、45项前端单测、54项真实浏览器及实际部署复核通过。失败与后续复测见[验证记录](../verification/VER-UI-010-cleanup-users-build.md)。基线cd905bd。用户授权实现并测试后发布CEA前后端，随后确认新增独立BuildKit服务/缓存；未修改旧系统、未删除存量业务对象。

## 最小范围

- USER Flow、终态且后处理已结束的Execution、无应用契约引用的DatasetVersion逻辑删除。隐藏正常查询，保留身份/版本/幂等及历史证据，不清理S3、Registry、Pod或Deployment。Flow删除使用修订前置条件并停止未来定时触发；已删除标识不可复用。不增加垃圾回收器或恢复UI。
- 人员账号仅ADMIN/USER。管理员维护账号、启停、角色与授权工作空间、重置密码；用户查看自身资料和修改密码。原有namespace READ/WRITE/EXECUTE边界继续生效，不增加组织/角色编辑器。CONNECT是机器身份，不作为第三种人员角色，不允许用户管理页创建或修改。配置中人员账号仅首次导入数据库，后续不覆盖已修改的密码和权限；机器账号保持外部配置。
- 上传包含根Dockerfile的ZIP，由独立rootless BuildKit构建linux/amd64 Docker归档，调用现有ImageUploadService完成中心仓库导入与不可变契约登记。同步有界请求、并发1、超时和大小/文件数限制，失败不登记；不新增构建流水线/历史表/Worker链。构建隔离于后端，不挂宿主Docker socket；缓存是独立卷。当前是可信实验室用户构建环境，不宣称敌对多租户沙箱。

## 架构与验证

领域删除仍由各模块公共服务及自有Repository负责；跨模块引用由dataflow服务协调，禁止跨库表访问。新增删除列的消费者是删除保护、查询过滤和身份复用拒绝；人员表由server身份适配层独占，密码仅保存哈希。执行状态机、任务DSL、Runner与Placement不变。

新增5个生产Java文件、12个HTTP操作；V21–V23三个删除列与V24人员表。完整[文件索引](../01-code-architecture.md)、[协议](../contracts/ui10-cleanup-users-build.md)、[取舍](../decisions/ADR-0022-cleanup-identity-build.md)。ExecutionGraph改为读取Execution已有definition快照，Flow删除后历史状态图仍可查看，不新增另一份定义。

验收：真实MySQL删除/重投/调度/引用/权限并发、人员密码持久性/越权/最后管理员、真实BuildKit构建/失败/路径穿越/导入执行；全量Java与浏览器回归。发布前备份、无活动执行、回退镜像；只更新前后端并新增builder，保存现有Flow/执行/数据集/镜像及其他服务。

参考本地Kestra 0354ddf8cb的FlowController.deleteFlow、AbstractJdbcFlowRepository.delete和ExecutionController.deleteExecution：沿用定义/历史独立管理和删除标记思路；不照搬其全套purge、存储删除或非终态强删。BuildKit参考官方README及docs/rootless.md，固定已验证版本，不使用宿主构建引擎。
