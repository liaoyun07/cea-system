# OFF-01 验证：选层 / Placement 职责拆分

2026-09-14，基于本批开始时干净的 main（c4eabfa），本记录随实现同次提交。OFF-01 DONE/PASS，已发布 CEA；不表示 OFF-02～04 完成。

## 范围

见 [ADR-0025](../decisions/ADR-0025-offloading-layer-placement.md) 与 [协议](../contracts/s5-terminal-offloading.md)。删除卸载候选 cluster 绑定和代表位置挑选；只配置系统中心云范围，保持普通集群候选和可信来源。V25 仅放宽观测 target_id 可空，不删旧行，不添加表/Java 类/状态机。

## 已执行

- 15:29 首轮编译发现 ApplicationTaskRunner 的 cluster 多次赋值不满足 lambda effectively-final；改为互斥分支各赋值一次后重跑。
- 15:30:44 定向 47 项通过：Definition 19、ControlFlow 13、Contract 3、Offloading 12；后两类包含真实 MySQL/HTTP。
- 15:31 前端 51 项 Node、Vite 构建与 Prettier 检查通过；新增“层已确定/位置待分配”的显示测试。
- 15:45:56 完整 scripts/verify.ps1 PASS：242 项（runtime 35、server 206、打包 JAR 启动 1），无失败/错误/跳过。JDK 21.0.7、Maven 3.8.8、Docker Desktop；包含真实 MySQL/Registry/BuildKit/K3s/Docker、普通任务观测表故障隔离、终端 FIFO/取消/重试/接管、FedAvg/FedProx 和原文件助手链。故障注入的 SQL/通信告警为测试日志，未发生 CEA 生产故障。
- 15:37 隔离三层 RULE 容器用例已生成新证据 layer-placement-samples.json：TERMINAL→pc、EDGE→edge、CLOUD→cloud-alt 均 SUCCESS；云的第一个配置位置 cloud 槽位被占满，由 Placement 选择第二个位置 cloud-alt。新记录 state/modelVersion 均空，不调用旧网络。单机临时 K3s 位置别名测试不是物理多云性能测试。

## 浏览器与 CEA 发布

58 项真实浏览器回归全部通过（3.4分钟，新临时MySQL/K3s/Registry/BuildKit及打包JAR）。新增用例确认 YAML/No-code 保留同一 offload 定义、editor schema 删除卸载候选、RULE校验200、旧候选/DQN校验422。前端最终“未分配”文案再次通过51项Node、构建及格式检查。

15:50:54 CEA backend/frontend 均 Healthy，V25 已应用且 target_id 可空；nginx 已刷新。15:51～52实际18080的RULE校验200、旧候选/DQN校验422、schema仅列RULE、原FedAvg/FedProx页面/拓扑/Metrics/两种宽度/管理页面复核PASS。未保存测试Flow、未创建生产Execution、未运行生产性能实验。

原2个USER Flow和3个策略的11份修订、10条Execution、132个TaskRun、104个Attempt及2个Dataset保持；其余15个容器ID/镜像/启动时间保持。三条边缘处理记录及原结果可读。证据在ignored的 .local/cea/off01/（before/after、API校验、数据库备份）与 .local/cea/browser/；公开文档不复制凭据或业务快照。

本批镜像：backend `sha256:9e03ef38d8524a99397aabb069975b4a049e7c453dcc417e8426d946bbfe54a2`；frontend `sha256:ab9240ef830076a8e8bf61a99d6e6d7791bc4ccf148214de1d8b2a9b4647ad08`。运行容器镜像与构建产物一致。原镜像保留为 before-off01；原配置从干净HEAD留存。没有重启MySQL、网关、MinIO、Registry、BuildKit或算法集群，没有删除业务数据。

OFF-02元数据先行/网关派发/本地文件不上传、OFF-03端到端状态反馈、OFF-04边缘Double DQN与五基线比较仍未实现。现有Docker直连容器回归不能代替这些验收。

发布前已只读核对：现有 11 份 Flow 修订、10 条 Execution，无旧 offload.candidateClusters 快照、无活动 Execution/WorkerJob，卸载观测/模型均为 0。保留前后端 before-off01 镜像；数据库完整 mysqldump 275452 字节（含完成标记）存入 ignored 的 .local/cea/off01/database-before.sql，不提交公开仓库。
