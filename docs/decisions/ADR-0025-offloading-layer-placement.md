# ADR-0025：卸载选层与资源 Placement 分离

状态：2026-09-14，用户授权四步实施；OFF-01 已验收并发布 CEA，见[记录](../verification/VER-OFF-001-layer-placement.md)。OFF-02～04 未完成。

## 决定与最小边界

原链：Application → Offloading 挑每层代表 cluster → RULE/单步 Q 选代表 → Placement 预约单一 cluster → Runner。

新链：Application → Resource 汇总合法层负载 → Offloading 只冻结 TERMINAL/EDGE/CLOUD → Resource 确定该层资源范围 → 原 Placement 选择并预约 cluster → 原 Runner。

- Offloading 候选不再包含 cluster/terminal ID；RULE 只比较各层 `(active + waiting) / capacity`，同分按终端、边缘、云。仅作路径验证基线，不是完成时间预测。
- TERMINAL 身份仍来自可信 execution origin。EDGE 仅限 origin.clusterId；当前一个归属边缘集群，不提前创建边缘域表。CLOUD 仅限管理员 `platform.jobs.central-clouds.<namespace>` 配置；未配置即不提供云动作，不能扫描所有集群补齐。
- 删除 `offload.candidateClusters`。普通 `container.candidateClusters`、Binding、Executor/Worker、重试/取消和资源租约不变。
- 每个 Attempt 先持久化层决策，再预约位置。V25 只使既有 observation.target_id 可空：决策阶段没有具体位置；预约后写入实际位置，供审计。该值不是 Placement 的依据，也不是资源释放依据。
- 同一 Attempt 不重选层。选定层繁忙就等待原预约；不可用就按原错误语义处理，不偷偷跨层回退。Worker 接管复用原预约和 Prepared。
- 暂停新 DQN 决策；保留旧模型登记/查询、历史观测及离线研究文件，但不执行旧 13 维单步 Q，也不把层聚合数据套入旧模型。第 4 步统一替换。历史观测的服务时间/reward 不是第 3 步的终端端到端反馈。

没有新增表、执行状态、Runner、SPI 或独立调度器。新增 central-clouds 的生产消费者是 JobPlacementService 的云层范围校验；没有配置它时不得执行云层卸载。观测新增“位置待定”来自真实的先决策后预约过程，不制造虚拟 cluster。

## 四个验收批次

1. OFF-01：本 ADR 的职责拆分、DSL/schema/配置、真实 Placement 和普通 Flow 回归、发布。
2. OFF-02：元数据先行的终端请求，经网关代理；终端 Agent/Docker、本地文件不上传、边缘/云按需上传、三路径结果返回。不能用目前中心 Worker 直连 Docker 冒充新终端链。
3. OFF-03：真实六维采集、工作量预约、传输估计、终端端到端时间、按决策序列拼接 next_state 与乱序完成反馈；不使用 S5-05 数据速率 SDK 代替。
4. OFF-04：边缘侧 Double DQN、replay/target network/Bellman target，同工作负载五基线比较均值/P95/成功率。

第 2～4 步本批不实现，不提前添加状态字段、服务或表；新增基础设施按发布约定另行确认。

## 参考

2026-09-14 核对 [Kestra Server Components](https://kestra.io/docs/architecture/server-components)：Executor 持有执行推进职责，Worker/Task Runner 执行任务。本项目沿用既有单执行链；终端归属和卸载选层是云边端业务差异，并非 Kestra 原生功能。本批不改通用执行状态所有权。
