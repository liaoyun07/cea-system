# 当前进度

FLPAR-13（2026-09-16，DONE/PASS已生效）：当前CIFAR-10三个集群的raw训练分片均分为16667/16667/16666条，仍50000条、图片标签索引及顺序不变。raw v2＋同镜像契约已发布，par08/par10/par12五个预处理Flow均r2，仅改数据引用，原客户端数/并发/batch/轮数不动。原三客户端冒烟SUCCESS，真实train条数与分片一致；回读、9 Job/SDK、5模型20张量及10000样本评估通过，3项Python/10项Node与结构检查PASS。旧261执行/数据版本/非目标Flow及19服务不变，最终262执行/31Flow，18080可见。未做固定总量1/2/3实验、未重复性能对比或改变2GB/s状态。无Java/DB/前后端生产修改和服务重启。[验证](verification/VER-FLPAR-13-balanced-shards.md)。

FLPAR-12（2026-09-16，DONE/PASS实测）：1/2/3客户端各预热1次＋正式3次，12/12成功。正式平均30.924/32.449/34.539秒，SDK并集0.737/1.522/2.828秒，494.85/546.14/540.08MB/s；训练峰分别1、1～2、2。只减少新Flow的Loop成员与并发，原始处理条数随之为8333/25000/50000，不能称为固定总量加速比，未达2GB/s。84 Job/SDK与48模型192张量、加权聚合/10000测试样本评估、9项Node及结构检查通过，0启动Warning。原249执行/28Flow/数据集/19服务及24/6/2容量保持，新增3Flow/12Execution，18080原页面/API可见；无Java/DB/前后端修改、无服务重启、无常驻算法实现。旧FLPAR-05～10未提交工作保留，本批仅提交实验工具和对应文档。见[完整结果](verification/VER-FLPAR-12-low-clients.md)。

FLPAR-11（2026-09-16，修复已部署）：四K3s独立cgroup-root；后端挂起Job→owned文件Secret→启动，主执行链和算法/SDK不变。264项Java与8项Node通过，18客户端预热＋正式3次全成功；正式平均52.136秒/566.49MB/s，训练主容器峰11～14、算法峰5～7，未达18路或2GB/s。156 Job/SDK、80模型320张量核验PASS，启动Warning为0，files-in最长启动等待由原32秒降到3秒。原245执行/28Flow/数据集/42个K8s业务定义保持，仅backend及4K3s重建；其余14服务保持，01:57:29检查249执行全终态、18080/后端健康。Worker24/每edge6槽保留；无新Java类/表/API，不宣称历史其他SDK故障已解决。[记录](verification/VER-FLPAR-11-startup.md)。

FLPAR-04（2026-09-15，实验完成）：同batch1024/单轮9客户端FedAvg/CIFAR10，原方式和整批取样各3次正式均成功，速率均值358.153/362.615MB/s（+1.246%），但平均算法活动时间均5.638秒，配对+10.7%/+4.2%/−11.6%，未证明稳定收益或2GB/s。4项新增Python/11项原回归、18次本地诊断、5项Node/历史三批汇总保持、96份SDK及72次完整训练文件输入（含预热）、24个实际Job/模型数值审计、跨方式11份模型44张量逐值一致均PASS。17:43恢复Worker4/边缘槽1，backendUP/18080正常，原2业务Flow/10数据集/策略/19服务保持，仅backend重启。实验版本和2个测试Flow/8条执行留CEA，不改原业务链、不推广候选。[复测](../examples/federated/parallel-benchmark/BULK.md)、[全部结果与限制](verification/VER-FLPAR-04-bulk.md)。

FLPAR-03（2026-09-15，实验完成）：单轮9客户端、CIFAR10/MLP，训练batch32/256/1024/16384各3次全部成功，均值376.623/454.338/484.335/444.123MB/s。1024提高28.6%但单轮accuracy从31.59%降至21.24%，16384为10.59%；未达2GB/s。144份SDK、108次完整训练输入及四档48个Job/36客户端模型/聚合评估数值审计PASS；4项Node、语法及两组历史汇总回归PASS。17:12恢复Worker4/边缘槽1，原业务Flow/10数据集/策略/19服务保持，只有backend重启，healthUP/前端200；新4个par03 Flow和12条历史留CEA，无生产代码/DB改变。[方案](../examples/federated/parallel-benchmark/BATCH.md)、[完整结果](verification/VER-FLPAR-03-batch.md)。

FLPAR-02（2026-09-15，实验完成）：重复数据真实扩量，FedAvg/CIFAR10每轮累计5/10/15/20万条（唯一样本5万），3/6/9/12客户端平均216.531/257.845/315.535/290.998MB/s。前3档各3/3成功，12客户端2/3成功且未超过9客户端；失败根因未定，检查环境后只完成原定剩余较低负载次数，未补跑替换。3项Node、语法/旧汇总保留、211份SDK/156次完整文件输入及四档80个Job/模型训练聚合评估复核PASS。16:04恢复Worker4/边缘槽1并仅重启backend，健康UP；原2业务Flow、10数据集/策略和19常驻服务身份资源不变。只新增4个测试Flow和工具/记录，无生产代码/DB/API/执行链变化；不代表新增独立样本、精度提升或2GB/s达标。[完整证据](verification/VER-FLPAR-02-repeated-load.md)。

FLPAR-01（2026-09-15，实验完成）：同一CEA、固定总数据/MLP/2轮，3→6客户端并行的四组平均速率分别为FedAvg/CIFAR10 227.405→280.419、FedProx/CIFAR10 137.573→175.121、FedAvg/CIFAR100 222.543→250.014、FedProx/CIFAR100 129.265→188.589MB/s。主对照24/24成功，额外六客户端并行3控制2/3成功，失败根因未定且未补跑替换；27次完整记录保留。两项单测、分片/上传核验、26组SDK字节/时间复算、五组真实Job/模型训练/聚合评估重算PASS。15:33恢复Worker4/边缘槽1并仅重启backend，健康UP；原FedAvg r8/FedProx r6、原6数据集/策略/19常驻服务身份资源不变。无生产Java/前端/DB/API/执行链变化；未默认切6、未通过2GB/s，Maven/浏览器本批未重跑。详见[全部原始结果与限制](verification/VER-FLPAR-01-parallel-clients.md)。

FLDATA-01（2026-09-15，DONE/PASS，已发布CEA）：接入CIFAR-10/CIFAR-100完整数据、100类模型/标签校验、两个Flow的SELECT与init显式版本校验。262项Maven、11项Python、3项升级保留、53项前端单测、60项浏览器PASS。五个应用新增cf01-v1、四个数据集版本/八个Location、FedAvg r8/FedProx r6已生效；两算法×两新数据集各两轮和MNIST回归全部成功，11个Job/本位置产物/独立数值重算及实际18080选项核验PASS。首次现场任务因Docker重启遗留的存储IP过期失败；刷新现有transfer-endpoint并只重启backend后通过，失败记录保留。无Java/DB/API/执行链变化，旧版本/策略和19个常驻服务身份保留；未借本批改变速率口径或宣称精度达标。范围/结果见[数据协议](contracts/federated-datasets.md)、[验证](verification/VER-FLDATA-01-cifar.md)。

