# OFF-INDEP-01 独立卸载协议

## 边界与调用

页面 → Java 用户鉴权代理 → 实验控制服务（启动/停止/策略/统计）。

终端泊松到达 → 所属网关 `/decide` → 本地边缘积压 + 中心云 `/backlog` → 决策与目的地预约 → 返回终端。

- 本地：终端计算 FIFO → Docker；不上传原始文件。
- 远程：该终端上传 FIFO → 同速率真实 HTTP PUT 到目的地 MinIO → 附加距离时延 → 目的地 `/ready` → 执行 FIFO/固定槽 → 直接 k3s Job → 读取该目的地输入并保存结果。
- 任务完成更新记录并释放字节积压/执行槽。控制服务每 2 秒查询整体状态，不由 30 终端分别轮询每个远程任务。
- 整批停止发送、终端排空、任务终态后先保存统计，再删除本批 Job/容器及 `lab/offload-lab/<runId>/` 对象、终端该批输出；原始共享模板和 SQL 历史不删除。

## 五维状态

原值 `[当前任务 bytes, 本地未完成 bytes, 上传 FIFO 预计等待 s, 所属边缘未完成 bytes, 中心云未完成 bytes]`。
字节状态转换 `log1p(bytes / 1_000_000)`，上传等待 `log1p(seconds)`，schema=`offload-five-v1`。
任务选中目的地即预约全部字节；计算完成扣除，包含上传中/执行中。不是精确剩余计算量。上传等待包含未发字节/固定上传字节速率及尚未走完的附加时延。
LOCAL/RANDOM 可通过页面运行；DQN 推理函数只接受五维三动作参数，本批未训练、不在页面启用。RANDOM 不按文件大小排除终端或边缘。

## 存储

独立实验服务拥有 `offlab_runs`（计划、策略变化、汇总、清理结果）、`offlab_tasks`（请求、五维快照、目的地、状态、阶段时间、结果摘要/失败）、`offlab_samples`（终端真实 cgroup CPU/内存及采样时间）。新表无外键指向普通 Flow；Java 不读表。
每控制/执行服务 3 条 SQL 连接，仅短查询/更新使用；外部 HTTP、上传、排队、Job 等待均不持连接。终端不持数据库连接。

四集群使用专用 `cea-offload-lab` Namespace 与执行账号，仅该 Namespace 的 Job create/get/list/delete 和 Pod get/list。结果摘要通过 Pod termination message 读取，不依赖 pods/log 权限。MinIO 权限只覆盖本批 `lab/offload-lab/*`；旧后端 Kubernetes 账号及原业务 Namespace 不改。

## 页面 API

前缀 `/api/namespaces/{namespace}/edge/offload-lab`：

| 请求 | 作用 | 权限 |
| --- | --- | --- |
| GET `/devices` | 已配置模拟终端及最近真实资源 | READ |
| GET `/runs` | 最近 50 次实验 | READ |
| GET `/runs/{id}` | 本次任务、采样和统计 | READ |
| POST `/runs` | `{strategy,seconds,interval,seed}` 开始同配置 30 终端负载 | EXECUTE |
| POST `/runs/{id}/strategy` | `{strategy}` 改后续请求策略 | EXECUTE |
| POST `/runs/{id}/stop` | 停止产生请求，既有任务排空 | EXECUTE |

后端固定配置 `platform.offload-lab.endpoint/namespace/token-file`；未配置返回 503，旧接口不受影响。实验内部服务使用本批共享令牌，仅实验 Docker 网络开放；Java 不转发任意地址/内部清理或任务写接口。

## 统计口径

- 单任务端到端：终端实际发出请求 `requestedAt` 至目的地结果保存 `finishedAt`。包括决策、上传排队、上传及附加时延、执行排队、启动、读取计算、结果保存；不含实验结束清理和控制器观察滞后。
- 保留 `scheduledAt`，用于检查模拟终端实际发送是否偏离计划。平均/P95按成功任务统计，必须同时报告失败/未完成，不能用成功子集代表完整收益。
- 批次跨度：全部终态后，从最早实际请求到最晚结束（失败取观察错误时间）；有未完成时为空。
- 图表区间累计：区间内完成任务的各自端到端耗时之和，不是折线面积，也不是并行批次跨度。
- 终端 CPU：各终端采样核秒/间隔之和 ÷ 已采样终端 CPU 总限额；内存：各自 cgroup memory.current 之和 ÷ 内存总限额。覆盖代理及本地执行子容器。图表 4 秒分箱，每终端取最近样本，不把缺失采样填零。
- 任务结果使用原振动统计 `features`：样本数/均值/RMS/峰值/窗口/异常窗口，可与模板参考值逐项核对。
