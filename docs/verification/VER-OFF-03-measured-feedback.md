# VER-OFF-03：真实状态、传输估计与延迟反馈

2026-09-14，OFF四步计划第3步；基线提交`18a8f56df12ae8900c1a3d54b0cf5f1b7dd9fbcf`及本批工作树。结论：范围内实现、测试、CEA发布和实际数据/页面核验PASS；Double DQN、五基线比较及正式性能验收未实施。

## 实际变更与边界

原链仍为终端→网关→EdgeAccess→FlowExecutionService→Executor→Worker→ApplicationTaskRunner→原Runner。沿Kestra已核查的Executor/Worker状态所有权，不新增研究专用执行器。本项目新增的是云边端工作量、传输与终端反馈适配，不声称Kestra自带本方案。

- 新增3份生产Java：Resource的`WorkloadLedger`、`TransferMeasurements`及Dataflow的`OffloadingTaskAdapter`。没有删除生产类、新增SPI或算法SDK，runtime仍不依赖platform模块。
- V26新增`res_offload_workload`、`res_file_transfer`；V27给既有卸载观测添加六维、来源、决策序、next和反馈列。现有单步Q历史不转换，旧观测measurement=null。
- 新增1个受原CONNECT来源授权的反馈API；已有样本查询/前端展示扩充。当前108份生产Java、92个HTTP操作、28张业务表。
- 状态、公式、每个数据库字段消费者及有意简化见[协议](../contracts/off03-measurement.md)、[ADR-0027](../decisions/ADR-0027-offloading-measured-state.md)和[Java索引](../01-code-architecture.md)。

## 自动化验证

环境：Windows、JDK21、Maven、Node24、Docker Desktop；后端集成测试使用隔离MySQL/Registry/K3s/MinIO和终端引擎，不以mock结果替代真实执行。

| 检查 | 本批实际结果 |
|---|---|
| 完整`verify.ps1` | 17:58:42 PASS；runtime35、server215、实际JAR启动1，共251项，0失败/错误/跳过，16分10秒 |
| 最终定向`mvn verify` | 18:03:01 PASS，共28项：卸载22、协议3、架构1、网关真实三路径1、实际JAR启动1；3分21秒 |
| 前端Node | 52项PASS；构建、格式检查PASS |
| 前端Playwright | 隔离真实后端与容器环境59项PASS，3.6分钟 |
| Python | 网关17、终端agent/compute11、公共助手10、信号算法3，共41项PASS |
| 结构/链接/差异 | 8模块、108份生产Java、32个领域功能ID；本地链接、语法、格式和diff检查PASS |

完整回归之后，最终适配器移除计量回调额外源S3 HEAD，改用物化时已核验的实际单文件大小，并追加等待槽位/报告校验两项测试。最终28项定向验证覆盖最新生产修改，包含真实三路径及JAR启动；没有把251与28相加冒充一轮全量279项，也没有声称新增两项之后重跑了全量253项。

覆盖行为：同事务接纳/Q快照、等待位置仍计Q、同Attempt接管不加倍、混合配置及未计量预约不补0、确认停止才释放、原取消/重试/恢复链、正数传输报告及去重、最近20次速率、下一状态决策序、反馈乱序/同值重复/冲突拒绝、错误来源拒绝、客户端重启缺测/丢ACK重传和超时不提前释放。首轮完整回归仅旧migration数量断言仍为25而失败，更新为实际27后全量重测通过；失败记录保留，不带失败发布。

## CEA真实六次请求

发布后使用既有终端、网关、四个卸载策略及相同`offload-signal/off02-v1`镜像，未修改算法、Flow、策略或槽位。基础文件1,507,314字节（1.4374866485595703MiB），131072采样点；大文件是明确标注的44段重复合成信号，共66,321,816字节（63.249412536621094MiB）。它用于制造真实未完成工作量和完成乱序，不是实测工业数据或性能基准；算法逐点处理，没有人为sleep。

| 用例 | Execution ID | 实际层 | 终端端到端秒 | 结果 |
|---|---|---|---:|---|
| 标定边缘 | `1794a46b-c8ce-4b46-8f9b-67316f402e97` | EDGE | 7.449052057 | SUCCESS |
| 标定云 | `a4fb4c7a-fef7-4164-ad49-a427728a5d64` | CLOUD | 6.619093814 | SUCCESS |
| RULE第1次 | `55ff2228-555e-4a0d-b12d-8bd84813900f` | TERMINAL | 1.781018864 | SUCCESS |
| RULE第2次 | `df1ecc08-2554-4b9d-94e0-67a985303f58` | TERMINAL | 1.800399820 | SUCCESS |
| 并发大文件 | `a7e124f1-2ac1-429a-86fa-6d0f7b7976dc` | CLOUD | 8.637961838 | SUCCESS |
| 并发小文件 | `81b11e04-cffe-444b-a345-3619cd3cef8d` | CLOUD | 6.578332856 | SUCCESS |