MET-001（2026-09-15，计量功能DONE/PASS，已发布CEA）：公共标准库SDK记录实际完整业务文件输入/输出长度与完整算法区间，沿原产物链发布；新增只读汇总API和执行概览单一“数据处理速率”。FedAvg/FedProx四阶段、三种边缘策略及终端/边缘/云卸载路径已实际计量，报告与物理文件长度、纳秒区间并集及页面独立核验一致。最终完整262项Maven、11项SDK、53项Node、60项浏览器及算法测试通过。首次FedAvg现场失败未复现且根因未定，报告权限导致的终端超时已修复并复测；两条失败保留且不返回有效速率，详见[完整证据](verification/VER-MET-001-algorithm-measurement.md)。无DB迁移/表/列/SPI或执行链变化；原历史、DQN实验及17个无关服务保留。当前实测未达到2GB/s，M03继续暂缓，不能把功能完成写成性能指标通过。

MET-04（2026-09-14，当前CEA条件测试PASS，三服务已部署）：新增独立振动统计/轴承随机森林/表面PaDiM HTTP镜像，加载及预热后才就绪；复用原上传、分发和Deployment计时。镜像仓库层大小123.06/393.71/1205.10MiB；edge-a首次新服务部署2.190/4.372/12.318s，三次热缓存均值1.641/1.904/3.379s，12/12有效且业务结果正确。24项镜像测试、15次实际部署业务核验（12测试＋3展示）、22:53实际18080三部署及各5条历史/桌面窄屏PASS。仅清理本批12个测试Deployment，镜像/历史和最终3展示保留；19个CEA服务及原Flow/Execution/策略/Dataset/卸载记录快照不变。无Java/表/API/执行链变化，未重启前后端、未重跑Maven。完整冷缓存环境等待单独确认，不把当前结果说成物理WAN或无缓存达标。[结果与限制](verification/VER-M04-edge-deployment.md)、[复测及使用](../examples/deployment-benchmark/README.md)。固定指标主线不变，M03尚未开始本批验证。

MET-PLAN（2026-09-14，优先级已调整，指标未新增验收）：按用户要求，下一步依次推进M04部署≤30 s、M03 CPU/内存70%以下、M01算法≥2 GB/s、M02卸载系统总时延≤30 ms；M05–M07相对提升后置，其他功能仅在支撑这些指标时补充。前两项已有测量基础但未完成正式重复测试；M01计量从长期后置转为有序待办，原候选口径仍须先确认；M02当前CEA秒级结果仍不达标。M08四个模型另作成果清单核对。本次只同步计划0.47、审查表和计量待办说明，未改代码、数据、运行链或部署，未把任何指标改成通过。详见[实施顺序](03-implementation-plan.md)、[指标审查](07-proposal-audit.md)。以下记录保留各批当时状态，后续优先级以本段为准。

OFF-04（2026-09-14，DONE/PASS核心闭环，已发布）：所属边缘网关六维Double DQN、真实转移回放/目标网络训练和五基线比较完成。19:59:04完整255项Maven、52项Node、60项浏览器、30项本批Python测试PASS；20:04:32发布CEA backend/frontend/gateway，无DB migration/新Java/SPI，唯一新增DSL字段exploration。实际114次请求全部成功，48次探索产生47条完整转移，固定模型off04-trained-fa015933完成60次独立比较；均值终端2.207s、边缘8.058s、云5.628s、RULE4.058s、DQN4.005s。DQN未优于全终端，与RULE的微小差异不能证明收益；30ms及多目标/多核仍未达成。原20条执行/10条观测/原定义与数据集保持，其余16服务不变，实际页面及12个DQN动作独立数值复核PASS。详见[ADR-0028](decisions/ADR-0028-edge-double-dqn.md)、[验收与全部P95](verification/VER-OFF-04-double-dqn.md)。S5-05数据处理速率继续后置；后续研究/性能工作另行确定，不自动调参或扩大采样。

OFF-03（2026-09-14，DONE/PASS，已发布）：真实六维状态、接纳后未完成工作量、最近20次传输估计、终端单调时钟端到端反馈、决策顺序next关联及卸载观测展示已闭环。17:58:42完整251项Maven PASS；最终移除额外源S3 HEAD并补两项测试后，18:03:01定向28项PASS；52项Node、59项浏览器、41项Python及构建/格式/结构通过。18:04:05发布CEA backend/frontend/gateway/terminal-agent及edge-a/cloud公共助手，备份数据库后应用V26/V27；不新增服务，原15个无关服务不变。六次真实执行均SUCCESS，8条传输事实/独立数值复核、同值反馈及乱序关联通过：大请求仍未完成时小请求记录QC=63.2494MiB，小请求6.578秒先完成、大请求8.638秒后完成，next仍按决策顺序。原14条执行/4条卸载历史、2个USER Flow、7策略、2数据集保留；新增6条执行，不重跑联邦训练。18:07:52实际18080桌面/390px页面PASS。新增3份生产Java、2张资源事实表、1个反馈API；无新Executor/Worker/SPI或算法SDK。OFF-04 Double DQN、五基线比较和正式性能验收未开始，详见[验证与限制](verification/VER-OFF-03-measured-feedback.md)、[ADR-0027](decisions/ADR-0027-offloading-measured-state.md)。

OFF-02（2026-09-14，DONE/PASS，已发布）：终端元数据compute、网关派发、固定三层/RULE及成功小JSON返回已闭环。本地原始文件不上传，EDGE/CLOUD按需上传所属边缘；沿原Worker/Placement/Pod助手执行。16:37:23完整244项Maven、51项Node/构建/格式、58项浏览器、25项Python通过，包含原Attempt接管、取消确认、失败重试和权限回归。16:44:42更新CEA backend/gateway，新增terminal-agent及独立DinD（无宿主Docker socket/无Docker TCP），frontend只reload。16:45四次真实执行均SUCCESS，六项结果与独立参考一致；local/RULE原文件上传0字节，EDGE/CLOUD各1507314字节且内容一致。16:47实际18080记录/来源/详情/结果、桌面与390px通过；原2流程、3策略、10执行和2数据集不变，其余15服务ID/镜像/启动时间保持。新增1份Java和1个GET，无DB migration/新运行状态机。OFF-03真实六维/端到端反馈及OFF-04 Double DQN未开始。见[验收](verification/VER-OFF-002-terminal-gateway.md)、[ADR-0026](decisions/ADR-0026-terminal-gateway-runner.md)。以下条目中的未实现描述为对应历史批次状态。

