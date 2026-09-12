# UI-03 已有管理能力迁移

状态：DONE（已有API范围）。验证与CEA前端更新见[VER-UI-003](../verification/VER-UI-003-management.md)。未迁移能力仍按下表记录，不将缺接口功能标为完成。

后续镜像上传/分发历史、部署编辑/缩放/计时与CPU/内存增量见[UI-08](UI-08-core-deployment-operations.md)；其代码验证与CEA发布状态独立于本页历史验收。

## 范围与边界

来源是旧 `amis/pages/user/site.json` 及对应页面能力，不复制旧路由协议、DTO、数据库或数据。UI沿用Kestra式左导航、列表/详情、主操作栏；参考本地Kestra `0354ddf8cb` 的 `ui/src/components/namespaces/Namespace.vue` 的列表/详情组织，不迁移其store/插件体系。

| 老页面能力 | 本批入口与操作 | 边界 |
|---|---|---|
| 模板/创建/执行监控 | 已有流程及执行工作台继续使用 | 不复制第二份Flow或执行链；模板/执行记录删除暂无API |
| DAG状态图/子任务输出与时间 | UI-05追加只读固定修订拓扑、动态轮次/item选择、TaskRun输出/开始结束/耗时/尝试 | 不新增后端数据；不是Pod日志、产物内容或指标曲线；进度见[验证](../verification/VER-UI-005-execution-inspection.md) |
| 算法评估指标 | UI-06增加既有JSON产物读取、实例明细和单指标图 | 非SDK/计量仓库；只读成功TaskRun/Attempt原值，验证/发布状态见[记录](../verification/VER-UI-006-execution-metrics.md) |
| 应用与镜像/上传 | 应用版本列表、契约详情、注册新版本；UI-08补单镜像tar导入与digest登记 | 不构建镜像，不支持断点续传；UI-08验证/发布状态见其规格 |
| 按需镜像分发 | 应用版本选集群准备镜像；UI-08补公共分发路径的持久分页历史 | 不回填旧历史，不把层复用换算成全量传输 |
| 运行状态/工作负载 | 创建/查询/删除；UI-08补配置回读、CAS编辑、手动扩缩容及有效就绪耗时 | 不做HPA/Service管理/Pod日志；0副本及无有效观测不算部署达标 |
| 集群资源 | Cluster目录；UI-07追加Node/Service/配置Namespace；UI-08追加Metrics API近期CPU/内存 | enabled不是在线健康；不做完整Kubernetes资源写操作或历史监控 |
| 数据集 | 版本登记、格式与各集群S3位置管理、详情 | 不可变版本；不上传/探测对象 |
| 终端接入 | 网关登记、终端归属、启停、最近活动时间 | 账号须先配置CONNECT；不造ONLINE、不代网关发送心跳 |
| 边缘处理策略 | 策略列表、事件路由、启停、原Flow YAML/No-code编辑、CAS保存 | 只走edge策略API；路由不可改派；无物理删除，不能启用独立Schedule |
| 卸载决策记录 | 既有samples只读及关联Execution | 不启动训练、不扩展DQN研究能力 |
| 数据产物 | Execution及TaskRun输出引用；UI-07按执行快照列声明产物，复用JSON按需预览 | 全局对象浏览/上传/二进制下载仍未做 |
| 运行总览 | UI-07按执行提交时间窗口聚合当前状态、日计数及最近执行 | 不是任务计量、状态转移历史或系统资源监控 |
| 用户/个人中心 | 本批不迁移 | 账号密码来自外部配置，无管理API |

## 实现和验收约束

- 所有目录分页；表单下拉读取全部分页，不能把第一页当全部候选。
- 身份只在内存；新页面仍经同namespace Basic API，不接旧后端。
- App/Dataset新版本，不允许原地覆盖；网关/终端固定归属；策略保存携带读到的Flow revision，冲突不自动换版本重写。
- No-code与YAML共用同一source，策略不使用USER Flow保存API。
- 正在提交禁用重复操作；错误和结果未知明确显示，不伪造成功。未保存离开需确认。
- 不将注册、镜像复制成功、Deployment接受或lastSeenAt分别冒充可达、运行成功或在线。
- 生产Java/API/表/字段/SPI均不变，Executor/Worker/Runner主链不变。

验收执行后记录于 `docs/verification/VER-UI-003-management.md`，未执行前不标通过。

## UI-03a 文案精简

直接删除登录、流程/执行、目录管理、部署及No-code表单中的教学和架构说明，不新增帮助展开项或tooltip。保留实际修订/时间/契约类型与默认值、字段标签、空状态、权限和冲突错误、未决提交提示及删除确认。同步删除目录help配置和失去消费者的说明样式；API、表单值、校验和执行链不变。详细语义仍以上方边界与协议为准。

验收：所有列表标题及空状态不含说明段落，保留操作入口；原编辑/保存/冲突/真实执行测试继续通过。当前验证见[UI-03a记录](../verification/VER-UI-003a-copy-cleanup.md)。
