# 功能与验证索引

PRIO-01（2026-09-17，已实现/验证/部署）：叶子任务优先级、原队列同级 FIFO、资源准入在 Worker 执行名额之前。对应申报书 A04；非抢占、不绕过依赖、不改算法/SDK。275项Java、54项单测、60项浏览器及CEA两种联邦算法两轮回归通过。见[功能](features/PRIO-01-priority-admission.md)、[验证](verification/VER-PRIO-01-priority-admission.md)。

FLPAR-22（2026-09-16，实验DONE，M01未达标）：同10万累计/5万唯一样本的六客户端与三个双份客户端对照已部署CEA。修复测试观察器远端watch残留，连续3轮启停/干净批次8次均零残留；6Node/1Python、96Job及52模型104张量通过。正式均速1289.25/1298.95MB/s（+0.75%，不足以证明明显提速），端到端46.90/35.96秒；原业务/SDK/19服务不动，无Java/DB/API新增。首批及两次SDK时钟失败保留、不拼接统计。[证据](verification/VER-FLPAR-22-coarse.md)。

FLPAR-21（2026-09-16，实验DONE，M01未达标）：线性FedAvg候选/mmap/整批取样以四个新Application版本和两份隔离Flow部署CEA；5算法/3Node/11SDK测试、八次执行、120Job和64模型独立审计通过。正式均速860.84MB/s，比同期MLP高59.5%，不代表原模型等价加速或2GB/s；无Java/DB/API新增。[证据](verification/VER-FLPAR-21-linear.md)。

FLPAR-16（2026-09-16，DONE）：镜像准备按Registry实际digest复用，命中不生成虚假分发记录；聚合不再创建校验用模型，仅核对权重结构。273项Java/18项Python、48组288张量对照、三个CEA流程通过，其中FedAvg/FedProx完成两轮独立数值审计；不改变MET-001口径及此前高并发PARTIAL状态。后端与聚合应用已发布，原数据/历史保留。[验证](verification/VER-FLPAR-16-aggregate-reuse.md)。

FLPAR-14（2026-09-16，FL-001实测PASS，M01未通过）：均分后三客户端预热＋正式三次全成功；正式均值635.16MB/s、SDK2.410秒、总32.456秒，峰值训练并行3/2/3。36 Job/SDK、20模型80张量/11项Node核验通过，无新功能/Java/DB/Flow或服务配置变更，原对象保留。[验证](verification/VER-FLPAR-14-balanced-rate.md)。

FLPAR-13（2026-09-16，FL-001均分PASS）：当前CIFAR-10原始训练分片由8333/16667/25000改为16667/16667/16666，新raw v2及同镜像契约在CEA生效；五个预处理Flow r2不改成员或训练配置。存储回读、一次三集群执行/9 Job与SDK、5模型20张量及完整测试评估通过；无新生产能力/Java/DB/执行链，未重做性能对照或改变M01状态。[验证](verification/VER-FLPAR-13-balanced-shards.md)。

FLPAR-12（2026-09-16，FL-001低负载实测PASS，M01未通过）：1/2/3客户端正式各3/3成功，494.85/546.14/540.08MB/s，平均总耗时30.92/32.45/34.54秒。分片累计8333/25000/50000条，不是固定总量加速比；84 Job/SDK、48模型192张量核验通过。3个隔离Flow已在CEA可见，原对象/服务/计量保持，不新增生产能力、Java或DB结构。[验证](verification/VER-FLPAR-12-low-clients.md)。

FLPAR-11（2026-09-16，RUN-001/FILE-01修复DONE/PASS，已部署）：独立cgroup管理范围、授权先于Pod；264 Java测试/156 Job与SDK/80模型通过，启动Warning为0。18客户端正式平均52.136秒/566.49MB/s、训练主容器峰11～14、算法峰5～7，M01/18路同时计算未通过。原主链/算法/数据不变，无新Java类/DB/API。[验证](verification/VER-FLPAR-11-startup.md)。

FLPAR-04（FL-001/M01验证增量，2026-09-15）：隔离整批取样候选、4项Python一致性/11项原回归、18次本地诊断、6次正式CEA对照及2次预热全部完成。原/候选速率均值358.2/362.6MB/s，平均活动时间均5.638秒，未证明收益或2GB/s；96份SDK和实际模型审计通过。原业务定义/计量/容量保持，无生产Java/DB/API/执行链变化。[方案](../examples/federated/parallel-benchmark/BULK.md)、[验证](verification/VER-FLPAR-04-bulk.md)。

