# VER-FILE-001 Pod 文件助手

日期：2026-09-13。起点：backend main `6da17e9`；实现提交`294c049`。代码/测试完成后，用户明确“部署”，已发布CEA并完成下述现场核验。本次部署未修改Java/Python业务代码，未把上一轮完整回归记为本次重跑。

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
- 实施时已构建 `cea/backend:file01-candidate`、`cea/file-helper:file01-candidate`，等待新增基础设施确认期间未替换运行镜像；随后发布结果见下节。

## 发布前现场基线（只读）

13 个 CEA 服务，2 个 Flow / 8 个修订，5 条历史 Execution（3 SUCCESS、1 FAILED、1 KILLED），100 个 TaskRun、78 个 Attempt、2 个 DatasetVersion；worker 队列为0，没有活动 Execution。三个历史成功执行的 Metrics JSON 可读，已记录原值。快照在 ignored 的 `.local/cea/file01/before.json`、`history.json`，未上传凭据或历史业务文件。

上述基线于发布前再次核对通过；无活动Execution、WorkerJob为0。保留`cea/backend:before-file01-20260913`（原镜像`sha256:8a60ceec602a3a8852a64335ff25266fc4ef15643498359cd6f708a2a431737b`）、旧application配置和四集群Role JSON，然后短停backend。

等待确认期间的application运行配置曾暂保留旧中心格式，避免旧镜像意外重启读到不兼容配置；本次已用新配置恢复该有意差异。源码不增加旧配置或旧K8s搬运兼容分支。

## CEA现场发布与实测（18:29–18:32，PASS）

- 应用`setup-files.ps1`：新增`minio-edge-a/b/c`和`cea_minio-edge-a-data`、`cea_minio-edge-b-data`、`cea_minio-edge-c-data`三个独立卷、三个产物桶及权限；原中心MinIO/数据集不迁移。助手镜像实际推送到四个Registry，统一manifest digest为`sha256:d113e1d76f7a5daf5a0c2c3754324470f963d5f518f7f33c8a53a1e67f890336`。setup重新构建复用缓存，helper config digest仍为`sha256:1a1ef23b9ee829aa0a5dc03e3757d242cb1ce63fc7c7b3b946f351199f352bf7`，与候选相同；归档经Skopeo转为Registry manifest，manifest digest不等于本地BuildKit index。
- 四集群的`cea-lab/cea-backend`角色撤销`pods/exec`，应用`secrets get/create/update/delete`；实际身份权限查询核实。Namespace、ServiceAccount及已有token Secret apply结果均为unchanged。未重启K3s、Registry、MySQL、原MinIO或builder。
- backend于18:29:08启动，运行镜像`sha256:2c3246affb82f5214a5f60008da623166a0c4d3b9e5775531b97964f0d44c49b`，来自已测试candidate；frontend仅nginx reload。18:29:15 `/health`为UP，18080代理API可访问，全部16个CEA服务运行，有健康检查的服务均healthy。本批无前端代码，不重建前端镜像。
- Flyway最新仍为V24且成功；无新增SQL迁移。FedAvg r5、FedProx r3及全部8修订保留，2个DatasetVersion保留。

| 现场执行 | Execution ID | 完成时间（+08:00） | 第二轮loss / accuracy | 验证 |
|---|---|---|---|---|
| FedAvg r5，两轮 | `d57ad3fc-4c06-4094-9d10-dd84396cc795` | 18:30:10 | 1.10355718460083 / 0.6229 | 11个Job、独立数值PASS |
| FedProx r3，两轮 | `4dde3868-222f-4f3c-86d4-f9db8468f1f8` | 18:31:34 | 1.0562005699157715 / 0.6346 | 11个Job、独立数值PASS |

执行均由现有`verify-federated.ps1`通过原API提交，只覆盖启动输入rounds=2，未修改保存的Flow。两轮各三个客户端train位于edge-a/b/c，init/aggregate/evaluate位于cloud；独立审计复算训练/加权聚合/评估，评估每轮10000条MNIST测试样本。没有把mc传文件显示的速度当作算法吞吐率。

22个Job均包含files-in init及files-out容器，算法容器没有file-plan挂载；完成后22个临时文件Secret均已清理，未残留其他助手Secret。新产物分别从四个实际MinIO读取，数值审计无需旧中心搬运链。

18:32:38额外核对两个Execution前缀的实际对象库存：每个执行共11个对象，中心`cea-artifacts`恰好5个（init、2个aggregate模型、2个evaluate JSON），每个`cea-artifacts-edge-*`恰好2个train模型，键集合与TaskRun成功输出完全一致，中心没有train副本。中心聚合Pod将边缘文件读入临时工作目录，并不先复制进中心对象桶。四份新evaluate JSON均经实际18080的授权output-json API读取，轮次/算法/样本数正确。

发布后对照：2份Flow完整API对象、原5份Execution、原100个TaskRun及3份历史成功Metrics原值全部一致；12个原非backend容器ID/StartedAt/镜像不变。新增两个验证执行后，总计7个Execution（5 SUCCESS、1 FAILED、1 KILLED）、128个TaskRun、100个Attempt；WorkerJob为0，100条Job预约均released=true，终端预约为0。原`http-server`Deployment仍generation=1、ready/available=1。未删除已有数据、工作负载或原卷。

现场证据仅存ignored的`.local/cea/file01/release.json`、`store-inventory.json`及`.local/cea/evidence/{fedavg,fedprox}/<ExecutionId>/`（执行、TaskRuns、Job、模型和numerical-audit）。发布文档进Git，真实模型/凭据/本地快照不上传。已有边缘产物后，旧中心-only backend无法正确处理这些URI，不能只切旧镜像回退；保留所有存储和配置，优先修复向前。

## 迭代记录和限制

- 第一次定向 Maven 命令因 PowerShell 把未加引号的带点 `-D` 属性拆开而失败；修正为引号参数后运行4项通过，不归因为业务代码故障。
- 核对数据库字段时两条只读查询误用了 wf_flow/revision，返回表/列不存在；按真实 schema改正后取得上述基线，未写数据库。
- 完整回归中的旧版本升级拒绝案例会故意打印 Migration failed，须看最终测试报告，不将这些预期错误当作上线数据库失败。
- 现场辅助只读检查曾误用`/actuator/health`、Attempt的prepared_json列和未加引号的kubectl逗号参数，均未写业务数据；改用实际`/health`、schema和JSON查询。额外库存脚本首次将REST数组包成嵌套数组，校正后库存断言PASS，不涉及平台代码或重新执行算法。
- 当前 CEA 是同宿主四个独立集群/存储，不是跨地域物理多云；数据集仍在原中央 datasets 桶，不宣称边缘数据自治、分片续传、GC或吞吐指标完成。
