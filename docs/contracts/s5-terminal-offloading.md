# OFF-01：终端卸载选层与 Placement

2026-09-14 开始按四步方案实施；本批只做第 1 步，验证/发布状态见[验收记录](../verification/VER-OFF-001-layer-placement.md)。原 S5-04b 的单步 Q 训练结果是历史事实，不等于当前 Double DQN 能力。

## DSL 与范围

```yaml
container:
  applicationId: shell-tools
  version: v1
  execution: TERMINAL
  offload: {strategy: RULE}
  command: [sh, -c, 'echo hello > /cea-work/out/result.txt']
  outputFiles: [result.txt]
```

- 只有原属终端且显式声明 offload 的 Application 才选层。固定 TERMINAL 和普通 CLUSTER 不访问卸载观测。
- 删除 offload.candidateClusters，旧写法校验失败，不自动改写为云范围。普通 container.candidateClusters 及其现有 Binding 不变。
- 当前仅 RULE 可执行；DQN（即使已登记旧模型）校验失败，不静默回退。modelVersion 只保留历史结构读取，RULE 禁止设置。模型登记/查询暂保留，旧网络不参与新决策；第 4 步替换为 Double DQN。
- Flow 不能指定任意终端。可信 execution origin 提供 terminalId、clusterId；来源验证和管理员 Docker context 配置仍由既有接入链提供。

## 模块与调用链

```text
普通 CLUSTER → 原候选 Binding → JobPlacementService → KubernetesJobRunner
固定 TERMINAL → 可信 origin → 原终端 FIFO → DockerTaskRunner

TERMINAL + offload
  → Resource 查询各层合法容量/占用
  → OffloadingService：只选 TERMINAL / EDGE / CLOUD，冻结到 Attempt
  → TERMINAL：原终端 FIFO
  → EDGE/CLOUD：Resource 给出该层范围 → 原 JobPlacementService 选 cluster
  → 记录已预约的实际位置 → 原镜像/文件准备 → 原 Runner
  → 原 Worker/Executor 归并结果；资源按实际预约释放
```

Offloading.Candidate 只有 layer、capacity、active、waiting，没有任何 cluster/terminal ID。多个云集群的合法容量、占用相加后进入 RULE。卸载不能先挑“代表集群”，不能使用样本 target.id 决定执行位置。

EDGE 目前是来源终端所属的一个 edge cluster。CLOUD 由以下服务端配置限定：

```yaml
platform:
  jobs:
    central-clouds:
      lab: [cloud-a, cloud-b]
    terminals:
      lab:
        terminal-pc:
          docker-context: cea-terminal-pc
          slots: 1
```

未配置中心云范围时没有 CLOUD 候选；不得自动取所有登记集群。配置中的集群必须为 CLOUD。Resource 继续校验启用、连接、Ready、数据集位置与槽位。普通 CLUSTER 不受 central-clouds 限制。所有 Worker 必须使用同一份范围/容量配置，变更前排空任务。

## RULE 与持久化

RULE 分数为层总 (active + waiting) / capacity，越小越优，同分 TERMINAL → EDGE → CLOUD。这里只是实际平台槽位的基线规则，不是 CPU 负载或预测完成时间。集群 waiting 仍沿用原实现的 0（未采集），不可将其作为第 3 步的真实排队状态；终端 waiting 来自原 FIFO。旧按具体位置的历史时延评分/estimate 查询删除。

同一 TaskRun/Attempt 的首次层选择持久保存，不因槽位繁忙而改层。Placement 在所选层内择可用 cluster；都忙时仍在该 Attempt 等待。接管重用真实预约及 Prepared；无新 Executor/Worker/Binding/Runner/SPI，也无新 Execution 状态。

V25 只将 off_task_observation.target_id 改为 nullable：
- 决策已做但尚未预约时：target.kind 是选定层，target.id=null；页面显示“未分配”（预约前取消也不会误显示为仍在等待）。
- 预约成功后：placed 写入实际 terminal/cluster ID，必须匹配原层，重复反馈同位置幂等，不可改到另一位置。
- 原历史行不删、不改值。位置只用于审计，资源释放仍依据 Prepared/实际预约，观测缺失不能支配普通任务回收。

createdAt/startedAt/finishedAt 仍是服务端原决策/镜像准备前/结果确认的时间。成功旧服务 reward 为 -min(9,log1p(seconds))，已启动失败 -10，取消和未启动不返回 reward。它不包含终端发起请求至取得结果的完整链，不能冒充第 3 步端到端时延。新记录不构造旧 13 维 state，state/modelVersion=null，不能送进旧训练器。

## 本批未实现

终端元数据先请求、通过网关派发、原始文件本地不上传、真实六维工作量/传输估计、乱序完成样本关联、边缘 Double DQN 和五基线性能对比均属于 OFF-02～04。本批仍是已有 Worker/Docker/Kubernetes 执行适配，不能以三种容器跑通就宣称新的网关/终端闭环完成。S5-05 数据速率继续后置。

发布前排空执行并检查没有依赖旧 offload.candidateClusters 的保存流程/执行快照；若存在，停止发布并单独处理，不能悄悄改历史。备份数据库后执行 V25，只更新受影响前后端。

决策依据见 [ADR-0025](../decisions/ADR-0025-offloading-layer-placement.md)；历史实现见 [S5-04b](../verification/VER-S5-006-terminal-offloading.md) 与 [S5-04c](../verification/VER-S5-007-offloading-decoupling.md)。
