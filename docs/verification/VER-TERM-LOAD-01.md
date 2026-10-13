# VER-TERM-LOAD-01 终端负载与调度

日期：2026-10-13。源码：本记录所在 TERM-LOAD-01 提交；基底 `f8e39349ea7d61012250fc154e792154829b5b34`。同工作区已有联邦实验修改未纳入本批。系统：Windows、Docker Desktop Linux/cgroup v2、JDK 21.0.12、CEA 四集群共享宿主机。结论：核心功能和本批实际联调通过；不宣称资源/时延提升门槛通过。

## 变更与发布

- 新页面位于终端设备接入，提供设备资源、负载启停、策略切换、逐任务端到端耗时、区间累计、真实去向。
- 用户明确授权新增 `cea-terminal-load-engine` 与 `cea-terminal-load-gateway`。前者专用 DinD、Docker 仅 Unix socket；后者不访问 Docker。创建 4 个 `sim-terminal-001..004`，每个父 cgroup 0.5 CPU / 512 MiB，Agent 与所属任务共同占用，swap=0。
- 仅发布受影响的 CEA backend/frontend；旧终端/网关/集群不重建。V33 从当前 V31 升级成功（共 32 个版本迁移记录，没有 V32）；数据库备份和原镜像保留。
- 新增 CONNECT 网关身份和仅允许本批四终端 ingress 前缀 Get/Put 的对象存储账号；没有扩大旧网关权限。新建四个负载/校准策略，当前 r2；旧策略、应用、数据和流程保持。
- 使用既有 `offload-signal/off02-v1` 及 `off04-trained-fa015933`，exploration=0；没有修改 DQN 选择、训练或算法镜像。

## 自动化

| 验证 | 实际结果 |
|---|---|
| JDK21 `scripts/verify.ps1` | PASS，2026-10-13 21:53 完成；36 runtime + 254 server 单测/集成 + 1 packaged JAR = 291，0 失败/错误/跳过 |
| `TerminalLoadTest`（包括在上述结果中） | 4 PASS：策略冻结/幂等、停止排空、所有权/结果核验、资源及权限 |
| Python `terminal-agent` 全量 discover | 17 PASS，含父 cgroup、到达随机序列、计时、停止和原 Agent/compute 回归 |
| Python `edge-gateway` 全量 discover | 21 PASS，含原网关文件/身份/反馈/DQN 回归 |
| 前端单测 / build | 62 PASS / PASS；最终图表字体、策略按钮和全部区间修改后重测 |
| 前端完整 Playwright | 86 PASS；原登记/编辑等回归。最终仅图表/区间小修改后用真实页面只读截图复核，不把早先 86 项称作最后一次重跑 |
| 真实 CEA 页面 | 开始→切换→停止→排空 PASS；桌面 1440 和窄屏 740 截图检查，无页面 JS 错误 |
| 结构检查 | PASS（verify 开始及最终文档检查） |

首次全量 verify 失败保留：V33 后迁移总数断言仍为 31、测试自行构建 Agent 镜像漏复制新 `load.py`，分别修正断言与测试上下文；并出现终端接管/取消及后续队列测试失败。没有因此放宽业务断言、增加超时或修改引擎；修正两处明确问题后全量重跑通过。其余首次失败不能仅凭重跑成功断言原因，完整日志仍保留。

## 真实负载

批次 `51b5fbef-86c4-43e2-8ceb-2021fc974af6`：4 终端、每台平均 8 秒指数到达、混合三规模、seed31；LOCAL 约 25 秒后切 DQN，再约 25 秒停止。各终端自主到达，不等待前一请求。

| 项目 | 结果 |
|---|---|
| 已接收任务 | 23 / 23 SUCCESS；每请求只有一个 Execution 和一个应用叶子 |
| 停止边界 | 1 次 HTTP409 REJECTED，无 Execution；保留在异常计数，不并入成功耗时 |
| 全终端阶段实际去向 | 12 TERMINAL |
| DQN 阶段实际去向 | 10 TERMINAL + 1 CLOUD；没有人为补齐 EDGE |
| 成功请求累计耗时 | 79.58 秒；为 23 个单调实测耗时之和，不是墙钟或曲线积分 |
| 资源样本 | 169；4 终端最终全部停止/排空/解除批次占用 |
| 另行路径校准 | 每终端 EDGE/CLOUD 各 1 次，共 8 SUCCESS；校准是传输记录准备，不是训练，也不混入 DQN 去向图 |

独立 `audit.py` 复核这 31 次实际执行，逐一读真实产物与对象存储：均值、RMS、峰值、窗口数和越阈窗口数与独立 `math.fsum` 参考一致（绝对误差 ≤1e-10）。TERMINAL 路径原文件没有上传；EDGE/CLOUD 路径恰好上传原字节到边缘存储，中心存储不强制另存原文件副本。小/中/大样本为 131072/524288/2097152。

`verify.mjs preserved` 对发布前快照逐项检查 PASS：81 个旧 Flow、旧策略、数据集不变；18 个非目标常驻服务的容器 ID/镜像/启动时间不变。前后端是预期更新对象。

## 诊断失败保留

1. 初期五个校准/诊断执行失败：本批策略错误声明 `cea-measurement.json`，而旧 `off02-v1` 只输出 `result.json`；仅修本批策略到 r2。没有改旧镜像/SDK，r1 和失败历史保留。
2. 先前负载 `7b0cc21b-2dce-442b-881b-1ad8a532aa64` 的 13 个 LOCAL 请求超时、11 个 DQN CLOUD 成功；根因为新模拟 Agent 的存储允许主机仅含名字，实际存储授权 URL 使用数字 IP。计算容器退出 0 后，输出上传被拒。补本批配置中对应 MinIO IP，排空后只重启 4 个新 Agent；旧 Agent 不改。
3. 以上不是最终成功批次的样本，也没有删除/覆盖成成功。它们用于联调故障定位，不作为策略性能对照。

## 证据与边界

本地 `.local/cea/terminal-load/` 保存 `before.json`、`database-before.sql`、`preserved.json`、`test-result.json`、两个 `run-<id>.json`、`output-audit.json`、校准回执、三个页面 PNG。日志为 `.local/cea/terminal-load-verify{,-final}.log`、`frontend/.local/terminal-load-e2e.log`。这些目录还含私密配置，均不提交。操作和复核命令见[脚本说明](../../deploy/terminal-load/README.md)。

本批未测试几十台满载、未实施能耗、未训练适配新终端资源的 DQN。资源指标为模拟终端父 cgroup 的真实采样，含 Agent/发送器/应用和该组缓存，不含共享执行引擎、网关、宿主内核。只完成接入与展示，不把这次中途切换、任务数不同的联调当作相同轨迹配对性能实验；CPU/内存各降低25%与计算时延降低40%仍未验收。
