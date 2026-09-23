# OFF-04b：后端决策时延

日期：2026-09-24。范围：参照同级老系统的“后端选层处理耗时”语义，为 FIXED、RULE、DQN 新记录采集 `decisionMs`；DQN `inferenceMs` 保持原义，仅在详情展示。现有任务选址、执行、训练、网关算法及系统总时延口径不变。

计时起点为 `OffloadingTaskAdapter.decide` 入口，终点为合法目标层确定后、`off_task_observation` INSERT 前。包含资源/模型读取、状态准备、Resource 接纳锁等待及 DQN 网关往返；排除此前 Worker 队列、后续记录写入、具体位置放置、文件传输、执行与回传。直接调用 `OffloadingService` 的测试/管理路径从服务入口计时。后端单调时钟保存非负毫秒，不照搬老系统至少 1ms 的取整。旧记录保持 `null`；重复调用保留首次记录。

旧系统参照：`web-platform/platform-datastream/.../OffloadDecisionService.java` 在 `decide()` 入口启表、目标层确定后 `recordRepository.insert()` 前停表；其推理在同一JVM中，不与现系统跨进程网关请求构成同条件性能比较。

验证进度：JDK 21.0.12.1、Maven 3.8.8、Docker Desktop、真实 Testcontainers MySQL/Registry/K3s/终端。首次完整 `scripts/verify.ps1` 的 249 项中 248 项通过；唯一失败为迁移计数断言仍写 V30 共30版，新增 V31 后实际为31版。修正后第二轮完整 verify 249/249 主测试、1/1打包冒烟及JAR构建全部通过（17:28分钟）。前端 59/59 单测、Vite 构建、Prettier 检查通过；隔离浏览器回归首次 84/86，修正两处旧断言后第二次完整回归 86/86 通过（5.5分钟）。OpenAPI JSON 解析、源码 diff 检查已通过。

CEA发布前只读基线：`wf_execution` 活动0、`wf_worker_job` 非终态0、卸载观察129条、V30成功。备份 `.local/cea/off04b/cea-before-off04b-20260924.sql` 大小7189239字节；旧 backend/frontend 镜像另标 `before-off04b`。仅重建并重启 Docker backend/frontend，网关镜像及其他容器未替换；18085 `/health`、18080首页均返回200。V31迁移成功，发布后原129条观察均保持 `decision_ms=NULL`。

真实验收：沿用已有 `offload-edge` 策略，提交一次合成振动文件元数据请求，执行ID `8ef7facf-9283-434f-953c-c130d27858a9`。FIXED 新观察的 `decisionMs=20.979666`，API返回该数值，真实18080页面第7页显示 `20.980 ms`，旧记录显示“未采集”。这是单次后端选层耗时，不证明稳定10–25ms，更不代表申报书 M02 系统总时延。该任务后续因终端回传链路中的 `attempt timed out` 而 FAILED，与之前 OFF-04a 的终端回传超时现象相同；本次不归为端到端执行成功，不重复发起验证请求。私有请求回执在 `.local/cea/off04b/live-fixed-edge.json`，未纳入版本库。
