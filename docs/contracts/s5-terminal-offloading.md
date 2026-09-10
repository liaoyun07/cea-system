# S5-04b 显式终端卸载、容量队列与反馈

仅作用于原本在终端执行且作者显式允许卸载的Application。不是所有终端请求、所有子任务或普通CLUSTER都使用DQN。设计与Kestra边界对照见[ADR-0016](../decisions/ADR-0016-terminal-offloading.md)，[Flow示例](../../examples/s5-offloading-flow.yaml)，[训练步骤](../../algorithms/offloading/README.md)。

## DSL与执行链

```yaml
container:
  applicationId: shell-tools
  version: v1
  execution: TERMINAL
  offload:
    strategy: RULE
    candidateClusters: [edge-a, cloud]
```

这是片段，完整命令/参数/产物见示例。候选集群也可以使用现有INPUT/VARIABLE/TASK_OUTPUT/LITERAL/ITEM Binding；不新增表达式或参数映射。DQN另要求`modelVersion`，RULE禁止携带无消费者的模型版本。无offload的TERMINAL必须本地执行；CLUSTER禁止offload。终端来源来自已接受的网关提交回执，不能通过普通执行API或DSL伪造。

主链仍是提交→Executor→Worker→ApplicationTaskRunner→DockerTaskRunner/KubernetesJobRunner→持久结果→Executor归并。只有Application适配器在准备时增加公开服务调用：获取合法候选→冻结决策→容量准入→准备镜像/文件→执行→释放容量和记录观测。所有Application可贡献画像，普通选址没有strategy/state/action，不作为策略训练样本。

同一个TaskRun/Attempt的首次决策持久保存，Worker接管不重选、不新建业务Attempt。真实失败由原retry策略产生下一Attempt并可重新决策。取消等待者直接退出FIFO；运行者确认远端停止后释放槽。失联不能假定停止，也不盲目重投，没有终端离线恢复ACK。

## 终端配置与队列

```yaml
platform:
  jobs:
    terminals:
      lab:
        terminal-pc:
          docker-context: cea-terminal-pc
          slots: 1
```

slots默认1、范围1..100。替换04a的字符串配置，所有Worker统一配置并排空后升级；不兼容双格式。Docker连接/凭据仍由管理员管理，详见[终端Docker协议](s5-terminal-docker.md)。V14/V15仅迁移新后端库，不修改旧系统。

终端FIFO以namespace+terminal划分，sequence_no是入队顺序；admitted表示已占平台槽，released表示释放或取消。锁既有网关资源行，限制跨Worker并发；不是CPU/内存的物理预约。等待占用一个Worker执行槽，尚无独立无阻塞派发器。远程仍使用原平台Job槽轮询，不新增远程FIFO，远程waiting特征目前为0。所有Worker须使用同一终端slots配置。

## 候选、规则与状态

终端需可信context可连接、所属网关集群满足数据本地性；边缘/云需管理员连接配置、目录允许、本地数据与Ready可调度节点。繁忙不等于不可用，可排队。决策是当前快照，不能保证目标随后不会离线；选定后不偷偷迁移到其他目标。

规则分数越小越优：`load=(active+waiting)/capacity`；已有相近画像时为`log1p(serviceMs/1000)+load`，冷启动为load。它是归一化成本启发式，不是预测完成时间的毫秒值。无画像不编造耗时，可能优先探索未画像的位置；同分依次终端、边缘、云，同层按ID稳定排序。每一层先按规则选一个代表位置，再由网络选择层，因此支持任意候选集群数量，但不宣称网络直接选择每一台集群。

动作0/1/2为TERMINAL/EDGE/CLOUD。状态schema为`terminal-slot-cost-v1`，共13维：

| 特征 | 计算与消费者 |
|---|---|
| 0：任务输入量 | min(1, log1p(bytes)/log1p(1TiB))；网络任务规模 |
| 每层第1项 | 是否有合法代表位置，0/1；同时作为动作mask |
| 每层第2项 | min(1, (active+waiting)/(4*capacity))；已预约和排队负载 |
| 每层第3项 | min(1, log1p(serviceMs/1000)/log1p(3600))，缺画像为0 |
| 每层第4项 | 是否有画像，0/1；区别未知和零成本 |

字节通过S3 HEAD读取，不接受调用者声明的估算数字。卸载决策前的数据集尺寸用版本首个登记位置的对象作为估计；不同位置数据大小不同时可能影响决策质量。选址后重新按实际选中的数据集和命名输入对象记录inputBytes；未准入样本的inputBytes只是估计，不进入画像/训练。集合清单本身不计入业务对象字节。对象应在一次执行期间保持不变；当前不是存储快照或S5-05数据速率计量。

## 画像、时间与模型

画像按namespace、Application ID/version、实际command/参数、目标kind/id分组，再取输入量在本次0.5..2倍范围内的最近100次成功观测均值。Flow名字不作为画像基准，不把不同应用版本或命令混用。应用参数含数据集版本，自然隔离不同数据集配置。

createdAt是决策/观测入库时间；startedAt在容量准入且实际文件选择/尺寸读取后、镜像准备前写入；finishedAt在实际结果确认后写入，均用同一数据库时钟。服务耗时包含镜像准备、传输、容器启动/运行/输出发布，不是算法内纯计算时间。普通CLUSTER的观测在选址准入后创建，不能从它推断排队耗时。

卸载reward使用createdAt→finishedAt：成功`-min(9,log1p(seconds))`，已启动失败-10，取消/未启动无reward。finish仅首次生效，接管/重复反馈不重复累积。失败/取消不进入成功时延画像。

注册模型为13→1..128隐藏节点ReLU→3输出的有限权重网络；Python训练器使用16隐藏节点。三动作Q值经不可用mask选择。注册版本不可覆盖，缺版本/坏模型失败而非RULE回退。普通任务虽有实际画像，但没有决策state/action，不训练策略。

当前每次选择是一个结束的episode，训练拟合实际reward；属于单步Q-learning/contextual bandit简化，不是多步DQN长期拥塞预测，没有伪造next_state/反事实回报。没有在线探索、自动训练发布、跨工作负载泛化保证或优于规则的实验结论。三个动作各有真实样本才允许训练；这些限制不因端到端功能通过而消失。

## API、表和字段消费者

- PUT/GET `/api/namespaces/{namespace}/offloading/models/{version}`：WRITE注册、READ查询；模型shape/schema/权重用于真实推断。
- GET `/api/namespaces/{namespace}/offloading/samples?limit=100&offset=0`：READ分页导出；供离线训练和审计。CONNECT网关不能调用这些管理API。
- V14 `res_terminal_reservation`归resource：Attempt键防重入；sequence_no/FIFO、admitted/容量、released/终态防复活均有准入/释放消费者。
- V15 `off_task_observation`归offloading：应用/命令/参数/字节/目标用于画像；strategy/model/state/action用于真实训练与决策审计；三个时间和outcome用于时延/reward。executionId用于关联原结果，不复制Execution状态。
- V15 `off_dqn_model`归offloading：namespace/version定位不可覆盖权重，model_json供推断。没有新Execution表、hash、Binding或Runner/SPI。

实测边界见[验收记录](../verification/VER-S5-006-terminal-offloading.md)。单机隔离Docker/K3s验证不能代替物理终端SSH、多云网络或策略性能对比。