FLPAR-03（FL-001/M01验证增量，2026-09-15）：真实CEA单轮9客户端MLP训练batch对照12/12成功，32/256/1024/16384均值376.6/454.3/484.3/444.1MB/s；1024提高28.6%但accuracy下降，未达2GB/s。144份SDK/108个训练文件输入、四档数值审计PASS，原Flow与临时容量配置恢复；只扩展实验工具，无生产功能/Java/DB/API新增。[复测](../examples/federated/parallel-benchmark/BATCH.md)、[验证](verification/VER-FLPAR-03-batch.md)。

FLPAR-02（FL-001/M01验证增量，2026-09-15）：完成用户允许重复数据的3/6/9/12客户端扩量对照；FedAvg/CIFAR10九客户端均值315.5MB/s，比三客户端提高45.7%，十二客户端均值291.0且2/3成功。211份SDK、156次完整训练数据输入、四档模型核验PASS；重复数据不作为新增独立样本，不是2GB/s验收。无新生产功能域、Java/表/API/链，CEA配置恢复。[规格](../examples/federated/parallel-benchmark/REPEATED-LOAD.md)、[结果](verification/VER-FLPAR-02-repeated-load.md)。

FLPAR-01（FL-001/M01验证增量，2026-09-15）：真实CEA固定数据3/6并行对照完成，四组平均提高12.3%–45.9%，未达2GB/s；27次中26成功，额外控制失败保留。原业务定义及运行配置恢复，五组数值审计PASS；不新增功能域、Java/表/API/执行链。[规格](../examples/federated/parallel-benchmark/README.md)、[验证](verification/VER-FLPAR-01-parallel-clients.md)。

FLDATA-01（FL-001/RES-001数据增量，2026-09-15，DONE/PASS，已发布CEA）：接入完整CIFAR-10/CIFAR-100与100类模型，保留MNIST；现有数据目录、契约和两个Flow显式SELECT生效。262项Maven、11项Python、3项升级保留、53项前端单测、60项浏览器及四次CIFAR/一次MNIST真实两轮数值核验PASS。无新增功能域、Java/表/API/执行链；不是精度或2GB/s验收。[规格](features/S5-02-federated.md)、[协议](contracts/federated-datasets.md)、[验证](verification/VER-FLDATA-01-cifar.md)。

MET-001（2026-09-15，计量功能DONE/PASS，已发布CEA）：公共SDK/算法适配、受权查询和单一速率展示已实现，完整262项Maven、11项SDK、53项Node、60项浏览器及现场文件/区间/页面核验通过。2GB/s未达标，M03暂缓；现场失败及修复边界如实保留在[验证](verification/VER-MET-001-algorithm-measurement.md)。[功能](features/S5-05-measurement.md)、[协议](contracts/algorithm-measurement.md)。下列旧批次的计量“后置/未实现”是历史时点。

MET-04（DEP-002/M04验证增量，2026-09-14）：三个不同体量的常驻边缘HTTP示例已部署edge-a；24项镜像测试、12/12部署测量和3次展示业务核验、18080历史/页面PASS。首次2.190/4.372/12.318s，热缓存平均1.641/1.904/3.379s；仅对当前单宿主缓存条件有效。无平台Java/表/API/执行链新增，不新增功能编号；未完成无缓存或物理WAN验收，不改变MET-001等未完成状态。[示例规格](../examples/deployment-benchmark/README.md)、[验证](verification/VER-M04-edge-deployment.md)。

OFF-04（DONE/PASS核心闭环，2026-09-14已发布CEA）：六维网关Double DQN、合法动作/显式探索、真实next回放/目标网络、固定模型五基线比较及模型展示。255项Maven、52项Node、60项浏览器、30项本批Python、114次CEA真实请求及动作/页面核验PASS；[功能](features/OFF-04-double-dqn.md)、[验收](verification/VER-OFF-04-double-dqn.md)。未证明DQN比全终端更快；申报性能、多核/能耗/成本及S5-05不因本批完成而标记达标。以下OFF-03/02段落为对应历史时点。

