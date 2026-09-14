# MET-001 算法文件计量协议

## 已确认口径

数据处理速率 = 所有成功提交算法调用的（输入文件字节 + 输出文件字节）之和 / 这些调用完整活动时间区间的并集。

- 按实际消费/生成的完整业务文件的逻辑长度；压缩文件按压缩文件长度，不按解压张量，也不按网络重传字节。
- 每次调用内，同一文件身份（设备号、inode）每个方向只计一次；跨真实调用再次处理会再次计入。不是原始数据集去重速率或纯训练吞吐率。
- epoch、batch、缓存命中不额外放大字节。不计镜像层、日志、传输清单、计量报告；业务评估JSON计入输出。
- 从算法入口开始到完整读入、计算、写出关闭结束，包括期间全部计算和等待；不含解释器/基础模块启动、Pod启动、队列、文件助手准备和发布。
- 活动区间[1,4]、[2,6]、[10,12]分母为7秒，既不是9秒之和，也不是最长单任务的4秒。
- 只汇总SUCCESS执行中实际成功Application实例（含生命周期任务）；SKIPPED不计。失败/取消/后处理未完成或任一实例缺失/无效报告，不返回有效速率。重试只取最终成功提交Attempt，失败尝试字节/时间不计；这是成功处理速率，不是含重试损耗的系统吞吐率。

## 镜像与报告

`sdk/python/cea_measurement.py`只用标准库。各算法镜像COPY同一模块，入口用`Measurement`，真实全文件加载用`with measurement.input(path)`包围，输出关闭后`measurement.output(path)`。不拦截read、不扫目录、不额外读内容、不计算hash、不连接平台。当前不支持仅处理文件局部却申报全文件大小。

边缘NPZ入口要求归档成员与实际消费字段完全一致：液压仅PS1/FS1/TS1，轴承仅signal/sample_rate；多余成员直接拒绝，避免NumPy惰性加载未消费内容却按整个归档计数。这里只读取ZIP元数据，不另扫归档内容。

UTC纳秒时点与进程单调钟持续时间交叉检查，差异大于max(1ms,0.1%)拒绝报告。stat开销在计时内，报告序列化在结束后。每方向最多1024文件，输入前后stat检查身份/大小/mtime，报告最多256KiB。输入硬链接别名去重，不做内容去重。

各任务显式声明`container.outputFiles: [业务输出, cea-measurement.json]`。SDK写到输出目录，原文件助手/终端Runner依声明发布；TaskRun保存原有URI。业务失败无报告，SDK校验失败使本次调用失败。无新执行状态机、DB表/列或消息链。

报告以原子替换发布，文件权限为0644，允许不同UID且无DAC绕过能力的公共助手读取；不增加代理能力或共享存储凭据。算法不得把凭据放入此报告。

报告仅含`startedAt,endedAt`（ISO8601 UTC）、`durationNs`（正整数）、`inputs,outputs`（各项`path,bytes`，非负整数长度）。报告不能计入自身。路径供核查，后端不会据此读任意文件或URI。

## 查询与展示

`GET /api/namespaces/{namespace}/executions/{id}/measurement`沿用READ授权；读取固定执行快照、真实TaskRun、成功Attempt，再由ExecutionOutputService受限读取。时点必须在对应Attempt内（DB精度容差1ms）；结构/数字/时钟一致性或累计溢出异常都拒绝。

返回`status,inputBytes,outputBytes,activeSeconds,bytesPerSecond`。仅AVAILABLE提供数值，其他状态数值全null。NO_ALGORITHM/NOT_SUCCESSFUL/INCOMPLETE/INVALID/CLOCK_UNCONFIRMED/STORAGE_UNAVAILABLE不等于零。概览只有一个“数据处理速率”，十进制1GB=10^9B，无有效值显示“—”。报告保留原产物页审计，不进入通用Metrics候选。

`platform.measurement.clock-synchronized`默认false，是区间合并前的准入检查。CEA先验证后端/K3s/终端Docker共享同一宿主内核时钟再启用。物理多机需运维确认NTP/PTP及误差；开关不自动同步，也不证明远端时钟可信。算法镜像属于受管理可信代码，SDK不是抗恶意计量证明。

MySQL JDBC连接明确`connectionTimeZone=UTC`，确保Attempt与报告同为UTC；不能通过放宽时间范围校验掩盖数据库时区偏移。本次修正了集成测试连接，CEA原配置已经指定UTC。

历史不回填，不用Pod时间/数据集大小兜底。无新常驻服务、扫描任务或后端缓存；只读小报告，查询开销随算法调用数增长。
