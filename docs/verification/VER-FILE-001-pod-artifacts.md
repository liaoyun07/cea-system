# VER-FILE-001 Pod 文件助手

日期：2026-09-13。起点：backend main `6da17e9`。生产代码对应本记录所在FILE-01提交；代码/测试完成，新增基础设施确认待回复，未发布CEA。

## 环境和范围

Windows / JDK 21.0.12 / Docker Desktop（D:\DockerDesktop\DockerDesktopWSL），真实 MySQL 8、Registry v2、K3s 1.30.6、两个隔离 MinIO。生产代码无新增 Java 文件、SQL/API/DSL；运行主链不变，仅 K8s 文件传输与输出存储路由改变，终端 Filesystem 保留。

## 已取得的结果

- Maven package（跳过测试）：17:52:15 成功，仅证明编译/打包。
- 公共助手 8 项 Linux unittest：真实 HTTP GET/PUT、二进制/空文件、缺失输入/输出、失败算法不发布、路径/软链接/FIFO拒绝、刷新授权重试，PASS。再次运行包含 `data` 与 `data.part` 内联名字不冲突的断言，PASS。
- 17:56:21 定向 K3s 4 项 PASS：真实数据集→上游/下游文件链、跨两个真实 MinIO、缺失输入/输出、清单 Worker 接管同 Job/Attempt、成功后 Secret 清理、算法不挂授权计划。
- scaffold：104 个生产 Java 文件，模块依赖无环，PASS。部署脚本 PowerShell 解析和 Compose config --quiet PASS。
- 18:11:51 完整 `scripts/verify.ps1` PASS：35项runtime + 201项server + 1项打包JAR真实MySQL启动 = 237项，零失败/错误/跳过。包含47项真实Registry/K3s/存储/终端测试，FedAvg/FedProx两轮及独立数值审计。
- 最终补充 `mvn verify` 于18:18:19 PASS：8项真实K3s用例（文件链、跨存储/缺失输入、缺失输出、Worker接管、取消、终端到集群、FedAvg、FedProx）+ 1项打包JAR验证。重新编译所有模块，覆盖完整回归后新增的URI dot-segment拒绝、终端adapter作用域收紧、Secret按Job所有权/CAS清理。不是另增9个独立功能测试总数。
- 最终FedAvg 18:17:10 / FedProx 18:15:51数值审计PASS；两个轮次模型/指标与独立计算一致，train URI为edge-artifacts，init/aggregate/evaluate URI为artifacts。四个目录执行位置映射到一个隔离K3s、两个独立MinIO，非现场CEA四集群验证。
- 候选镜像 `cea/backend:file01-candidate`、`cea/file-helper:file01-candidate` 构建成功。没有覆盖运行中的 `cea/backend:local`；未推送助手到CEA Registry。

## 发布前现场基线（只读）

13 个 CEA 服务，2 个 Flow / 8 个修订，5 条历史 Execution（3 SUCCESS、1 FAILED、1 KILLED），100 个 TaskRun、78 个 Attempt、2 个 DatasetVersion；worker 队列为0，没有活动 Execution。三个历史成功执行的 Metrics JSON 可读，已记录原值。快照在 ignored 的 `.local/cea/file01/before.json`、`history.json`，未上传凭据或历史业务文件。

新增三个边缘 MinIO、helper Secret RBAC 尚待用户单独确认；未部署新后端/助手或操作原服务。发布后必须：重查排空、保留旧镜像/配置、只更新 backend（frontend仅reload上游DNS）、验证健康、历史 Flow/TaskRun/Metrics保持、新 FedAvg/FedProx两轮/各11真实Job/四存储路径和独立数值审计。

暂停等待确认时，将已提交的新application配置另存`.local/cea/file01/application-ready.yaml`，工作区同名运行配置暂恢复原中心格式，以免当前旧镜像意外重启时读到不兼容配置；这个有意的工作区差异不属于用户无关修改，获准发布时需恢复新配置。源码不增加旧配置或旧K8s搬运兼容分支。

## 迭代记录和限制

- 第一次定向 Maven 命令因 PowerShell 把未加引号的带点 `-D` 属性拆开而失败；修正为引号参数后运行4项通过，不归因为业务代码故障。
- 核对数据库字段时两条只读查询误用了 wf_flow/revision，返回表/列不存在；按真实 schema改正后取得上述基线，未写数据库。
- 完整回归中的旧版本升级拒绝案例会故意打印 Migration failed，须看最终测试报告，不将这些预期错误当作上线数据库失败。
- 当前 CEA 是同宿主四个独立集群/存储，不是跨地域物理多云；数据集仍在原中央 datasets 桶，不宣称边缘数据自治、分片续传、GC或吞吐指标完成。