OFF-01（2026-09-14，DONE/PASS，已发布）：卸载只选层，Resource/Placement 选具体位置。删除 offload.candidateClusters、代表集群评分和旧画像 estimate 查询；增加管理员 central-clouds 范围，EDGE 取可信终端归属；V25 仅允许预约前 target_id 为空。新 DQN 决策暂停至 OFF-04。15:45:56 完整242项Maven、51项Node/构建/格式、58项浏览器PASS；真实RULE三层与第二云集群Placement通过。15:50:54仅发布前后端，15:51～52实际18080健康/校验/编辑schema/浏览器及历史复核PASS；11份修订、10执行、132任务实例、104次尝试、2数据集、3策略及其余15容器不变。无新增生产Java文件/表/API/SPI，执行状态机不变。OFF-02网关终端三路径、OFF-03真实状态反馈、OFF-04 Double DQN比较仍未实现；下一步需要终端模拟运行环境，新增基础设施另行确认。见[本批验证](verification/VER-OFF-001-layer-placement.md)。

DOC-02（2026-09-14，DONE，文档检查PASS）：建立[现有系统与申报书功能审查表](07-proposal-audit.md)，覆盖26项功能、8项指标/研究成果与8项范围差异，关联原文位置和已有实现/验证；作为申报书视角的进度入口。结构/链接、42个审查项唯一性与引用、10张Markdown表列数及差异检查通过。仅文档，不增加业务能力，不改变DQN/计量等后置决定，不重启CEA；检查范围见[验证记录](verification/VER-DOC-002-proposal-audit.md)。

EP-02（2026-09-13，DONE，已发布）：边缘处理记录页及只读GET，原Execution筛选分页/快照与可信接入归属组成记录，复用现有详情与输出；无新Java文件/DB/状态机。21:35:47完整240项Maven、50项Node/构建/格式/结构通过；修正测试脚本与FILE-01隔离fixture后，21:46最终57项浏览器PASS。21:47只发布前后端，21:48实际18080三策略记录、筛选返回、三份原结果JSON和桌面/390px通过；原2个USER Flow、3个策略、10条执行、2个数据集及其余15个容器不变。未重跑生产算法或改接入/存储配置。见[范围](features/EP-02-processing-records.md)、[验收](verification/VER-EP-002-processing-records.md)。

EP-01（2026-09-13，DONE，已发布）：新增常驻HTTP网关和按次终端回放，原后端只增加CONNECT配置；3策略/4应用契约复用一个CPU镜像与原执行链。20:47完整237项Maven回归PASS，最终12项网关/终端与7项算法测试、四命令断网真实数据试跑PASS。20:55现场3执行/4个Job成功，上传字节一致、8份边缘输出/2份中心输出、返回终端诊断、重复事件/越权拒绝和独立数值复核通过。原2个USER Flow、7条Execution原值及其他15个服务容器保持；frontend仅reload。无Java/API/DB/Binding或调度器新增。样本/模型不入Git，单机Docker不等于物理多云；部署排错和模型限制见[验证](verification/VER-EP-001-terminal-edge.md)，[范围](features/EP-01-terminal-edge-examples.md)。

FILE-01（2026-09-13，DONE，已发布CEA）：18:29更新backend、frontend仅reload，新增三个边缘MinIO/独立卷，四集群应用文件助手及Namespace内Secret权限，撤销旧pods/exec权限。现场FedAvg/FedProx各两轮、11个Job及独立数值复核通过；18:32:38四存储实物核验PASS，每个执行中心5个文件、每边缘2个文件，中心没有train输出副本。2个Flow/8修订、原5条Execution/100个TaskRun和3份历史Metrics原值保持，其他12个原容器未重启。无新Java文件/SQL/API/DSL，原调度/执行链及历史URI保留；无常驻交接服务、DQN或计量新增。见[规格](features/FILE-01-pod-artifacts.md)、[验证](verification/VER-FILE-001-pod-artifacts.md)。

FILE-01实施验证：18:11:51完整237项后端回归；18:18:19最终8项K3s定向和1项打包JAR验证（含最后的URI校验、Secret所有权/CAS清理与终端适配）；8项助手Linux测试、结构/脚本/Compose检查均PASS。用户随后明确“部署”，本次应用新配置并完成现场验收，原先等待确认期间的有意配置差异已解除。保留旧backend恢复标签/配置/Role，但新边缘产物已产生，不可直接回退为中心-only旧后端。仍为单宿主四集群，数据集保留中心，不宣称物理多云或边缘脱网自治。

UI-05a（2026-09-13，DONE，已部署CEA）：任务实例开始时间升序、同时间稳定、未开始置后，仅表格排序投影，不修改原tasks/拓扑/Metrics或后端执行链。50项Node、55项真实浏览器、构建/格式/scaffold和桌面/390px复核PASS。14:37仅替换frontend，14:38–14:39实际18080 FedAvg 62实例、FedProx 14实例的排序/详情/刷新通过；2个Flow、5条Execution、100个TaskRun、78个Attempt及其余12服务未变。无Java/API/表变化，见[验证](verification/VER-UI-005a-task-start-order.md)。

UI-06a（2026-09-13，DONE，已部署CEA）：Metrics新增柱状/折线切换，默认柱状，保持原值/实例顺序/坐标，缺失断线、单值显示点；只改前端，无Java/API/表或执行链变化。47项Node、54项真实浏览器、构建/格式/scaffold及桌面/390px视觉验证PASS。13:59仅更新frontend，实际18080 FedAvg/FedProx原值和双向切换复核PASS，原2个Flow、4条Execution、38个TaskRun、27个Attempt及其余12服务不变。用户新增“每次修改测试后同步部署”约定已写入AGENTS.md。见[验证](verification/VER-UI-006a-chart-switch.md)。

UI-10：DONE（最小范围，已部署CEA）。Flow/终态Execution/未引用Dataset逻辑删除、ADMIN/USER人员与个人中心、独立rootless BuildKit在线构建已接通。2026-09-13 09:47:47完整235项后端回归、45项前端单测、54项真实浏览器及构建/格式通过；09:52:38追加1项删除竞争测试通过（任务提交/契约登记各5轮竞争，不修改生产代码）。09:49:44只更新前后端、增加builder及专用socket/cache/网络，应用V21–V24；09:50:14实际18080桌面/390px、ADMIN、健康、后端实际构建导出及数据对照PASS。原2个Flow、6个应用版本、2个数据集、4条Execution、38个TaskRun、27个Attempt、http-server部署和原卷保留，其他10服务未重启。5个新Java、12个API、3个删除列/1张人员表；执行链、Runner/Placement不变。两次测试socket超时与后续回归经过保留在[验证](verification/VER-UI-010-cleanup-users-build.md)，不宣称根因已定位。范围见[工作包](features/UI-10-cleanup-users-build.md)；存储GC、复杂IAM、持久构建历史和旧系统切换未做。

