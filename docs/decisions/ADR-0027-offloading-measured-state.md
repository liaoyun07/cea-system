# ADR-0027：OFF-03真实六维观测与延迟反馈

状态：ACCEPTED / 已实现并于2026-09-14发布CEA；用户授权第3步，测试后按持续授权发布。仅复用现有服务，不部署DQN。[验证记录](../verification/VER-OFF-03-measured-feedback.md)。

## 采用的定义

`s=[D,Q_L,Q_E,Q_C,T_E,T_C]`：D与三个Q为MiB，两个T为秒；网络输入为逐项log1p。Q是已选层、尚未完成或确认停止的业务输入总量，不随时间虚减，不是CPU周期或精确等待时间。只在同类算法、参数、文件格式及固定资源下使用；首版研究采样限单任务、无自动重试、可信网关来源、单个原始文件、一个所属边缘及一个配置中心云。普通Flow的执行功能不受此采样边界限制。

Resource持有工作量台账，与层决策在同一数据库事务内增加一次，覆盖等待上传/位置及运行。取消只有原Runner确认后才释放；Worker接管不重复计入。Resource活动预约中含未计量工作或混合算法时状态标为不完整，不把未知填0。不会探测平台外的任务或把常驻服务CPU占用折算成MiB；研究工作负载需要控制资源配置。Offloading只读公开资源快照，不自己维护资源释放权。

传输速率为同一路径最近20次成功完整传输的总字节/总秒。网关计终端读取至边缘S3 PUT完成；files-in计对象GET至容器文件就绪（含该次实际重试等待），不计Pod启动。T_E/T_C各为终端到边缘阶段加对应Pod下载阶段，不能重复计网关写入、不能假设同云下载为0。首批无记录仅固定/RULE标定，状态不完整；失败或缺报告不造速率。Pod报告通过已有容器终止消息返回Worker，不增加算法SDK/网络回调凭据。

终端使用同一进程的perf_counter_ns，在POST compute之前到已收到并解析约定结果后计时，再发送原Execution反馈；进程重启无法延续单调时钟时标记缺失，不拼接伪时长。成功且未超过示例120秒阈值，reward=-elapsed/120；失败或超时=-2；人工取消无训练奖励。阈值是本批示例配置，不是30ms验收。反馈缺失不改变原Execution结果。

同一所属边缘、策略和算法配置按数据库串行决策顺序关联：B决策固定后，A.next指向B，读取B的不可变状态/合法动作。A的结果迟到只补A，重复同值幂等、冲突拒绝。首版连续流没有虚构episode结束，尾项无next不能训练；显式实验批次关闭及Double DQN属于OFF-04。当前完整样本读取/界面及验收是新增状态字段的消费者。

## 最小结构与消费者

- Resource新增工作量台账：allocation键、层/范围/来源、真实输入字节、算法配置、released；供决策时Q聚合/混合负载识别和真实释放。不是第二套任务队列。
- Resource新增传输事实：Attempt+阶段+文件去重、路径、bytes、seconds、序号；供最近20次速率及T估计。
- 既有off_task_observation增加可信来源/策略、原始六维/合法动作/缺失原因、决策顺序与next关联、终端耗时/阈值/结果/reward；不转换旧13维样本。
- Dataflow集中适配上述服务；runtime仍只管理Execution/TaskRun/Attempt。文件助手只报有界传输事实，算法镜像不改。

## 依据与差异

参考[Tang作者train.py](https://github.com/mingt2019/Deep-Q-learning-for-mobile-edge-computing/blob/main/train.py)的负时延/超时惩罚和延迟奖励关联；参考[SMCoEdge环境](https://github.com/ChangfuXu/SMCoEdge/blob/main/environment.py)的工作量队列骨架。2026-09-14核查官方作者仓库。真实MiB台账、传输实测、按决策事件而非仿真时隙关联是本项目适配，不宣称严格完备MDP或已训练DQN。[Kestra组件边界](https://kestra.io/docs/architecture/server-components)继续用于Executor/Worker职责，不增加研究专用执行器。