OFF-03（DONE/PASS，2026-09-14已发布CEA）：新增六维真实观测、工作量/传输事实、终端端到端反馈、按决策顺序next关联与卸载观测页面。完整251项Maven及最终28项定向验证、52项Node、59项浏览器、41项Python和CEA六次实际执行通过；范围见[OFF-03](features/OFF-03-measured-feedback.md)，证据见[验收](verification/VER-OFF-03-measured-feedback.md)。OFF-04未开始。

OFF-02（OFF-001/002、RUN-001、EDGE增量，DONE/PASS，已发布）：元数据compute、网关终端代理、FIXED三层/RULE、小JSON结果返回；单一状态链/Binding、无新增DB表列，新增1个Java客户端及1个受权JSON结果API。244项Maven、51项Node、58项浏览器、25项Python及CEA四路径/存储/数值/页面核验PASS；见[验收](verification/VER-OFF-002-terminal-gateway.md)、[协议](contracts/off02-terminal-gateway.md)。OFF-03/04尚未实现，下列旧批次状态保留为历史。

OFF-01（OFF-001/002 增量，DONE/PASS，已发布）：层决策与资源 Placement 分离，删除卸载候选 Binding；旧单步 Q 暂不用于新任务。242项Maven、51项Node、58项浏览器、实际CEA API/页面与保留数据检查通过，见[验证](verification/VER-OFF-001-layer-placement.md)。OFF-02～04 未完成，不能把历史单步 Q 或本批 RULE 的 PASS 计作 Double DQN 验收。

申报书逐项覆盖及待补进度见[审查表](07-proposal-audit.md)（DOC-02，2026-09-14）。本索引继续汇总实现/验证状态；审查表只判断这些已实现范围与原文要求的差距，不新增领域功能编号，也不把MET-001或完整DQN标为完成。

EP-02（S5-03增量，DONE/PASS，已发布）：边缘处理记录、策略/状态服务端筛选分页、原执行详情与结果；240项Maven、50项Node、最终57项浏览器及实际CEA三记录/三结果JSON验收通过。没有第二套状态/表；原数据及其余15服务保持。见[规格](features/EP-02-processing-records.md)、[API](contracts/ep02-processing-records.md)、[实际验收](verification/VER-EP-002-processing-records.md)。

EP-01（S5-03/FILE-01增量，DONE/PASS，已发布）：实际HTTP网关、终端容器上传、三个策略与三种结果去向；237项Maven、19项新Python测试、4命令断网试跑和现场3执行/数值/归属/存储核验PASS。不新增功能域/Java/DB/DSL；[规格](features/EP-01-terminal-edge-examples.md)，[协议](contracts/ep01-gateway.md)，[验收](verification/VER-EP-001-terminal-edge.md)。

FILE-01（RUN-001/RES-001 增量，DONE/PASS，已发布CEA）：K8s Pod公共文件助手和按执行位置存储，不新增功能域/DSL/SQL/API；终端Docker保留既有文件路径。完整237项、最终8项K3s/1项JAR回归、8项助手测试通过；获批新增三边缘存储/Secret权限后，现场两算法各两轮/11个Job、四存储实物和独立数值复核PASS，历史保持。规格见 [FILE-01](features/FILE-01-pod-artifacts.md)，[验证](verification/VER-FILE-001-pod-artifacts.md)。

UI-05a（DONE/PASS，已发布CEA前端）：WF-006任务实例表按startedAt展示，不改原始数据/后端顺序/执行链；同时间保留原顺序，未开始置后。范围见[规格](features/UI-05-execution-inspection.md)，50项单测/55项浏览器及实际18080验收见[验证](verification/VER-UI-005a-task-start-order.md)。

UI-06a（DONE/PASS，已发布CEA前端）：WF-006既有Metrics页面增加柱状/折线显示切换，共用原值和实例坐标，不新增采集/计量或工作流能力。范围见[Metrics规格](features/UI-06-execution-metrics.md)，47项单测/54项浏览器及实际18080发布见[验证](verification/VER-UI-006a-chart-switch.md)。

UI-10（DONE/PASS，已发布CEA）：WF-003/WF-006、RES-001、SEC-001、DEP-001/002增加Flow/终态Execution/未引用Dataset逻辑删除、ADMIN/USER账号/个人中心和独立BuildKit在线构建。无新功能域、执行链或吞吐/DQN能力。边界见[工作包](features/UI-10-cleanup-users-build.md)和[协议](contracts/ui10-cleanup-users-build.md)，实际测试/部署见[验证](verification/VER-UI-010-cleanup-users-build.md)。

