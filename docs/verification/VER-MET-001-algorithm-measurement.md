# VER-MET-001：公共算法SDK与单一数据处理速率

状态：计量功能DONE/PASS并已发布CEA，2GB/s未达标；首次现场FedAvg失败的根因仍未确定，详见下文。基线提交`048a2c9`，本批最终提交见Git历史。Windows/JDK21、Maven、Docker Desktop单宿主CEA（Linux容器），2026-09-15。

## 变更与边界

公共标准库SDK适配FedAvg/FedProx四阶段、边缘四入口、终端振动处理；报告经原outputFiles发布。新增一个dataflow查询类、一个GET及一个运行配置，不增加表/列/SPI，不修改Executor/Worker、Placement、文件助手、算法数学实现或DQN reward。

累计完整业务文件输入＋输出长度／完整算法活动区间并集；不乘epoch，不用Pod时间兜底。具体限制见[协议](../contracts/algorithm-measurement.md)。发布不等于性能达标，M03资源开销继续暂缓。

## 已完成验证

- Python SDK最终11项：真实文件大小、输入不变校验、硬链接/重复去重、异常、空文件、自身报告排除、时钟跳变、POSIX跨UID可读权限；专门拦截Path.read_bytes证明计量登记不额外读内容。Linux容器运行，权限测试未跳过。
- Java 7项聚合/协议测试：真实JSON整数和纳秒时点、重叠/包含/相邻/串行区间、零值、缺字段、非法数值/重复项/溢出、Attempt时间范围。
- Node 53项、浏览器60项、构建与格式通过。既有Metrics图表及单一rate缺失显示回归通过。
- FedAvg/FedProx镜像原7项数学测试、振动原3项测试通过。
- 边缘液压、轴承、表面、报告入口用已有真实数据/模型各跑一次，4份报告的每个输入/输出长度与实际本地文件逐项一致。
- `sdk/python/benchmark_metadata.py`200次，10个64MiB文件输入登记＋1输出登记＋小报告发布：归档轮次中位0.595ms、P95 1.120ms。它隔离的是元数据/报告开销，不是算法吞吐测试；不扫描640MiB内容，也不向平台上报这些合成报告。前一轮并行构建时中位1.140ms、P95 2.431ms，说明开销随环境波动，不能承诺固定微秒数。

权限修正版重复200次：中位0.597ms、P95 1.245ms（`sdk-overhead-v3.json`）。这仍是元数据小测，不计入算法速率，不能拿微基准代替业务运行。

最终权限修正之后再次完整执行`verify.ps1`，01:56:12（UTC+8）262项全部通过，0失败/错误/跳过；实际FedAvg/FedProx数值审计、真实网关三路径、存储/授权/重试/接管/取消和打包启动回归均在其中。最终v3镜像另跑7项联邦数学测试和2项NPZ CLI测试通过。

第一次完整verify：FedAvg/FedProx报告被拒绝，另有网关构建boto3下载失败。定位确认MySQL集成测试未指定连接UTC，在Windows读取Attempt时产生整8小时偏移；CEA原连接已有`connectionTimeZone=UTC`。只修正测试连接，未放宽计量校验、未回填历史时间。随后7项计量测试＋4项真实FedAvg/FedProx/网关三路径/输出授权测试全部通过，两算法独立数值审计PASS；网关依赖正常重新构建。最终完整`verify.ps1`于01:27:24（UTC+8）BUILD SUCCESS，262项（35 runtime＋226 server＋1打包启动），0失败/错误/跳过。

## CEA发布记录

01:14:46（UTC+8）前后端健康，三份算法镜像已发布中心仓库，10个Application新增`met01-v1`，不覆盖原版本。FedAvg r5→r6、FedProx r3→r4；三边缘策略及四OFF-02固定/RULE策略r1→r2。六个OFF-04训练/对比策略未修改，避免应用版本变更让旧画像/模型失配；这些旧实验不会被回填为已计量。

随后边缘镜像`met01-v2`补齐NPZ未消费成员拒绝，2项专门测试通过；四个边缘Application新增v2，三边缘策略r2→r3，其余不变。总计10个Application ID新增14个不可变版本。没有覆盖旧镜像摘要或修改算法数学逻辑。

现场终端路径进一步发现：算法UID65532写出的报告默认0600，代理UID0但cap_drop=ALL，读取触发PermissionError；业务容器退出0，原重试确认链最终因Attempt超时而FAILED。修复只把SDK报告原子发布权限设为0644，不放宽代理权限。三份最终镜像统一`met01-v3`，10个Application再新增v3，最终FedAvg r7、FedProx r5、三个边缘策略r4、四OFF-02策略r3；累计新增24个不可变Application版本。v3真实终端/边缘/云请求全部成功且业务结果一致。未重启terminal-agent、gateway、terminal-engine或算法集群。

