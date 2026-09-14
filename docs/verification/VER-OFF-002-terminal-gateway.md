# OFF-02 验证：终端元数据、三条执行路径与结果返回

2026-09-14，基于干净main `35b6b66`，本记录随本批代码提交。OFF-02 DONE/PASS，已部署CEA；不是OFF-03/04或性能验收。

## 实际变化

终端只把不可变fileId/bytes和事件类型交给网关，复用原接入事件及策略Flow。FIXED/RULE选层、Resource预约后：TERMINAL通过网关驱动终端Docker，原始数据不上传；EDGE/CLOUD经网关把原文件写所属边缘S3，原Kubernetes Runner/文件助手直读源对象。终端输出写所属边缘，集群输出写执行本域，成功小JSON通过原产物授权返回网关/终端。

新增1份生产Java `TerminalGatewayClient`（总数105），封装服务端配置网关的有界认证RPC；新增1个GET终端结果API（平台操作90→91）。修改ApplicationTaskRunner、JobConfiguration、ExecutionOutputService、EdgeAccessService/Controller、OffloadingService及原DSL校验/schema/model；没有删生产类、没有新增表/列/migration/SPI/Executor/Worker/Binding来源。新增Offload.layer仅供FIXED，Prepared.terminalFiles/gatewayTerminal、网关连接及LocalFile有实际执行消费者，详见[协议](../contracts/off02-terminal-gateway.md)。原运行状态、重试、取消和接管仍归runtime。

Python网关增加元数据/受信内部转发，终端agent只执行Docker副作用，compute是一次性请求/查询客户端，不是新调度器。新增振动窗口示例及CEA安装/实物核验脚本。沿用Kestra的Executor推进、Worker/Runner执行边界，网关RPC参考ThingsBoard；远程终端文件和三层是项目差异，不声称Kestra原生提供同样终端卸载。[依据与简化](../decisions/ADR-0026-terminal-gateway-runner.md)。

## 自动化验证

环境：JDK21.0.7、Maven3.8.8、Docker Desktop；隔离测试使用真实MySQL、Registry、K3s、MinIO和独立Docker模拟终端，不连接旧系统。

- 16:37:23 `scripts/verify.ps1`完整PASS：244项（runtime35、server208、打包JAR启动1），0失败/错误/跳过。保留普通Flow、FedAvg/FedProx、FILE-01、原显式Docker Context、Placement、数据库故障等回归。
- `ImageDistributionTest.gatewayMetadataThreePathsLocalNoUploadAndScopedCloudResult`：真实网关/代理/独立Docker与K3s三层+RULE成功；决策前不上传、本地完成后无原文件S3对象，边缘上传原字节一致、云结果可经网关返回、其它终端不可读。非零退出由原runtime产生2次Attempt；Worker中断/租约接管仍是同一容器ID和单次写入；取消确认容器退出后Execution为KILLED。
- `OffloadingTest`新增FIXED合法层/不可用拒绝/不静默回退；DSL浏览器回归拒绝FIXED缺层、RULE带层、旧offload.candidateClusters及DQN，新FIXED通过。
- 前端51项Node、构建和格式检查PASS；58项真实浏览器回归PASS（3.4分钟），使用新打包JAR及临时数据库/集群；本批不修改前端生产源码。
- Python25项PASS：gateway16、terminal-agent6、signal3。覆盖元数据鉴权、跨终端/内部令牌、重复物化、文件边界、同Attempt配置/复用、持久取消、结果校验及独立计算。
- 示例镜像断网、只读根文件系统下运行成功，输出与独立sum式参考计算的六项值一致，绝对误差≤1e-10。
- 文档收尾结构检查PASS：8模块、无环依赖、105份Java索引、32个功能ID、660个本地链接；Git差异空白检查通过。最终51项Node和25项Python再次通过。

初次定向隔离测试因fixture重复设置storage output edge路径失败，修正参数后定向和完整verify均通过，非生产故障。后续检查发现无ListBucket权限时，缺失对象HEAD可能403：改为对同一不可变源/确定key执行幂等PUT（权限或存储错误继续失败），没有扩大S3权限；新增Python用例及最终CEA实际EDGE/CLOUD路径通过。该网关修正不改变Java测试产物，实际发布的是修正后的网关镜像。