UI-09（2026-09-13，已发布）：补齐Registry实际库存/详情/引用保护删除、应用目录删除、Service及多Namespace管理。06:18:11最终230项后端回归通过，45项前端单元、50项浏览器及构建/格式/结构检查通过；06:21实际18080复核四仓库5/2/2/2个条目（含无标签副本），源标签解析/目标直接查询与库存一致。前后端、4个Registry删除开关与4集群管理RBAC均已应用；V20只增加应用目录deleted列。原2个Flow、6个应用版本、4条Execution、38个TaskRun、27个Attempt与http-server部署及全部卷挂载不变，MySQL/MinIO/4算法集群未重建，没有删除既有业务对象。执行链与默认Namespace不变，不自动GC；迭代中遗漏标签候选等问题及修正证据见[验证](verification/VER-UI-009-registry-kubernetes.md)，[范围](features/UI-09-registry-kubernetes-management.md)。

UI-08a（2026-09-13，已发布）：已直接删除运行资源的容器用量标签、表格、空态、样式和前端usage/pods请求分支；保留节点CPU/内存、Service和Namespace，没有新增其他入口。45项Node、47项真实浏览器、构建与格式检查PASS。用户确认后03:18仅替换CEA前端，03:20:33实际18080四集群采样/剩余三页及桌面/窄屏复核PASS，页面不再请求usage/pods；其余11个容器ID/StartedAt/Image、两Flow及修订、4条Execution、38个TaskRun与Attempt不变。未修改Java/API/表/RBAC/采集器或执行链，未重跑Maven或训练。见[验证记录](verification/VER-UI-008-core-deployment-operations.md)。

UI-08-demo（2026-09-13）：已准备可自行上传的常驻HTTP示例镜像`cea/deployment-demo:v1`，tar约43.36MiB。默认非root/8080健康检查、MESSAGE配置回显及数值统计，8项真实HTTP测试、默认CMD容器/只读根文件系统和Skopeo归档检查通过；未向CEA登记或部署。仅示例与文档，无平台Java/API/表或执行链变化。[使用说明](../examples/deployment-demo/README.md)、[验证](verification/VER-UI-008-demo-image.md)。

UI-08已实现并发布CEA：按需镜像分发历史、单镜像Docker save tar上传、部署配置回读/CAS编辑/手动扩缩容/就绪计时、近期CPU/内存用量展示。2026-09-12 21:54:30实现阶段完整verify 227项、45项Node和47项真实浏览器通过。用户确认部署后，2026-09-13 02:50替换前后端、应用V18/V19两张记录表与上传卷，四集群安装Metrics Server及受限只读RBAC；02:53:34实际18080页面/API复核PASS，四节点采样AVAILABLE。发布前已备份CEA数据库、配置及回退镜像；FedAvg r5/FedProx r3、4条执行、38个TaskRun/Attempt和原算法工作负载不变，其余10个容器未重启。没有新业务代码或执行链改动，也没有新建业务上传/部署/训练；新历史不回填，已结束容器缺近期用量显示MISSING。失败、修正、验证边界和回退注意事项见[规格](features/UI-08-core-deployment-operations.md)和[验证](verification/VER-UI-008-core-deployment-operations.md)。

最新完成UI-07：产物JSON查看、运行总览、Kubernetes只读资源。2个新Java文件、5个GET查询，不新增表/列/调度动作；89个生产Java、57个HTTP操作。2026-09-12 19:37:20完整verify 220项通过；41项Node、44项真实浏览器、构建/格式/scaffold及桌面/390px视觉验收通过。产物声明与Metrics共用Execution快照，不跨USER/EDGE_POLICY管理入口读Flow。用户确认部署后，19:50仅替换CEA前后端并对四集群的既有Role/ClusterRole增加受限只读权限；19:51:23实际18080总览、四集群查询及FedAvg/FedProx历史产物/Metrics复核PASS。FedAvg r5/FedProx r3、4条Execution、38个TaskRun及其Attempt不变，其余10个容器ID/StartedAt/镜像ID不变。没有重跑训练、迁移数据库或修改旧系统，保留before-ui07回退镜像。详见[规格](features/UI-07-readonly-inspection.md)与[验证](verification/VER-UI-007-readonly-inspection.md)。

最新完成：UI-06执行Metrics已发布CEA，新增已有JSON产物的受权只读接口及前端指标选择/实例明细/图表；不改执行链、表或算法镜像。2026-09-12 17:00:24完整verify 216项通过；40项Node、42项浏览器、构建/格式/scaffold通过，真实FedAvg/FedProx两轮原值与文件一致。用户确认后17:15仅替换前后端，17:16:52实际18080的两算法历史指标图/表、刷新、桌面/390px复核PASS；FedAvg r5/FedProx r3及其历史、4条Execution、38个TaskRun及Attempt未变，其余10容器ID/StartedAt/镜像ID未变。没有重跑生产训练。[规格](features/UI-06-execution-metrics.md)，[验证](verification/VER-UI-006-execution-metrics.md)。

最新完成：UI-05只读执行拓扑、轮次/item实例选择、TaskRun输出/时间/尝试，以及两个联邦Flow显式数据集SELECT。36项Node、40项真实浏览器、215项Maven及构建/格式/scaffold通过。2026-09-12 14:45只更新CEA前端，FedAvg r4→r5、FedProx r2→r3；14:46:19实际页面只读复核PASS，历史修订和四条执行未变，其余11个容器ID/StartedAt未变。无Java/API/表/执行主链变化，未增加Pod日志或产物内容/指标解析。见[验证记录](verification/VER-UI-005-execution-inspection.md)。

最新完成：UI-02d仅将Loop.values每项改为JSON文本框，保留逐项增删排序/来源与原DSL；不扩展inputs或统一任务表单方案。31项Node、37项浏览器、215项Maven及构建/格式/scaffold通过；2026-09-12 02:45只更新CEA前端，实际18080页面只读复核PASS，两Flow及四条历史执行不变，其余11个服务未重启。无Java/表/API或执行链变化。见[验证记录](verification/VER-UI-002d-loop-json-items.md)。

最新完成：UI-02c任务表单按类型必填前置/其余纵向排列，Loop/Repeat配置展平，values来源改普通下拉，保留原YAML路径/Binding和保存执行链。31项Node、37项浏览器、215项Maven及构建/格式/scaffold通过；2026-09-12 01:44仅更新CEA前端，01:45实际页面只读复核PASS，两Flow及四条历史执行不变，其余11个服务未重启。无Java/表/API变化，集合元素递归编辑仍保留。详见[验证记录](verification/VER-UI-002c-task-form-layout.md)。

最新完成：UI-04 SELECT输入。固定字符串values、默认值/必填/成员校验、No-code选项编辑及执行下拉已接通，保留唯一Flow/Binding/Execution链。30项Node、36项真实浏览器、215项Maven及构建/格式/scaffold通过。用户确认后于2026-09-12 01:01同步更新CEA前后端，01:05部署只读复核PASS；现有两Flow的源码/修订及四条历史执行的输入/输出/状态未变，其他十个容器ID/StartedAt未变。无新增Java类、表/列、API或SPI；暂不支持动态选项和多选。详见[SELECT规格](features/UI-04-select-input.md)与[验证记录](verification/VER-UI-004-select-input.md)。