UI-09（DEP-001/DEP-002/RES-001管理补齐，DONE/PASS，已发布CEA）：Registry实际库存/详情/引用保护删除、应用目录删除、Service创建/删除/访问详情及多Namespace管理；不新造功能域ID。包含源tag与digest契约的无标签副本核验，不以历史记录代替库存。验证/发布结果见[验证记录](verification/VER-UI-009-registry-kubernetes.md)。

UI-08a：用户裁剪独立“容器用量”页面，当前前端只保留节点用量，不新增其他入口或平台能力。后端API和采集器不变；验证/发布状态见[进度](04-progress.md)。

UI-08-demo：DEP-001/002现成能力的常驻HTTP示例镜像、上传契约与部署参数已提供；8项HTTP及容器/归档检查PASS，没有新增平台能力或功能编号，未自动登记/部署到CEA。见[示例](../examples/deployment-demo/README.md)与[验证](verification/VER-UI-008-demo-image.md)。

UI-08已实现并于2026-09-13发布CEA：DEP-001/002、RES-001增加按需镜像分发历史、单镜像归档上传、常驻部署配置回读/CAS/手动扩缩容与就绪计时、Metrics API近期CPU/内存。4个新生产Java类，7个HTTP操作，V18/V19两张记录表；执行链和RES-002选址不变。实现阶段227项Maven、45项Node、47项浏览器通过；上线健康、迁移、四集群采样/权限和实际18080只读复核通过，既有数据与其余10服务保留。不是30秒或系统开销的正式性能验收。详见[规格](features/UI-08-core-deployment-operations.md)、[协议](contracts/ui08-deployment-operations.md)与[验证](verification/VER-UI-008-core-deployment-operations.md)。

UI-07已完成并发布CEA：WF-006/RES-001的只读展示增量——任务声明产物及JSON预览、执行全窗口SQL总览、Kubernetes资源查询。220项Maven、41项Node、44项浏览器测试通过；2026-09-12 19:51实际18080复核通过。无新功能编号/表/计量口径/执行链，原流程/历史不变。范围见[规格](features/UI-07-readonly-inspection.md)，实际测试与发布见[验证](verification/VER-UI-007-readonly-inspection.md)。

UI-06已完成并发布：基于已有JSON产物展示实例指标，新增受READ授权的有界读取；216项Maven、40项Node、42项浏览器及构建/格式/scaffold通过。2026-09-12 17:15仅更新CEA前后端，实际两算法历史指标图/表与API一致、桌面/390px复核PASS；两Flow/历史及4条执行不变，其余10服务未重启。无新计量领域功能，MET-001仍后置。[规格](features/UI-06-execution-metrics.md)，[验证](verification/VER-UI-006-execution-metrics.md)。

UI-05已完成并发布：WF-016既有执行数据的前端消费者，固定修订拓扑、TaskRun输出/时间/尝试及两个联邦Flow显式SELECT。36项Node、40项浏览器、215项Maven与构建/格式/scaffold通过；CEA前端及FedAvg r5/FedProx r3只读实测PASS，历史和其余11服务未变。不新增后端领域功能或计量口径。[规格](features/UI-05-execution-inspection.md)，[验证](verification/VER-UI-005-execution-inspection.md)。

UI-02d已完成并发布：WF-016既有Loop集合每项JSON编辑，保留数组增删排序与原Binding；不新增领域能力。31项Node、37项浏览器、215项Maven及构建/格式/scaffold通过；只更新CEA前端，实际页面复核PASS，两Flow及四条历史执行未变，其余11个服务未重启。[功能规格](features/UI-02d-loop-json-items.md)，[验证记录](verification/VER-UI-002d-loop-json-items.md)。

UI-02c已完成并发布：WF-016既有No-code的必填字段前置、任务配置展平和来源下拉展示。31项Node、37项浏览器、215项Maven及构建/格式/scaffold通过；只更新CEA前端，实际页面复核PASS，两Flow及四条历史执行未变，其余11个服务未重启。不新增领域能力、Java、表、API或执行链。[功能规格](features/UI-02c-task-form-layout.md)，[验证记录](verification/VER-UI-002c-task-form-layout.md)。

