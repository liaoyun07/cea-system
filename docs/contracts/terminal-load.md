# TERM-LOAD-01 终端负载与调度

TERM-SIZE-01：终端本地文件描述允许1..1GiB（Agent和后端一致），仍只发送fileId/bytes元数据，实际读取/复制为流式。本批模拟网关使用磁盘暂存以支持500 MB；普通上传接口及Agent授权下载的64MiB上限未变。三个新固定位置策略、分块计算镜像和九组合实验见[说明](../../deploy/terminal-load/matrix/README.md)，不改变旧负载批次、DQN奖励或执行状态所有权。

脚本负责模拟资源创建；网关不访问Docker。现有Execution拥有任务状态。

终端每秒经网关上报资源组的CPU增量核秒、采样时长、内存字节和限额，同时领取负载指令；后端不新增到Agent的控制连接。发送器使用固定种子指数间隔，不等待任务完成再安排下一个请求；停止只停止新请求。Agent及其任务容器必须位于同一受限父cgroup。

负载配置选择已配置的应用策略对（本地FIXED TERMINAL / DQN），开始时固定Flow修订；每个请求在后端接收事务中绑定策略区间，复用原终端请求去重和Execution。任务状态从runtime查询，执行去向从offloading公开查询读取已启动的真实目标；无跨模块表查询。

端到端耗时由终端单调时钟测量，从发出请求前到获得最终结果；包含必要传输、排队、容器启动和结果查询。不含预热镜像下载。成功累计耗时是所选完成时间范围内成功请求耗时之和，失败/超时分开计数。DQN训练反馈的120秒界限不重写本页面的实际请求结果。

仅保留当前功能需要的负载批次、策略区间、请求计时关联、资源样本及终端最新读数。模拟终端数量不是额外物理算力；模型版本固定，不修改决策结果或自动训练。

## 接口与调用链

管理接口位于 `/api/namespaces/{namespace}/edge/load`：GET `profiles`、`devices`、`runs?limit&offset`、`runs/{id}?from&to`；POST `runs`、`runs/{id}/strategy`、`runs/{id}/stop`。开始需要 READ/WRITE/EXECUTE，切换/停止需要 EXECUTE，读取需要 READ。

机器接口位于 `/edge-access/terminals/{id}/load`：POST `resource`、`requests`、`report`，仅所属 CONNECT 网关可调用。终端调用网关 `/v1/load/...`，由网关令牌识别终端，不信任客户端提供的所属网关。

```text
页面开始 → TerminalLoadService 保存配置和固定策略修订
终端资源上报 → 网关 → 后端返回发送指令
终端随机到达 → 网关验证本地文件元数据 → 后端绑定当前策略区间
  → 原 EdgeAccessService 去重/提交 → 原 Execution/Worker
  → FIXED TERMINAL 或原 DQN → 原终端/集群 Runner
  → 结果返回终端 → 单调耗时报告 → 原执行结果校验后保存
页面查询 → edge 负载统计 + offloading 已启动位置 → 曲线/累计耗时/位置比例
```

一次请求只提交一次 Execution；策略切换不会改变已接收请求。停止后，客户端不再安排新请求，已接收请求继续完成。控制轮询期间遇停止的新请求可能被拒绝，记作 REJECTED，不伪装成算法失败或成功。客户端计时结束且原执行确已终止，才释放终端；UNKNOWN/TIMEOUT 本身不证明后台已结束。

## 数值口径

- CPU 利用率 = 父 cgroup 的 CPU 增量核秒 / 采样秒数 / 核额度 ×100%。内存利用率 = `memory.current` / `memory.max` ×100%，含本资源组缓存，不是共享宿主机占用或只统计 Agent。
- 多终端 CPU/内存按总容量加权；缺失、过期样本不补零。Agent、发送器和任务容器计入；专用共享 Docker 引擎、网关及宿主机内核未分摊到各终端。
- 耗时曲线每个点为一个成功请求，横轴为后端收到完成报告的时刻，纵轴为终端单调实测耗时。区间累计为这些点之和，并行时可大于区间墙钟长度；不是曲线积分。
- 执行位置根据已实际启动的资源分配记录，按请求冻结策略分组。不将未启动请求、失败的分配意向算作已执行去向。
- 失败/超时/拒绝/未确认均保留，不纳入成功累计耗时。只读页面过滤不改变原记录。

## 存储与模块边界

V33 给 `edge_terminal` 增加最新资源 JSON、采样时间、当前负载占用；新增 `edge_load_run`（配置/启停）、`edge_load_phase`（切换区间）、`edge_load_request`（请求与 Execution/耗时）、`edge_load_sample`（趋势历史）。所有写入归 platform-edge；runtime 仍是执行状态的唯一所有者。Controller 通过两个公开服务组合查询，不跨模块读表。

后端网关传输连接可按 namespace/CONNECT principal 配置，已登记终端复用其所属网关路由；旧逐终端连接优先，保持原行为。无新 Queue、Executor、Worker、任务重试或通用工作流语义，因此不涉及新增 Kestra 执行模型。