最新完成：UI-02b Loop.values支持就地Array逐项/对象/嵌套数组编辑、类型与引用切换、增删排序；FedAvg/FedProx不再暴露clients启动输入。29项Node、34项真实浏览器、212项Maven及构建/格式/scaffold通过。2026-09-12 00:26只更新CEA前端，两个Flow经CAS分别保存为r4/r2，历史及其他配置保留；00:29实际页面与目录/历史执行只读复核PASS，其余11个容器ID/StartedAt未变。无生产Java、表、API或执行链变化，故障与验证详情见[记录](verification/VER-UI-002b-loop-values.md)。

最新调整：UI-02a候选集群选择已增加高亮/勾选和取消，按钮紧邻列表，状态与YAML双向同步。29项Node、30项真实浏览器回归、212项Maven（17:20:21完成）、构建/格式/scaffold通过；首次模板漏timeout及上线截图发现hover冲突均已修正并重测。用户确认后17:13发布最终前端，实际CEA的1440px/650px选中/取消和查询复核PASS，其他11个容器ID及StartedAt未变。无Java/表/API/调度语义变更。见[记录](verification/VER-UI-002a-cluster-selection.md)。

最新调整：UI-03a页面说明直接删除，未改成展开帮助或悬浮提示；必要字段、数据及错误/确认/结果保留。29项Node、29项真实浏览器、212项Maven完整回归及构建/格式/结构检查通过；十页真实CEA只读数据预览与1440px/650px截图检查通过。用户确认后于15:03更新18080前端，只读部署复核PASS，其余11个容器ID和StartedAt均未变。无Java、表、API或执行链变更；见[记录](verification/VER-UI-003a-copy-cleanup.md)。

最新完成：UI-03已有管理能力迁移并更新CEA的18080前端。应用契约版本与真实镜像准备、Deployment创建/状态/版本前置删除、集群/数据集、网关/终端登记启停、同源策略No-code/YAML/CAS及卸载观测只读均已接通。最终29项Node、28项真实JAR/Registry/K3s浏览器回归、212项Maven及12项Python通过；首轮测试定位/断言问题如实保留在[UI-03验收](verification/VER-UI-003-management.md)。14:31:01实际CEA只读复核PASS：应用5、集群4、数据集2，空网关/终端/策略/观测和部署列表与API一致。只替换frontend，其他11个容器ID及StartedAt均未变；生产Java、表、API和执行主链未改。仍缺后端接口的功能见[迁移矩阵](features/UI-03-management.md)，不是全部旧页面或S7完成。

上一批：UI-02同源No-code已实现并更新CEA的18080前端。任务块/单表单、显式Binding与目录选择、YAML联动、修订比较回退复用原API；最终23项Node单测、19项真实JAR浏览器回归、构建/格式检查和实际CEA只读复核PASS。后端完整verify首轮两项超时，未改代码或测试阈值，13:39:37第二轮212项Maven及容器内12项Python通过，失败经过保留在[UI-02验收](verification/VER-UI-002-no-code.md)。只替换frontend，其余11个CEA容器ID/StartedAt均不变，未改业务模板、执行数据、Java、表或API。不是完整Kestra、管理台全迁移或S7完成。

部署基线：DEPLOY-01独立D盘cea部署。Docker数据路径迁移、12个专用服务、四集群、外部连接配置已落地；FedAvg/FedProx各全量MNIST两轮/11个Job及独立数值复核PASS。整组stop/start后两Flow、四条含排错历史的Execution、全部成功产物与Job保留，再次数值/浏览器复核PASS。修正KubernetesJobRunner传文件时带宿主归属导致的权限失败；04:20:01完整212项Maven/12项Python回归PASS，无新Java类/表/API/SPI。见[实测记录](verification/VER-DEPLOY-001-cea.md)。不将S7切换标为完成，不改旧业务数据。

UI-01基线：2026-09-11用户授权UI-01独立前端最小闭环并要求参考Kestra风格/操作。[frontend](../frontend/README.md)已接通现有API，11项实际JAR浏览器联调通过，包含日志分页/动态实例检查；9项Node单测、构建及格式检查通过。Java主链未改，本次重新执行完整verify，212项Maven/12项Python于00:45:59通过。最终证据见[UI验收](verification/VER-UI-001-console.md)。S7、完整No-code、其他管理页、计量和长期DQN不在本批范围。

S6基线：剩余02–04已完成。2026-09-11 00:02:08 +08:00完整verify通过212项Maven与12项Python测试，见[S6验收](verification/VER-S6-002-files-lifecycle.md)。S6按已授权的最小后端范围DONE；S5的DQN研究和数据处理速率仍后置。

更新时间：2026-09-11。S6-01至04全部验收通过；S5已实现的核心链继续通过回归，长期DQN、计量和物理多云性能尚未完成，不因后置而标为达标。

## 当前事实

- UI-03/07：已有API管理页、Kubernetes查询与成功JSON产物查看；策略复用单一Flow编辑源和原执行器。UI-08/09已有镜像上传/分发历史、部署编辑扩缩容/就绪计时、近期CPU内存、Registry库存/删除及Service/受管Namespace管理。UI-10补人员/个人中心、删除与在线构建，验收/发布状态见本页顶部；任意Kubernetes对象写操作和全局对象浏览不在当前范围。

- UI-01：内存Basic认证、命名空间；真实Flow列表/搜索/分页、YAML源校验/Schema参考、修订CAS和未保存提示；显式Flow.inputs类型表单/预览、固定修订及未决请求同键重试；Execution/TaskRun/Attempt、增量日志、取消、主结果与afterExecution展示。前端独立npm工程，不增Java、表、API或第二套绑定。原先“前端未实现”的记录指此批之前或完整前端范围。

- S6-02至04：固定版本Namespace小型文本文件进入原Application Prepared/容器文件链；认证Webhook和统一Checks；SLA首次超限持久查询；AFTER_EXECUTION阶段通过原Executor/Worker运行，主终态/输出/结束时间不被后处理错误改写。完整回归通过，见[S6协议](contracts/s6-files-lifecycle.md)。

- S6-01：从同一FlowDefinition生成编辑Schema；校验/输入预览不创建执行；批量导入复用修订CAS和事务，搜索/导出维持USER管理范围。JSON和YAML共享解析/校验/保存，不存在独立No-code绑定；完整前端未实现。

- S5-04/OFF-01至03：显式TERMINAL+offload才进行FIXED/RULE层决策及观测，Placement决定具体位置；旧单步Q保留存档，新DQN执行暂停至OFF-04。普通CLUSTER和固定TERMINAL不读写卸载画像；终端FIFO以同Attempt预约并在确认停止后释放。符合采样条件的卸载请求新增真实六维和端到端反馈，详情见[计量协议](contracts/off03-measurement.md)。