UI-04已完成并发布：WF-002/WF-016增加固定字符串SELECT、values、默认值/必填和端到端成员校验；30项Node、36项浏览器、215项Maven及构建/格式/scaffold通过。已按用户确认同步更新CEA前后端并只读复核，不改两Flow及四条历史执行，其他十个容器未重启。不新增功能编号、API、表或执行链。[语义与边界](features/UI-04-select-input.md)，[验证记录](verification/VER-UI-004-select-input.md)。

UI-02b已完成并发布：Loop.values的Array/引用及逐项集合编辑，FedAvg/FedProx移除clients启动输入，实际CEA修订为r4/r2。29项Node、34项浏览器、212项Maven及构建/格式/scaffold通过，实际页面和历史保留复核PASS，其余11个服务未重启。无新领域功能编号或后端执行能力，见[记录](verification/VER-UI-002b-loop-values.md)。

UI-02a修复候选集群选中反馈：高亮/勾选、点击取消、YAML同源回显和固定列表/LITERAL切换保留。29项Node、30项浏览器、212项Maven及构建/格式/结构检查通过，已按确认更新18080并只读复核，其他11个服务未重启；见[验证记录](verification/VER-UI-002a-cluster-selection.md)。无新后端模型或执行链。

UI-03a已删除常驻教学/架构说明，不新增展开帮助或tooltip；保留字段、真实数据、错误/确认/结果。29项Node、29项浏览器、212项Maven及构建/格式/结构检查通过。用户确认后已更新18080前端并只读复核，其余11个服务未重启；见[验证记录](verification/VER-UI-003a-copy-cleanup.md)。不新增领域功能编号或后端能力。

UI-03是RES-001、DEP-001/002、EDGE-001/002及OFF-002的前端消费者，沿用现有编号/API；只读卸载页不扩展模型研究。已有管理功能与真实分发/部署/策略事件验收通过，29项Node、28项浏览器及212项Maven/12项Python PASS。已更新CEA前端，详细已迁移/缺接口列表及失败经过见[UI-03规格](features/UI-03-management.md)和[验收](verification/VER-UI-003-management.md)。MIG-001旧数据/模板转换与切换仍未实施。

UI-02是WF-016/WF-002/WF-003的前端消费者，不增加功能编号或后端模型；任务块、单表单、原Binding/目录、同源YAML和修订比较回退已实现，测试与部署状态见[UI-02验收](verification/VER-UI-002-no-code.md)。[功能边界](features/UI-02-no-code.md)不含完整Kestra、资源注册管理、Pod日志、指标或旧数据迁移。下方UI-01/S6描述保留对应历史批次边界。

DEPLOY-01是OPS-001/FL-001的独立部署工作包，当前DONE/PASS，不是新增领域能力。[范围](features/DEPLOY-01-independent.md)与[实测记录](verification/VER-DEPLOY-001-cea.md)覆盖D盘Compose、显式配置、四集群联邦算法、浏览器和重启复核；FL-001本批已扩至真实MNIST训练60000/测试10000。算法Pod stdout未汇入Execution日志；不包含MIG-001旧数据转换/切换，OPS汇总仍保留最终上线未验收的边界。

UI-01新增独立前端最小闭环，归WF-016编辑协议的当前消费者；[工作包](features/UI-01-console.md)、[验证记录](verification/VER-UI-001-console.md)。只覆盖源编辑与基本执行管理，不把完整No-code或全部旧管理页面标为完成。

当前增量：S6-02至04的Namespace Files、Webhook/Checks/SLA/afterExecution已实现，212项Maven/12项Python完整verify通过，见[验收](verification/VER-S6-002-files-lifecycle.md)。WF-016完成的是后端编辑协议，不是完整前端。用户同意S5计量和DQN研究后置，MET-001仍未实现。

本表是功能编号和状态的唯一汇总。NOT_STARTED 表示没有业务实现，NOT_RUN 表示没有该功能的测试结果。SCAFFOLD 仅指目录、POM 和包声明，不能称为业务完成。

