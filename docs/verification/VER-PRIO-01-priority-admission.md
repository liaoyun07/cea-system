# VER-PRIO-01：非抢占优先级与资源准入

日期：2026-09-16～17。源码基线：`75733e0` 加本批改动；既有未提交的联邦性能实验文件保留，不属于本批提交。环境：Windows、Microsoft JDK 21.0.12、MySQL 8、Docker Desktop、隔离 K3s，CEA 四集群仍是同一宿主。

状态：PASS。CEA 前后端已于 2026-09-17 00:13:42 更新并健康；发布后页面、联邦回归及历史保留核验通过。

## 已执行

- 定向 DefinitionTest 与 5 项新队列/准入测试通过；54 项前端单测、生产构建及格式检查通过。
- 首次完整回归的 53 项 ImageDistributionTest 全部通过（真实 Registry/K3s/终端、两种联邦算法、等待取消/超时、同 Attempt 接管）。首次整体未通过：OpenAPI 缺 priority 字段；旧并行测试只并发调用一次非阻塞领取，没有模拟生产持续轮询。已分别同步契约及改用真实 WorkerPump；不降低并行重叠断言。
- 之后补充 V27→V28 活动执行拒绝/历史保留测试、跨具体 cluster 的满载绕行测试，并保留 WorkerPump 原有有界轮询批次。最终完整 `verify.ps1` 于 2026-09-17 00:04:58 通过，275 项 Java 测试，失败/错误/跳过均为 0；包含真实 MySQL、Registry、K3s、Docker/终端和打包 JAR 启动。
- 首次 60 项浏览器回归为 58 通过、2 失败：新增 priority 需要同步纵向表单字段断言；旧分发测试源/目标为同一 Registry，精确 digest 复用不应新增历史。已将测试目标改为独立临时 Registry，并断言再次准备仍只有一条历史；不改生产分发逻辑，不增加 CEA 服务。第二次为 59 通过、1 失败：新测试的“镜像仓库”选择器同时命中导航按钮和下拉框，已改为 combobox 精确定位。最终全量复测结果见下。
- 发布前已备份 CEA：344 次执行、42 个用户 Flow、19 个常驻服务；MySQL 转储 6,664,610 字节。恢复镜像标签为 `cea/backend:before-prio01`、`cea/frontend:before-prio01`；备份时未重启服务。
- 最终浏览器全量回归 60/60 通过（`.local/priority-e2e-release.log`）；前端单测 54/54、构建、格式检查、结构/链接检查通过。保留前两次失败日志，不拼接通过数。
- 本批镜像：backend `sha256:1feb158cd4d368cfc0c8eb2f3e329c4d32634d3d9993dacefae66d81ac04da1b`；frontend `sha256:13ed31c97566fcb8bd93632caca991674035f045fbef33bdf4c1a64790a19804`。仅 `compose up --no-deps backend frontend`，后端 `/health` UP、18080 HTTP 200。
- 真实 18080 页面验证：FedAvg 的 init 草稿添加 priority=80，与 YAML 同步；桌面/窄屏可编辑，未保存新 Flow 修订，页面无 JavaScript 异常。截图位于私有 `.local/cea/prio01/`。
- CEA FedAvg 两轮执行 `de105993-a506-4039-bc74-8fe6df419964` SUCCESS，11 个实际 Job/文件助手/存储位置/Secret 清理及独立训练、加权聚合、评估数值通过。首次审计调用的旧默认镜像 deploy-v1 不支持 `--data-directory`，属于审计 CLI 不匹配；显式使用已有 par07-v1 审计同一次成功执行后 PASS，没有补跑业务执行或修改算法。
- CEA FedProx 两轮执行 `6af3572f-d71c-4bf8-9139-85d0d7f15cfe` SUCCESS，同样 11 Job 和独立数值核验 PASS。两者沿用已有Flow修订和应用镜像，MNIST训练6万、测试1万、三客户端，两轮/本地epoch1；本批不以这些结果报告吞吐提升。
- 发布后 V28 成功、真实API暴露 priority；原344次执行逐项保留、42个Flow的source/revision不变，数据集/边缘策略/卸载样本保持，另外17个服务的ID/镜像/启动时间均未变化。新增两次成功执行后共346次；原Flow API定义只新增可选priority=null，保留核验仅归一化该字段，不忽略源文本差异。

## 验收消费者

| 验证 | 实际断言 |
|---|---|
| priority/FIFO | 同时就绪高优先级先领取，同级按稳定 enqueue_order |
| 依赖/非抢占 | 高优先级依赖未完成不入队；新高优先级不撤销已获准任务 |
| 无资源留队 | 一个执行名额仍能跳过满载任务；Attempt、deadline、enqueue_order 不变 |
| 多 Worker | 两个实例/独立 DB 会话协调准入；业务执行不持准入锁 |
| 真实 Placement | edge 满载时 cloud 可执行；释放 edge 后较晚就绪的高优先级先获槽 |
| 取消/超时/恢复 | 等待时不建 Pod、不消耗额外 Attempt；释放预约；原 Job/容器身份接管 |
| 迁移 | 活动执行拒绝 V28，空闲后历史行保持，不新增业务表 |
| 前端 | no-code 与 YAML 同一 priority，控制任务不提供此字段 |

## 证据与复测

- 私有本地证据：`.local/priority-targeted.log`、`.local/priority-verify.log`、`.local/priority-verify-final.log`、`.local/cea/prio01/`；备份/原始凭据不入公开仓库。
- 完整后端：`scripts/verify.ps1 -JavaHome <JDK21> -MavenCommand <mvn.cmd>`。
- 前端：`npm test`、`npm run build`、`npm run format:check`、`npm run test:e2e`。
- CEA 基线/保留/页面：`node deploy/cea/verify-priority.mjs capture|verify|browser`；capture 拒绝覆盖原证据，browser 只改未保存草稿。
- 两轮联邦：`deploy/cea/verify-federated.ps1 -Algorithm fedavg|fedprox -Image cea/federated:par07-v1`，同时核验真实 Job、存储及模型数值；指定 ExecutionId 可复核同一次执行，不重新提交。

本批不测 2GB/s、不调整资源容量、不实现抢占/防饥饿/物理资源预算；性能指标状态不变。Kestra 参考与有意简化见 [ADR-0029](../decisions/ADR-0029-priority-admission.md)。
