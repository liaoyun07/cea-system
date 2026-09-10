# ADR-0009 S4 一次性容器任务

2026-09-10，ACCEPTED，基线fd285e9。用户授权继续剩余S4。本批先实现S4-03，不改变S5计量与终端卸载范围。

## 成熟职责与项目差异

参考本地Kestra 0354ddf8 的 RunnableTask.run 与 TaskRunner.run/kill：Worker执行叶子，Runner负责远程环境、文件传输与停止，Executor仍是Execution/TaskRun/Attempt唯一状态拥有者。项目只增加一个被真实容器任务消费的执行接口，不复制插件发现/市场。引用沿用已有Binding；不派生Flow Inputs。

实际参考文件：`core/src/main/java/io/kestra/core/models/tasks/RunnableTask.java`、`core/src/main/java/io/kestra/core/models/tasks/runners/TaskRunner.java`；本地源码提交为`0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4`，不声称它是官方最新版本。

Application任务显式指定应用版本、候选集群、参数Binding、输入文件Binding和输出文件名。系统包装显式argv：等待输入就绪→执行一次→保留容器收集产物→退出。镜像须是Linux并包含/bin/sh、tar和sleep；这是当前阶段简化，不宣称支持任意distroless镜像。用户命令仅在Pod中执行，不在后端宿主执行。数据集输入和命名中间产物分开，数据集位置来自resource目录。

## 状态与字段消费者

- runtime Worker传输增加cancel_reason：Executor请求远程停止后，Worker可在超时后继续领取/续租清理，确认远端停止才归并结束。prepared_json保存真正启动使用的镜像digest/位置/参数/文件计划，接管不重新解析可变tag。
- resource新增res_job_reservation：每Attempt稳定分配一个目标；使用目录集群行锁原子占用配置的作业槽，完成后释放槽但保留位置用于同Attempt恢复。它是平台作业并发预约，不冒充CPU/内存物理独占。Kubernetes仍负责Pod实际资源调度；真实Ready节点观测过滤不可用目标，数据集本地性继续强制校验。
- Job名称稳定对应TaskRun/Attempt；backoffLimit=0、restartPolicy=Never，业务重试由Executor决定。Worker失联不新建业务Attempt。取消保留suspended Job作为停止标记，避免旧Worker迟到create重启相同Attempt；结束Job暂不自动清理，运维保留策略不在本阶段扩展。
- 输入暂存和产物传输通过Kubernetes文件API及S3客户端完成，镜像不持有S3凭据。产物按namespace/execution/taskrun/attempt隔离，所有产物上传成功后才发布Task结果。失败/中断未发布的对象不是有效输出。

普通选址仅使用resource能力，不调用platform-offloading。Kubernetes/存储连接由管理员配置，保持namespace权限边界；测试只使用独立环境。未知外部状态不能返回成功或立即开始新的业务重试。S4-04与S4-05仍需后续独立验收。