| 编号 | 功能 | 计划阶段 | 主责模块 | 实现状态 | 验证状态 |
|---|---|---|---|---|---|
| FND-001 | 工程和文档框架 | S0 | platform-server | SCAFFOLD | PASS |
| WF-001 | Flow/Task 模型、解析和结构校验 | S1 | workflow-runtime | IMPLEMENTED | PASS |
| WF-002 | Inputs/Variables/Outputs 类型与绑定 | S1 | workflow-runtime | IMPLEMENTED | PASS |
| WF-003 | 模板持久化、不可变版本、回滚与受保护逻辑删除 | S1/UI-10 | platform-dataflow | IMPLEMENTED | PASS |
| WF-004 | 手动提交、Execution/TaskRun/Attempt 状态 | S1 | workflow-runtime | IMPLEMENTED | PASS |
| WF-005 | 持久消息、幂等、顺序任务、Log 闭环 | S1 | workflow-runtime | IMPLEMENTED | PASS |
| WF-006 | 执行历史、日志、结果查询与终态历史逻辑删除 | S1/UI-10 | platform-dataflow | IMPLEMENTED | PASS |
| WF-007 | Worker 租约、结果归并、接管和恢复 | S2 | workflow-runtime | IMPLEMENTED | PASS |
| WF-008 | Constant Retry、超时、取消、Errors/Finally | S2 | workflow-runtime | IMPLEMENTED | PASS |
| WF-009 | DAG/Topology、If/Else、Parallel | S3 | workflow-runtime | IMPLEMENTED | PASS |
| WF-010 | 并发槽、FIFO、QUEUE/FAIL | S3 | workflow-runtime | IMPLEMENTED | PASS |
| WF-011 | Schedule/Cron、Disabled、触发幂等 | S3 | workflow-runtime | IMPLEMENTED | PASS |
| WF-012 | HTTP/SQL 与隔离 Shell/Python Task | S4 | workflow-runtime | IMPLEMENTED | PASS |
| WF-013 | Repeat 状态反馈、轮次隔离和屏障 | S5 | workflow-runtime | IMPLEMENTED | PASS |
| FL-001 | FedAvg/FedProx应用与显式Flow迁移 | S5 | platform-dataflow | IMPLEMENTED | PASS |
| WF-014 | Webhook/Checks/SLA/afterExecution | S6 | workflow-runtime | IMPLEMENTED | PASS |
| WF-015 | Namespace Files、导入导出、搜索过滤 | S6 | platform-dataflow | IMPLEMENTED | PASS |
| WF-017 | 通用动态Loop、item作用域、有序集合输出 | S5 | workflow-runtime | IMPLEMENTED | PASS |
| WF-016 | 统一编辑 Schema、No-code 前端对接 | S6/UI-01/02/03 | platform-dataflow/frontend | IMPLEMENTED（当前DSL的同源No-code/源码；含策略入口） | PASS（当前范围） |
| RES-001 | 站点/集群资源、数据集版本与本地性 | S4 | platform-resource | IMPLEMENTED | PASS |
| RES-002 | 普通选址、共享资源预约与释放 | S4 | platform-resource | IMPLEMENTED | PASS |
| DEP-001 | 应用目录、镜像契约 | S4 | platform-deployment | IMPLEMENTED | PASS |
| DEP-002 | 镜像上传/在线构建/复制、分发历史、常驻部署管理 | S4/UI-08/09/10 | platform-deployment | IMPLEMENTED | PASS |
| RUN-001 | Kubernetes Job、终端Docker与产物发布 | S4/S5 | workflow-runtime | IMPLEMENTED | PASS |
| EDGE-001 | 网关/终端接入、事件和状态同步 | S5 | platform-edge | IMPLEMENTED | PASS |
| EDGE-002 | 边缘数据处理策略与结果交付 | S5 | platform-edge | IMPLEMENTED | PASS |
| OFF-001 | 终端卸载资格、选层与Placement拆分、网关三路径 | S5/OFF | platform-offloading | IMPLEMENTED | OFF-01/02/04及CEA三路径PASS |
| OFF-002 | 六维真实状态、反馈/next、边缘Double DQN和五基线比较 | S5/OFF | platform-offloading | IMPLEMENTED | OFF-03/04核心及CEA PASS；不代表性能优势或多目标/多核完成 |
| MET-001 | SDK 样本、完整性与单一处理速率口径 | S5 | platform-dataflow | DONE | PASS |
| SEC-001 | 身份、命名空间权限、两角色人员/个人中心与内部通信认证 | S1/S4/UI-10 | platform-foundation/platform-server | IMPLEMENTED | PASS |
| MIG-001 | 旧功能/模板转换与切换 | S7 | platform-server | NOT_STARTED | NOT_RUN |
| OPS-001 | 最小部署与单机恢复验收 | S4/S7 | platform-server | IN_PROGRESS | PARTIAL |