修复前现场失败仍保留：FedAvg `6cc9282e-e2e6-4716-89eb-35c129967b82`第二轮三个train失败，原停止机制删除Pod，缺少容器stderr，根因尚不能确定；相同版本后续复测和独立数值审计通过，不声称已定位修复。终端 `d2f08a8a-63c1-45b4-9fc7-e585141c29e5`由上述权限导致超时。曾只修正本次终端临时报告文件权限以确认代理能够读取，未改报告内容/时间或强改Execution结果，原执行仍FAILED。两条失败查询均NOT_SUCCESSFUL、所有数字null；记录在`failed-measurements.json`，不隐藏为成功，也不用于报告性能达标。

发布前验证backend、cloud、edge-a/b/c、terminal-engine共用宿主内核时钟，CEA启用clock-synchronized；物理多机NTP/PTP未验证。只替换backend/frontend，无DB迁移；原134执行、2数据集、124卸载样本及17个无关服务ID/镜像/启动时间一致。原用户Flow历史source及未改策略核验PASS。

实际18080历史执行概览截图检查PASS，仅增加“数据处理速率 —”；历史FedAvg API返回INCOMPLETE且数值全null，health UP。最终v3两种联邦及三种边缘策略再次顺序实跑，均在完整Maven回归结束后进行；每个联邦执行11个实际Job、四个集群/存储、两轮独立数值审计PASS。终端/边缘/云三路径也均由v3执行成功并返回相同业务结果。

`frontend/tests/verify-measurement-live.mjs`复核本批全部13条成功执行：对原始报告独立使用BigInt纳秒计算区间并集、累计实际文件字节，与API逐项相等；四次成功联邦执行的所有报告输入/输出长度，再与已下载且数值审计通过的实际数据集/模型/评估文件逐项核对。两条失败保持NOT_SUCCESSFUL；历史缺报、匿名401、真实18080桌面/390px窄屏展示及无页面异常通过。没有只保留最快运行。

## 最新修订的真实值

以下是每个Flow最后一次本批成功运行，不是性能基准统计、最好值或申报验收；MB使用十进制。SDK测的是完整算法活动，不是Execution总时长。短任务受系统负载影响明显，三条卸载路径当时与隔离回归共用宿主，不能用其微小差异比较层性能。

| Flow | 输入字节 | 输出字节 | 算法区间并集/秒 | 数据处理速率/MB/s |
|---|---:|---:|---:|---:|
| FedAvg r7 | 448938444 | 3681544 | 3.044676101 | 148.66 |
| FedProx r5 | 448938444 | 3681547 | 3.128201820 | 144.69 |
| hydraulic-local r4 | 97247 | 130501 | 0.023136888 | 9.84 |
| bearing-return r4 | 2247571 | 36533 | 0.385952613 | 5.92 |
| surface-cloud r4 | 65310965 | 47984 | 2.286978246 | 28.58 |
| offload-terminal r3 | 1507314 | 134 | 0.031964483 | 47.16 |
| offload-edge r3 | 1507314 | 134 | 0.033653807 | 44.79 |
| offload-cloud r3 | 1507314 | 134 | 0.034346107 | 43.89 |

最新FedAvg执行`202d56d4-4e6f-4062-8ee3-b1f4839d1a9d`，FedProx执行`71c5b48b-8b5c-4364-8828-5260bee97e3b`。此前成功运行分别190.86/110.90MB/s也完整保留在证据，不因最终值高低筛选或删除。均未达到2GB/s（2000MB/s）。新版本只影响随后执行，旧成功执行仍按自身报告读取，旧无报告执行不回填。

最终保护复核PASS：原134条执行、2个数据集、124个卸载样本逐项不变；旧Flow源文与六个OFF-04实验策略不变；17个无关常驻服务的容器ID/镜像/启动时间不变。前后端健康，保留发布前恢复镜像。本批不提供物理多机时钟保证、任意局部/流式读写计量、吞吐达标或新DQN性能结论。

本地证据：`.local/cea/met01/`（before/after/clocks/release/upgraded、SDK开销、边缘CLI报告、measurements/failed-measurements和桌面/窄屏截图）；`.local/met01-*.log`；`.local/cea/evidence/{fedavg,fedprox}/`；`platform-server/target/federated-evidence/`。真实数据、凭据和镜像归档不提交Git。