实测断言均通过：

1. 每个结果的采样/窗口/告警数、均值、RMS、峰值与独立参考数值相符；大文件计数正确乘44。两次本地执行没有原始文件上传/传输事实，四次远端执行各有两段真实传输，共8条，字节数准确、耗时为正。
2. 标定后的首次RULE状态TE=0.0599290885秒、TC=0.0598302805秒，与此前实际传输记录按协议公式独立计算一致。六维完整时逐项log1p一致；首次标定缺少历史的状态不后补。
3. 使用原cloud的2个槽位，小请求决策时大请求尚未完成，原始六维为`[1.4374866485595703,0,0,63.249412536621094,0.024817623217391303,0.024718815217391304]`。QC包含大请求的全部已接纳未完成字节，没有按时间虚减或把在运行工作当0。
4. 小请求实际先完成；大请求的next仍为小请求的样本`29bb2d60-5303-422e-a4e3-816fffd2dbd2-1`，而非按完成顺序重连。RULE第1→第2关联也正确；连续流末项无next、trainable=false，没有虚构终止状态。
5. 六个原始客户端回执的elapsed与平台一致，反馈全部确认；成功reward均为`-elapsed/120`。最终未释放工作量0，普通Execution结果不被反馈覆盖。

主动验收脚本为[verify-offloading-measurement.mjs](../../deploy/cea/verify-offloading-measurement.mjs)，会产生新请求；日常查看不必运行。此次六请求运行成功后，存量比较脚本初次将`.193120Z`与`.19312Z`当作不同时间而报错；修正为保留微秒意义的末尾零规范化后，对**同六条已存在记录只读重新审计**通过，没有重跑算法。首次失败输出保留。

私有实测证据：`.local/cea/off03/run-8cea8772-14de-4d9d-b29f-890f605b6fcc.json`、`.local/cea/off03/after.json`、`.local/off03-live.log`；完整/定向日志分别为`.local/off03-verify-final.log`与`.local/off03-targeted-final.log`。这些本地证据不提交公开仓库。

## 发布、保留与页面

18:04:05 +08:00发布完成；此前保留4个旧服务镜像`before-off03`，备份完整MySQL（299,428字节、dump完成标记已核验）及私有存储配置。V26/V27的Flyway成功标记均为1。

- 更新backend、frontend、edge-gateway、terminal-agent；公共文件助手更新edge-a/cloud的immutable digest。算法镜像和Flow不改，edge-b/c助手保留原版、不参与本次卸载测量。
- 仍为19个常驻CEA容器；其余15个容器ID/镜像/启动时间保持，MySQL、MinIO、Registry、K3s和terminal-engine未重启。发布脚本见[upgrade-offloading-measurement.ps1](../../deploy/cea/upgrade-offloading-measurement.ps1)，不要重复初始化CEA。
- 原14条Execution、4条旧卸载观测、2个USER Flow及其修订、7个策略、2个数据集保持；新增6条Execution，总数20，边缘处理记录总数13，卸载样本总数10。未删除历史、文件、容器证据或重跑联邦训练。
- 18:07:52实际18080“卸载观测”桌面/390px核验PASS，六维、端到端耗时、奖励、反馈、next及原执行链接正确，无浏览器错误。浏览器核验脚本初次缺baseURL而失败，修正脚本后通过；不涉及生产代码修复或再次发布。

截图与页面证据在`.local/cea/off03/browser/`。数据库备份和配置含敏感内容，仅本地保留，不公开。回退先停止接收新请求并排空，再按同一发布批次恢复服务/助手配置；不能简单回退数据库丢弃本批新增真实记录，也不能用旧客户端重新计量已有请求。涉及恢复数据库或删除本批数据应另获授权。

## 未完成与解释限制

- Double DQN、Bellman target、replay/target network、episode关闭与五基线实验属于OFF-04，本批没有训练模型。当前完整样本只说明记录条件满足，不证明六维是严格完备MDP。
- Q是受控同类算法/参数/资源下的未完成输入MiB，不是剩余CPU周期、精确排队时延或所有平台外进程负载；不含能耗、价格、多核研究扩展。
- 终端计时含请求、等待、传输、容器启动、算法及结果返回；传输预测只含实际文件传输。二者不可混作同一指标，120秒是奖励示例阈值。本批1.78–8.64秒**不满足30ms**，没有以单次决策耗时冒充系统总时延。
- 单机Docker中的三层隔离验证，不是跨地域网络、物理终端、吞吐2GB/s或长期性能验收。无离线计时续接；原进程丢失则缺测，不编造值。