状态定义见[文档规范](05-documentation-guide.md)。FND-001 的具体范围见[框架规格](features/FND-001-scaffold.md)。WF-001至WF-006及SEC-001本地部分见[S1规格](features/WF-001-006-s1.md)与[验收记录](verification/VER-S1-001-durable-log.md)。WF-007/008见[S2规格](features/WF-007-008-s2.md)与[S2验收记录](verification/VER-S2-001-worker-lifecycle.md)。本次同时回归S1。未开始功能用[模板](features/TEMPLATE.md)补齐行为和验收条件，不为未开始功能批量制造空规格。

SEC-001 分层落地：S1 保证本地接口边界与身份契约；接入站点/远程Worker API前完成真实鉴权；S2共享专用MySQL的本地Worker进程不提供远程Worker HTTP接口，不能把“后面做权限”当成可上线状态。WF-016 的完整前端实现需明确授权与前端工程范围，新后端已实现后端编辑协议与 Schema。

WF-009至WF-011见[S3规格](features/WF-009-011-s3.md)、[协议](contracts/s3-protocol.md)与[验收记录](verification/VER-S3-001-control-scheduling.md)。S3历史75项测试通过；控制任务由Executor解释；该历史阶段叶子仅Log/Sleep。

S4工作包见[S4规格](features/S4-resource-runtime.md)。S4-01/02历史验收保留；本批增加真实节点健康/本地性/平台Job槽预约、Application Job及命名文件、GET/POST与只读SQL、隔离Shell/Python。123项统一验证与实际JAR部署验收通过，见[VER-S4-005](verification/VER-S4-005-external-task-runtime.md)。

RES-001包含节点健康与UI-08近期Metrics API用量查询，不提供Prometheus历史监控体系；RES-002预约平台槽，不使用这些采样决定Placement、不冒充CPU物理独占。DEP-001仍为纯契约目录，镜像上传经DEP-002受控导入后调用原目录登记；显式Flow绑定在真实执行消费者解析。命名文件由Flow声明，不新增自动alias/映射表。DEP-002常驻Deployment不等于Job。

详细边界见[Job协议](contracts/s4-job-execution.md)、[通用任务](contracts/s4-common-tasks.md)和[部署说明](operations/s4-minimal-deployment.md)。SQL写入、其他HTTP方法、Windows/distroless、完整No-code前端仍未实现；不通过隐藏这些限制冒充迁移了Kestra全套插件。S6后端范围已完成并通过完整回归；S7未进入。

SEC-001按已接入接口及ADMIN/USER人员管理的最小范围PASS，不表示TLS、SSO或复杂IAM已实现。OPS-001的S4空库部署和单机恢复部分PASS；因还包含S7最终上线环境复验，汇总仍IN_PROGRESS/PARTIAL，不将S7提前标完成。
S5的WF-013、WF-017与FL-001已实现，150项Maven verify及7项Python测试通过，见[Loop及动态联邦学习验收](verification/VER-S5-003-loop.md)及[S5工作包](features/S5-research-edge.md)。FL-001仅真实MNIST子集两轮功能验收，不包含其他流任务、物理多云或性能基准。计量口径仍待确认，MET未实现；S5整体仍IN_PROGRESS。EDGE-001/002已按后端接入/策略协议范围完成，166项全量回归及107项收尾复测通过，见[接入验收](verification/VER-S5-004-edge-access.md)；不表示已部署物理网关代理。

S5-04a完成RUN-001终端Docker与可信来源基础；S5-04b增加OFF-001/002的显式卸载、规则/单步Q、画像/反馈及终端FIFO。新增3表、3个HTTP操作，原执行链不变。188项Maven与12项Python全量验证通过，见[本批验收](verification/VER-S5-006-terminal-offloading.md)。状态仅代表当前最小范围，单步模型不等于多步长期DQN优化，未做策略性能对比。

S6-02至04及完整verify已完成；字段消费者、最小范围及验证见[协议](contracts/s6-files-lifecycle.md)与[VER-S6-002](verification/VER-S6-002-files-lifecycle.md)。不做完整前端、计量或长期DQN。