- S5-03/EP-01：CONNECT网关身份、终端归属及心跳；USER/EDGE_POLICY管理隔离，事件提交原Execution。EP-01已部署HTTP网关/真实终端文件回放，未复制Executor/Binding/执行状态；不含MQTT、物理设备代理或离线自治。详见ADR-0014/0024及接入协议。

- S5-02b：Loop支持有界数组、ITEM上下文、并发任务组、显式有序输出；动态candidateClusters和集合文件清单与真实Application闭环。40项/重启/失败/取消、两种客户端数量和清单接管已测试。没有新增业务表/列/状态或第二套执行链；Kestra差异见[ADR-0013](decisions/ADR-0013-loop.md)。

- 独立8模块，OFF-03当前共108份生产Java（含8份包声明）；文件及测试入口见架构索引。BuildkitTestBridge/SkopeoTestBridge仅为隔离测试传输辅助，不进入生产执行链。模块依赖未增加，runtime仍不依赖业务模块。
- 单一Flow/Binding/Execution/TaskRun/Attempt模型；显式Flow Input和Task来源，不派生Input，不存在alias/plan/resolve第二套绑定。
- 主链：统一提交Checks → Executor派发 → Worker租约执行 → 持久结果 → Executor归并/重试/Errors/Finally → 主终态 → 同链afterExecution。Application适配资源/应用公开接口，按显式目标选择KubernetesJobRunner或DockerTaskRunner；没有第二套Executor。
- 叶子支持Log/Sleep、真实Application Job或终端Docker、HTTP GET/POST、MySQL只读参数化SELECT。Shell/Python在Application容器内执行，不在宿主执行。HTTP POST结果不明时不重发，自动retry禁止；SQL写入未支持。
- 资源目录预览仍只检查声明。执行时另外检查Ready可调度节点、数据集本地性，原子占用平台Job槽；不是CPU/内存物理预约，不使用终端卸载DQN。
- 镜像按digest准备；Job按TaskRun/Attempt固定命名。Worker中断/强杀后接管同Job。取消/超时等待Pod停止才释放名额并进入Finally。Kubernetes命名输入、数据集文件和输出由Pod公共助手按授权URI直接读写源/本域S3，算法镜像不带存储凭据；中心仅控制、确认对象及限量读取JSON，终端Docker保留原文件搬运路径。
- OFF-03当前V1–V27共28张业务表；V26两张资源事实表，V27只扩充原卸载观测，未新建执行状态表。原逻辑删除/人员/分发/部署表保持，prepared_json和TaskRun作用域语义保持。
- 当前92个HTTP操作；OFF-03新增受原CONNECT来源授权的反馈API并扩充样本查询。无新Worker端点、Binding、Runner或SPI；字段消费者见OFF-03协议。
- S6历史verify通过212项：runtime33、持久化86、接入18、编辑/文件/生命周期21、容器/联邦33、卸载10、HTTP/SQL6、协议3、架构1、实际JAR1；另Python7+5项通过。后续UI-06基线216项通过，当前批次以顶部及VER-UI-008为准，不把历史结果当本批结果。
- Repeat由原Executor持久推进显式状态反馈，每轮新TaskRun；整轮子图成功后才进入下一轮。重试仍增加同轮Attempt，轮间重启不重复已完成任务；当前支持固定1..100轮，可以内含Loop，不支持Repeat嵌套或条件循环。
- 真实环境仅单机Docker中的隔离MySQL/Registry/K3s/MinIO及独立JVM，未动旧web-platform/amis、旧DB、旧集群或旧镜像。不是实际跨地域多云性能/容灾验收。
- FedAvg/FedProx通过五个应用契约、一个共享CPU镜像和两个显式Flow运行；真实MNIST子集/独立测试256条、动态客户端两轮，逐张量验证训练/加权聚合与全局评估。模板经API登记为数据库修订，无Java内置模板；S5-02b为通用Loop改动现有Java与V11索引，不新增生产Java文件/表/API/SPI。
- 仍未实现：三个EP-01示例之外的其他业务迁移、完整Kestra工作台、复杂IAM/SSO、任意Node管理、物理设备协议/MQTT、终端卸载DQN研究、S5计量；也不支持SQL写入、任意HTTP方法、distroless/Windows任务镜像、强删Job后的exactly-once恢复。UI-10未提供物理清理/磁盘GC、私有基础镜像认证、多架构或持久构建历史。联邦学习测试不是物理多云或吞吐验收；旧执行历史、模型JSON和既有Harbor未迁移。
- 详细语义：[Job协议](contracts/s4-job-execution.md)、[通用任务](contracts/s4-common-tasks.md)、[最小部署](operations/s4-minimal-deployment.md)。设计取舍见ADR-0009/0010；完整源码索引见架构文档。

## 阶段看板

| 阶段 | 状态 | 验证 |
|---|---|---|
| S0 工程与文档框架 | DONE | PASS，仅脚手架；见VER-S0-001 |
| S1 定义和最小闭环 | DONE | PASS；S1历史与本次回归 |
| S2 恢复和失败语义 | DONE | PASS；S2历史与本次回归 |
| S3 通用控制流 | DONE | PASS；见VER-S3-001 |
| S4 资源与运行环境 | DONE | PASS；123项统一verify，见VER-S4-005；最小范围与限制见下文 |
| S5 边缘卸载与研究能力 | IN_PROGRESS | S5-01/02/02b/03/04最小范围PASS；188项Maven及12项Python通过，05未实现 |
| S6 P2与编辑管理 | DONE（后端最小范围） | 01–04及212项Maven/12项Python完整回归PASS；不含完整前端 |
| S7 迁移和上线 | NOT_STARTED | NOT_RUN |

## 本批工作包