## CEA发布与现场结果

16:44:42完成发布，仅重建backend/edge-gateway，新增terminal-agent和terminal-engine；frontend仅nginx reload。19个常驻服务，新增4个专用卷（Docker数据、独立socket、工作文件、Attempt描述/取消标记）。只有terminal-engine特权，只监听Unix socket；无宿主Docker socket挂载、无Docker TCP服务及端口发布。后台JAR SHA-256与本次完整verify产物一致。

同一合成振动文件1507314字节、131072采样点、128窗口、16个冲击告警窗口，同一offload-signal/off02-v1镜像：

| 策略 | 真实Execution | 实际位置 | 原文件上传到边缘 | 结果存储 | 结果 |
|---|---|---|---:|---|---|
| offload-terminal | c25e0c51-831b-4d4b-93ec-526a53ea7840 | ep01-terminal | 0 B | cea-artifacts-edge-a | SUCCESS |
| offload-edge | 3ad9580e-499a-47cc-a11a-7b8d589ddf0b | edge-a | 1507314 B | cea-artifacts-edge-a | SUCCESS |
| offload-cloud | c4245985-baad-478c-9e5d-8a3a2e38cef4 | cloud | 1507314 B | cea-artifacts | SUCCESS |
| offload-rule | 58727600-dcca-4bae-9287-dd9aea680b83 | ep01-terminal | 0 B | cea-artifacts-edge-a | SUCCESS |

RULE在这次空闲资源下按既有容量评分选终端，不据此宣称策略最优。四路径六项数值一致且与独立参考误差≤1e-10；S3实际对象内容逐字节核对，云输入没有强制中心副本。终端保存的返回结果与成功TaskRun产物一致，不只是检查HTTP202或容器Running。

16:45～47真实18080浏览器PASS：4个新策略/执行可在“边缘处理记录”按策略筛选，显示可信终端/网关/来源边缘，详情和输出指向同一成功执行；桌面1440与390px无页面横向溢出。原FedAvg/FedProx历史、拓扑、Metrics及四集群资源/管理页面回归PASS。

原2个USER Flow、3个策略的完整定义及原10个Execution、2个Dataset保持原值；其余15个常驻容器ID/镜像/启动时间不变。未删除业务数据、未重跑旧算法、未重启数据库/存储/Registry/BuildKit/集群。新增1个应用版本、4个策略、4个执行及相应正常分发/TaskRun/Attempt记录；未新增数据库结构。

实际运行镜像ID：backend `sha256:80da28b8478616df03fba998bef2ba4a338dde11c1f17dca1853dcb40cdcb7bf`；gateway `sha256:af8cb31ca0ca67c9e7981e07db4ce8f611906e47739c11d7eaafb718b5a8f53d`；agent `sha256:2be9efd36fc75949ced7d65c18cc3df8f88a93305b9fa94b03ebdf7d64a17ae3`。示例发布digest为`sha256:624f80f4c4843a5cdc893e37750e6c41bf53466be9e9da2417ae971801055304`。

发布前已保留backend/edge-gateway的before-off02镜像和原网关配置；没有本批DB migration，也没有新做数据库dump。私有基线、收据、配置、实物JSON、截图在ignored `.local/cea/off02/`；通用部署浏览器结果在`.local/cea/browser/`；隔离用例结果在`platform-server/target/off02-evidence.json`。公开仓库不提交凭据、原始私有配置、镜像包或数据副本。

## 当前没有实现

- OFF-03六维采集、工作量队列、传输估计、终端端到端奖励和乱序next_state关联；当前服务端观测不能冒充这些反馈。
- OFF-04边缘Double DQN及五基线平均/P95/成功率比较；当前RULE仍在原后端调用链执行。
- 物理终端/物理多云、离线续跑、二进制终端结果下载、任意终端调度、自动GC。当前单文件1..64MiB、返回小JSON≤256KiB，联网Linux Docker模拟。
- 管理员外部强删终端容器后的严格exactly-once保证；正常租约接管复用同容器不等于任意破坏后的恢复承诺。

示例是确定性合成信号及特征/阈值计算，不是实测工业数据、训练分类器、DQN实验或申报书性能达标证据。[操作与YAML](../../examples/offloading/README.md)。
