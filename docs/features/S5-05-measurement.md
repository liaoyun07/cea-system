# S5-05：算法计量最小闭环

最新状态（2026-09-15 MET-001）：用户确认下述口径及镜像内公共SDK；SDK、只读汇总API与概览单一展示已实现、测试并发布CEA，S5-05a/b/c计量功能完成。当前实跑未达到2GB/s，M03暂缓。精确口径见[计量协议](../contracts/algorithm-measurement.md)，结果与现场失败记录见[验证](../verification/VER-MET-001-algorithm-measurement.md)。

历史：2026-09-14只调整优先级时仍暂停生产实现；本次确认后进入实现，不承诺吞吐目标达标。前置S5-04c见[验收](../verification/VER-S5-007-offloading-decoupling.md)。

## 分批范围

| 批次 | 当前工作 | 验收条件 |
|---|---|---|
| S5-04c | 普通执行与卸载观测最小解耦 | 观测表不可访问时真实终端→集群产物链成功；失败/retry/cancel/接管无槽泄漏 |
| S5-05a | 口径和协议确认 | 输入/输出字节、计时边界、并行、重试及跨节点时钟假设明确 |
| S5-05b | 确认后实现公共Python SDK、FedAvg/FedProx适配和后端读取/汇总 | 两轮真实算法数据、所有实际Application实例计量完整，SDK与后端无offloading依赖 |
| S5-05c | 查询协议、异常数据和恢复回归 | 缺失/非法报告无有效速率；并行时间并集、轮次、成功Attempt不重复；全量verify |

## 已确认口径

- 仅成功且所有实际Application实例计量完整的Execution可返回有效速率。
- 分子为实际算法输入文件字节与输出文件字节之和；包括模型与数据集，不把epoch次数乘入字节。文件按同一算法调用内去重；跨真实任务再次处理属于不同处理操作，并不是独立源数据量。
- 每个实例覆盖完整的算法文件读入、计算和结果写出，不能只挑最快的子区间。排队、平台传输、镜像/容器启动不纳入算法活动区间。
- 分母为这些算法活动区间的并集；重叠只算一次，真正串行的轮次分别累加。失败Attempt不当成功工作量重复累计。
- 不返回部分任务的有效速率，不以0补缺失时间。跨节点须有同步时钟；未明确时钟保障时不声称可做可靠的跨节点区间并集。
- 以上是算法处理口径，不是系统端到端吞吐，也不能直接替换卸载reward。

## 实际接入路径

1. 公共Python SDK包围一次完整算法调用，生成真实起止时间和输入/输出文件字节的报告。
2. FedAvg/FedProx的init、train、aggregate、evaluate全部接入；不只计量快节点。两份显式Flow使用既有outputFiles发布报告，与原模型/评估文件走相同Docker/Kubernetes产物链。
3. dataflow通过既有Execution公开查询取得实际TaskRun及其成功产物引用，通过ObjectStorage公开服务读报告。无需跨模块读Repository，不从off_task_observation取时间。
4. 后端校验完整性和数值，按实际实例/成功Attempt汇总。报告继续使用既有产物存储和Attempt隔离，不提前新增计量表、事件总线、SDK回调鉴权或第二个Worker协议。
5. ExecutionMeasurementService拥有查询与校验；GET execution/measurement返回单一rate和审计分子/分母。前端只显示“数据处理速率”。没有旁路Executor/Worker/Repository访问或新表/列。

FedAvg/FedProx四类入口、边缘清洗/诊断/检测/报告、终端振动统计均使用同一个SDK。持续运行的HTTP部署示例、基础设施和离线DQN训练不是本协议下的任务算法调用，不加入SDK。已保存的OFF-04 DQN对比实验保持旧版本与旧样本；新SDK镜像不冒充旧实验已计量。

## 参考与差异

本地Kestra提交0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4的core/src/main/java/io/kestra/core/runners/RunContext.java（metrics/metric）与core/src/main/java/io/kestra/core/models/tasks/runners/TaskRunner.java（本地/远程命令及文件生命周期）。参考任务级计量和Runner文件职责，本项目复用已有产物报告传输，不复制通用指标后端；算法区间并集是本课题计量需求，不声称Kestra默认提供该口径。

## 必须验证

SDK正常/异常、重复输入文件、非有限/负值/时间倒置；无报告、不完整报告、失败Execution；真实两轮与动态客户端实例数量；并行重叠与串行区间；同Attempt接管不重跑、不重复计数；既有DQN样本不参与算法速率。单机Docker/K3s验证只能证明功能，不能证明物理多云时钟或2GB/s。