| 工作包 | 状态 | 交付/剩余验收 |
|---|---|---|
| UI-03a | DONE（已部署） | 常驻说明直接删除；29项Node/29项浏览器/212项Maven PASS，CEA前端更新及只读复核PASS |
| DEPLOY-01 | DONE（独立单机部署） | D盘Compose、独立配置/凭据、四集群两算法、22个成功Job、全量数据数值/浏览器/重启复核PASS；Pod stdout汇入日志、物理多云、旧切换不在范围 |
| UI-01 | DONE（最小前端） | 原API源编辑/保存/固定修订执行/详情，9项Node及11项真实浏览器联调PASS；不是完整No-code或全管理台 |
| UI-02 | DONE（当前DSL范围） | 23项Node/19项真实JAR浏览器及212项Maven/12项Python完整回归PASS，CEA前端更新/只读复核PASS；首轮失败保留在VER-UI-002 |
| UI-03 | DONE（已有API范围） | 29项Node/28项真实浏览器、212项Maven/12项Python PASS；只更新CEA前端并只读复核，缺口见VER-UI-003 |
| S4-01 | DONE | 目录、本地性、7个API、11项新增测试与75项回归通过；文档/索引/协议同步，见VER-S4-001 |
| S4-02 | DONE | a纯契约目录保留，b真实镜像分发/c常驻部署完成；103项统一verify PASS，见VER-S4-004 |
| S4-03 | DONE | 真实Job/产物/同Attempt接管/取消/平台槽及全量回归PASS |
| S4-04 | DONE | GET/POST、只读SQL、隔离Shell/Python及全量回归PASS |
| S4-05 | DONE | 真实JVM强杀、DB短时故障、可执行JAR空库启动与统一验收PASS |
| S5-01 | DONE | Repeat定义/状态反馈/新轮次/屏障/恢复/重试/取消，真实容器产物及统一verify PASS，见VER-S5-001 |
| S5-02 | DONE | 仅FedAvg/FedProx，真实训练/聚合/评估数值、API注册和全量回归PASS，见VER-S5-002 |
| S5-02b | DONE | 通用Loop、ITEM、动态集群、集合文件；150项全量verify和7项Python PASS，见VER-S5-003 |
| S5-03 | DONE | 原后端接入PASS，EP-01已追加实际HTTP网关/终端回放及三个策略；见VER-S5-004/VER-EP-001 |
| S5-04a | DONE | 终端Docker、真实来源/接入权限、文件/结果、retry/timeout/cancel/接管及全量回归PASS；不等于自动卸载 |
| S5-04b | DONE | 显式卸载、规则/单步Q、画像/反馈和终端FIFO及全量回归PASS；不宣称长期DQN或策略性能最优 |
| S5-04c | DONE | 普通执行/资源释放最小解耦，观测表不可用真实产物链及完整188项Maven/12项Python回归PASS，见VER-S5-007 |
| S5-05 | 后置（仅设计） | 用户同意先跳过；MET-001业务代码未实现，口径未确认，见[S5-05方案](features/S5-05-measurement.md) |
| S6-01 | DONE | 统一编辑协议、原子导入/导出/搜索；199项Maven/12项Python完整回归及14项收尾复测PASS，见VER-S6-001 |
| S6-02 | DONE | 业务闭环、故障/权限与完整verify PASS；见VER-S6-002 |
| S6-03 | DONE | 业务闭环、故障/权限与完整verify PASS；见VER-S6-002 |
| S6-04 | DONE | 业务闭环、故障/权限与完整verify PASS；见VER-S6-002 |

全部Java和测试入口见[代码索引](01-code-architecture.md)，本批职责与有意简化见[ADR-0006](decisions/ADR-0006-s4-resource-boundary.md)。[S4工作包](features/S4-resource-runtime.md)保留原阶段全部退出条件，不将未完成批次移到S5。

## 下一步

CEA部署已可直接使用，入口18080；凭据见本地deploy/cea/.env，启动/升级/证据见[部署说明](../deploy/cea/README.md)。不要重复首次seed或清空卷。C盘Docker迁移前副本仍保留；没有释放这部分C盘占用。完整管理台、Pod日志采集、物理网关、S7及新增功能需要后续确认。

S6后端范围已完成并按持续授权发布GitHub；下一阶段或完整前端需用户另行确认，不自动进入S7。S5-05计量和长期多步DQN后置，不作为S6前置；策略性能对比、物理终端SSH、SQL写入、更多HTTP方法及生产高可用均未宣称完成。

本地运行和角色开关见[README](../README.md)。S2升级S3须停止提交、排空CREATED/RUNNING/KILLING并停机；备份新后端专用库，不混版本、不自动repair，不操作旧业务库。

## 已决事项与后续待定范围

