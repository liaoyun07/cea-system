# HC-03 集中式与云边分布式资源对照

范围：新增两个独立 Flow 和同一镜像的三个启动入口，复用 HC-02 数值核；固定完整液压数据、参考模型和阈值，三份原始文件提前存入各边缘 MinIO。集中式一个云 Job 顺序计算三组并融合；分布式三边缘 Job 后云融合。保留现有 HC-01/02 Flow、应用、数据和运行历史。

依赖：现有 Parallel、固定 candidateClusters、LITERAL/TASK_OUTPUT 文件绑定、四集群与四存储。没有新 Java/API/数据库/权限/通用工作流能力，不引入调度算法或限速。

验收：同镜像单测、真实 Flow 验证、各一次预热后五组交替正式运行、每次 NPZ 全量结果一致、云输入业务字节核验、原始 CPU 和 working set 采样、服务/Flow 保留检查。未实测不得宣称资源降低 15% 或正式符合申报书“现有分流方案”。

测量范围：既有20个 CEA Docker 容器＋宿主根下四个独立 `/cea-*` Pod 子树；后者与 `/docker` 是兄弟，不能只用Docker stats，也不能加共享NodeMetrics。原始文件提前放置与镜像预热排除；运行请求到完成检测的观察包络包括读/传输/计算/保存/平台调度。宿主单套容量作为分母。累计 CPU 使用各不重叠 cgroup 的累计 usage 差值；内存 working set=usage-inactive_file，以采样时间积分，记录均值/采样峰值。共享宿主、缓存及平台常驻用量必须公开；运行观察包络与执行实际时长分别记录。主指标不扣空闲值，空闲采样独立保留。四个Pod根当前memory.max/cpu.max为max，Docker K3s的3CPU/2GiB不等于Pod总预算；本批不改资源配置、不声称已实现集群物理隔离。

结果见 [验证](../verification/VER-HC-03.md)。
