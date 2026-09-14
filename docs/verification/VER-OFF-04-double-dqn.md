# VER-OFF-04：边缘Double DQN

2026-09-14，源码基线485c9ea + 本批差异（最终提交见进度/Git）。范围：[OFF-04](../features/OFF-04-double-dqn.md)，计算：[协议](../contracts/off04-double-dqn.md)。以下人工单元fixture与实际CEA试验严格分开。

## 自动化测试

- JDK21（IntelliJ JBR21）/Maven：`scripts/verify.ps1` 19:59:04完成，255项PASS（runtime35、server219、打包启动1），0失败/错误/跳过。真实MySQL、Registry、K3s、终端Docker/网关集成；含故障注入，所以日志中的断连/迁移失败提示不单独代表测试失败。
- ImageDistributionTest的48项中，扩展真实网关路径用数值fixture分别选TERMINAL/EDGE/CLOUD并验证原Runner及结果；未标定DQN失败且不写假决策，终端Bearer访问内部decide为401。原本地不上传、跨层文件、重试、接管和取消回归保持。
- OffloadingTest24项：六维校验、历史13维只读/拒绝新登记、状态缺测/混合画像及合法动作边界等。Definition/Contract/Architecture验证DSL、OpenAPI及原模块依赖。
- Python：gateway21项、trainer/统计9项，共30项PASS。实际Bellman数值、在线argmax/目标Q、合法动作、回放/target同步、next引用一致性、批次尾部、失败/缺测分母。
- 前端52项Node、60项真实浏览器回归PASS；构建、Prettier和结构检查通过。新增DQN详情固定模型显示和Schema参数验证；未变更No-code数据源或执行链。
- 曾遇到统计单测用sys.modules整表mock导致PyTorch二次导入失败，已改为按实际需要在main内加载终端客户端；最终9项全过。没有屏蔽该用例。

## CEA发布

20:04:32发布backend/frontend/edge-gateway（网关镜像off04-v1），仍19个常驻服务，无新基础设施/权限/DB migration。原镜像保留before-off04标签、私有网关配置有备份；新增研究事件只加入已受信网关的允许列表。数据库、四K3s、四Registry、终端agent/engine和存储不重启。

原20条Execution、10条观测、2个Dataset、原Flow/7个策略及16个无关服务保留。发布脚本初次比较发现4个策略响应多出`flow.definition.tasks[0].container.offload.exploration=null`；逐字段比对确认仅为新增可选字段的序列化差异，源文/修订未变。校验仅归一化该RULE/FIXED默认null，不忽略source、revision、观测或其他变化；重新校验PASS。没有为了通过比较而回写旧对象。

本地证据：`.local/off04-verify.log`、`frontend/.local/off04-*.log`、`.local/cea/off04/before.json`、`release.json`、`after.json`。仅去敏汇总进入Git；私有配置、原始回执、模型及业务身份不上传。

## 固定实验计划与真实训练

`run-offloading-dqn.ps1`只运行一次，runId `fa015933-97ea-416c-9dde-f50072cb606c`，证据目录 `.local/cea/off04/pilot-20260914-120636/`。先写plan.json，再发请求，未根据结果更改负载/训练次数或挑最好一轮。

- 同一`offload-signal/off02-v1`振动窗口特征/阈值算法；数据明确为合成信号，不是实测工业数据或FedAvg。原文件分别重复1/4/16倍，实际1,507,314 / 6,029,256 / 24,117,024字节。均值、RMS、峰值和窗口/告警数量逐请求与独立参考值核对。
- 终端模拟客户端经真实网关元数据请求；选本地不上传原文件，边缘/云走既有上传/公共助手/原Runner。同机Docker模拟三层，不是物理多云。
- 六个专用策略off04-terminal/edge/cloud/rule/train/dqn，保留原策略及原next链；训练探索epsilon=1，评估epsilon=0。原资源配置不调整：终端1、edge-a1、cloud2受控执行槽，任务资源限制与原策略相同。
- 固定6次暖机（每层2次），48次探索，评估每方法12次、共60次。每组2个请求相隔0.25秒，整组完成后发下一组；各方法文件顺序1/4/16/1/16/4相同。不是固定RPS或相同绝对到达时刻回放。
- 两轮方法顺序预先固定（seed29）：RULE/CLOUD/EDGE/TERMINAL/DQN，再DQN/RULE/EDGE/CLOUD/TERMINAL。训练seed17，1000更新，未用评估数据调参。
- 探索48/48成功，47条实际完整转移；最后1条截断排除。完整动作分布终端13/边缘22/云12。6→32→3网络、batch32、gamma0.95、目标同步20次。训练loss首0.095059、末0.033038，**这不等于时延收益**。
- 已登记不可变模型`off04-trained-fa015933`，其余评估请求不参与训练。原始训练样本、report、model均保留本地。

## 比较结果

114次请求全部完成（暖机6、探索48、比较60），均成功且计量完整。比较集每方法12次，训练/评估执行ID不重合；均值仅成功完整记录，P95=nearest-rank，因此n=12时实际为该方法最大值，不代表稳定尾延迟估计。

| 方法 | 成功/提交 | 平均端到端秒 | P95秒 | 实际终端/边缘/云次数 |
|---|---:|---:|---:|---|
| 全TERMINAL | 12/12 | 2.207007 | 2.462484 | 12 / 0 / 0 |
| 全EDGE | 12/12 | 8.058287 | 11.151276 | 0 / 12 / 0 |
| 全CLOUD | 12/12 | 5.627761 | 5.825042 | 0 / 0 / 12 |
| RULE | 12/12 | 4.057877 | 6.453856 | 6 / 6 / 0 |
| Double DQN | 12/12 | 4.005356 | 6.472056 | 6 / 0 / 6 |

全终端在本次轻量计算/低并发/同宿主环境下更快。DQN平均值与RULE很接近，P95略高；既未优于全终端，也不能凭12个样本和约0.05秒均值差宣称优化收益。没有调整资源、奖励、负载或追加训练来挑选更好结果。该表验证比较闭环，不是性能优化通过。

发布后最终校验：CEA现134条Execution/124条观测，原20/10条及所有原Flow/策略/数据集保持，其他16服务ID/镜像/启动时间不变；资源未完成量台账0。实际18080桌面/650px页面可见模型版本、目标层、六个原始值、端到端时长；逐值与API一致，并以独立JavaScript前向计算复核全部12个DQN评估动作等于固定模型的合法argmax。API/页面/数值检查PASS，截图已人工查看。

本地证据补充：`comparison.json`、`training-samples.json`、`training-report.json`、`trained-model.json`、`requests.json`、`evaluation-samples.json`及每请求回执；`.local/cea/off04/browser.json`、`dqn-desktop.png`、`dqn-narrow.png`和`after.json`。主动实验脚本会创建数据，页面验证脚本只读，不混用。

## 限制与未做

当前六维为同画像输入量/未完成量及近期传输估计，是近似观测，不证明完全马尔可夫性；没有能耗/成本/多核状态、在线持续训练或自动模型晋升。实验为小样本闭环到达，两轮顺序不能消除全部缓存/同宿主争用/非平稳传输估计影响。结果计时含容器冷暖、排队、文件、计算、0.5秒轮询和回传，不能改成仅网络推理时间来宣称30ms。

原Executor/Worker/Binding/Retry状态所有权不变；边缘推理是项目业务差异，不声称Kestra提供此DQN。此次没有正式30ms、多云优化优势或2GB/s验收。