| 编号 | 事项 | 决定与处理 |
|---|---|---|
| OPEN-001 | 已决定：backend独立Git仓库 | 公开仓库[liaoyun07/cea-system](https://github.com/liaoyun07/cea-system)，本地origin对应此仓库，main为发布分支。首次提交前的SHA256证据保留 |
| OPEN-002 | 已决定：技术版本以适用为准 | 当前保留已验证的Boot4.1.1/Jackson3/Flyway/MySQL8，不为了更新而升级 |
| OPEN-003 | 已决定：新后端Java 21 | 项目编译/运行均以21为准，现有配置已符合；不改旧工程或全局JAVA_HOME |
| OPEN-004 | 已决定：不做终端任务断线恢复 | 移出本期范围，不建设终端恢复专用查询/ACK、离线补发、断点续跑；正常终端接入/卸载和S2服务端Worker接管保留。结果不明不能盲目重投或伪造成功 |
| OPEN-005 | 后置：S5-05数据处理速率 | 用户同意先跳过。候选口径仅保留讨论，不新增SDK/指标逻辑，不阻塞S6 |
| OPEN-006 | 已决定：生产部署保障 | P01/P07保留现状；P04/P05/P06/P11随S4真实运行接入最小实现；其他已选后置项不变。见[范围清单](06-deployment-safeguards-review.md)，目录API不能冒充远程接口/凭据/部署保障验收 |

## 完成记录

2026-09-11：UI-01独立Vue工作台最小闭环完成，参考Kestra侧栏/列表/源编辑/执行详情；只消费原API，不修改Java、DB、旧AMIS或执行主链。9项Node单测、11项真实JAR浏览器测试、构建/格式检查通过；212项Maven/12项Python本次全量回归通过。启动步骤及限制见frontend/README，失败原因/修复见VER-UI-001。按持续授权提交并更新GitHub。

2026-09-11：完成S6-02至04。固定修订Namespace文本文件进入真实Application/Prepared；认证Webhook及所有提交入口Checks；SLA告警与原Executor的终态后处理。新增3份生产Java、4个HTTP操作、6个record、1张文件表、SLA时间列与phase扩容，无新Binding/Runner/SPI/执行链。212项Maven和12项Python完整verify于00:02:08通过，见VER-S6-002。S6后端阶段DONE，前端、S7、计量和长期DQN仍未实现。

2026-09-10：完成S6-01。新增FlowSchema一份生产Java、5个API及5个请求/响应record，修改既有Flow服务/解析器/Repository；无新数据库表/列/迁移、DSL字段、状态机或SPI。统一Flow编辑与真实执行往返、原子导入/并发/权限及完整199项Maven和12项Python验证PASS；14项中文/契约收尾复测PASS，见VER-S6-001。按持续授权发布GitHub，S6-02至04与完整前端未完成，S5研究/计量后置。

2026-09-10：S5-04c最小解耦完成，修改3个生产Java类，删除OffloadingService.observe，增加Resource按实际预约释放的公开重载；无新增类/字段/表/迁移/HTTP API/SPI，主执行链未变。188项Maven和12项Python完整verify于22:27:16通过，见VER-S5-007。S5-05已记录设计，但用户选择先讨论计量口径，未实施SDK/计量代码。按持续授权发布本次解耦与文档。

2026-09-10：完成S5-04b最小闭环，新增4份生产Java、3张表及3个HTTP操作，增加显式Offload和终端slots配置；dataflow只经offloading/resource公开服务调用，不改变Executor/Worker状态所有权，无新Binding/Runner/SPI。真实三位置执行、实际反馈训练模型及Java执行闭环通过，188项Maven与12项Python最终verify于20:16:31通过，见[VER-S5-006](verification/VER-S5-006-terminal-offloading.md)。按持续授权发布GitHub；单步Q是有意简化，未做长期DQN、物理多云性能或S5-05。

2026-09-10：按用户确认的Docker方向完成S5-04a。新增ContainerTask/DockerTaskRunner两份生产Java；Container.execution、Prepared.dockerContext和Settings.terminals均有执行消费者，无新表/列/迁移/HTTP API/Binding/SPI。修复网关CONNECT账号在真实Application Worker中的权限缺口；保持普通集群选址不变。175项Maven及7项Python完整verify于18:41:25通过，含真实文件链、非零/缺文件、重试/超时/取消及同Attempt接管，见[VER-S5-005](verification/VER-S5-005-terminal-docker.md)。按持续授权提交GitHub；S5-04b及05未实施，物理终端/SSH连接尚未验证。

2026-09-10：S5-03按后端协议最小范围完成。新增6份生产Java、4张edge表、1个Flow head管理范围字段和12个HTTP操作；删除无消费者的Repository旧保存包装，没有新Runner/SPI/Binding或执行状态机。166项全量及7项Python测试通过，权限收尾后107项定向verify通过，证据见[VER-S5-004](verification/VER-S5-004-edge-access.md)。按持续授权提交GitHub；网关代理部署、S5-04/05、S6/S7及旧系统切换未实施。

2026-09-08：S0-01至S0-05完成，仅工程与文档，业务测试0。[S0证据](verification/VER-S0-001-scaffold.md)保留为历史。

2026-09-08：用户授权执行S1，完成S1-01至S1-05；26项测试通过，见[S1证据](verification/VER-S1-001-durable-log.md)。记录描述当时S1，不代表当前Worker链。

2026-09-09：用户授权继续S2，实施S2-01至S2-04；统一verify于14:33:17 +08:00通过，结构索引同步，临时容器和测试JVM均已退出。S3–S7未实施。

2026-09-09：用户明确六项约束；初始化backend独立仓库，确认Java21/技术版本策略，移除终端断线恢复计划，计量后置S5，生产保障单独列为待选。仅仓库初始化与文档变更，未提交代码、未修改业务逻辑；本次验证见[范围确认记录](verification/VER-DOC-001-scope-decisions.md)。

2026-09-09：用户逐项确认生产保障范围，计划更新至0.5并分配后续阶段与最小验收；P010按P10记录。仅文档更新，S2仍DONE、S3未开始；验证续记在VER-DOC-001。

2026-09-09：用户授权开始S3，完成S3-01至S3-04；75项统一verify通过（16:26:40 +08:00），真实MySQL及独立Worker/Scheduler JVM验证完成。旧系统未改、S4未开始；详细证据见VER-S3-001。

2026-09-09：用户指定公开仓库cea-system，创建liaoyun07/cea-system并配置origin；将S1–S3快照作为首次发布。此任务仅Git发布与版本管理说明更新，不修改业务代码；业务测试沿用上述75项结果，本次另检查上传文件、敏感配置、结构链接和源码快照一致性。

2026-09-09：用户授权开始S4，计划更新至0.7，分S4-01至S4-05验证。首批资源目录与候选本地性完成，86项统一验证于18:01:48 +08:00通过；剩余Job/镜像/预约/通用任务/保障验收没有标为完成，证据见VER-S4-001。

2026-09-10：用户授权更新GitHub，发布S4-01源码与文档到cea-system/main。本次仅Git发布与发布说明更新，不修改业务逻辑；业务测试沿用2026-09-09的86项结果，不声称本次重新运行，另执行结构/链接和待上传内容检查。

2026-09-10：用户授权开始S4-02，按ADR-0007完成应用契约版本与参数绑定子批次a，101项统一验证于00:57:29 +08:00通过；计划0.8保留镜像准备/分发及常驻部署的真实验收，未动旧系统，未再次Git发布。完整验证记录见VER-S4-002。

2026-09-10：用户要求以后较大的新增/修改完成后更新GitHub，持续授权写入AGENTS.md，并同步计划中的发布约束。本次仅更新工作约定，不修改业务逻辑、不推进阶段；已有未提交S4-02a改动保持不变，未重跑业务测试。


2026-09-10：S4-02a原版本发布为2d3c44f。用户随后要求撤销自动派生，按修订ADR-0007保留应用目录，恢复Flow显式声明边界；没有新增业务能力或数据库迁移，S4-02仍IN_PROGRESS，b/c与S4-03未开始。clean后统一verify于01:53:56 +08:00通过95项（19单元+72真实MySQL集成+3协议+1架构），0失败/错误/跳过，见VER-S4-003。按持续授权纳入本次GitHub发布。

2026-09-10：用户授权完成剩余S4，本批完成S4-02b/c。统一verify于02:33:49 +08:00通过103项；新增8个生产Java、5个API，无新表/迁移/SPI，Execution主链未变。镜像复制/常驻部署使用真实Registry/K3s及限定namespace凭据测试，见[验证记录](verification/VER-S4-004-image-deployment.md)。S4-03/04/05未标完成，按持续授权提交发布此可验收子批次。

2026-09-10：继续完成S4-03/04/05，123项统一verify于13:07:08 +08:00通过，S4按已记录的最小范围DONE。新增8份生产Java、1张预约表、2个Worker传输字段，无新HTTP操作或自动Flow Input/alias；真实Job/文件/通用任务、强杀/DB短时故障和实际JAR验收见[VER-S4-005](verification/VER-S4-005-external-task-runtime.md)。按持续授权提交GitHub，S5未进入。

2026-09-10：用户授权开始S5，完成首批S5-01通用Repeat。最终133项统一verify于13:54:58 +08:00通过；新增Repeat嵌套record、Task.repeat与TaskRun两个字段，V10无新业务表/生产Java文件/API/Binding来源。沿用Executor/Worker链；真实两轮文件反馈与整轮屏障、失败/重试/取消/轮间恢复见[VER-S5-001](verification/VER-S5-001-repeat.md)。按持续授权提交GitHub；S5整体IN_PROGRESS，02–05未实现，不进入S6/S7。

2026-09-10：用户限定本批只迁移FedAvg/FedProx，完成S5-02/FL-001。新增Python算法镜像源码、数据准备、两份Flow、五份契约和API注册脚本；没有生产Java/数据库/API变化。最终135项Maven及7项Python测试于15:00:58 +08:00通过；真实MNIST子集两轮、22个Job及数值核对见[VER-S5-002](verification/VER-S5-002-federated.md)，中途失败和修正一并留档。按持续授权纳入GitHub发布；S5仍IN_PROGRESS，不迁移其他流任务，不进入03–05或S6/S7，不动旧系统。
