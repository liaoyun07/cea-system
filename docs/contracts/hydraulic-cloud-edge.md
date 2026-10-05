# HC-01 液压云边应用协议

## HC-03独立对照入口

`hydraulic-compare/hc03-v1` 使用同一HC-02数值核，新命令 `python /app/compare.py edge|central|fuse`。输入目录/输出目录仍为 `/cea-work/in`、`/cea-work/out`，复用现有LITERAL/TASK_OUTPUT的S3文件绑定；不用DATASET标记或数据库文件内容读取。`edge` 输入raw.npz和EDGE_GROUP，输出features.npz；`central` 输入edge-a/b/c.npz原始三组及reference.npz，顺序处理再融合；`fuse` 输入edge-a/b/c.npz特征三组及相同reference。后两者输出anomalies.npz/report.json；所有入口输出原SDK cea-measurement.json，Z_THRESHOLD默认3。原edge/fusion契约和核心吞吐协议未修改，HC-03全流程资源计量由独立观察脚本承担。[范围](../features/HC-03-central-distributed.md)、[计量与结果](../verification/VER-HC-03.md)。

HC-02当前修订r3使用hydraulic-edge/hc02-v1与hydraulic-fusion/hc02-v1，参数/数据/输入输出结构和计量完全不变。stats.c预编译单线程SIMD按首样本锚定差值，单遍计算稳定均值/方差/min/max/RMS并检查非有限值，native_stats.py在计算区间内做布局转换和输出分配；无JIT、fast-math或新增线程。旧v2协议与版本保留，完整数值和实际16Job产物核验通过。[优化验证](../verification/VER-HC-02.md)。

复用现有 Application 参数、数据集下载和文件产物协议；不新增接口、表、权限或通用控制流。镜像提供两个命令：`python /app/app.py edge` 和 `python /app/app.py fuse`，默认输入 `/cea-work/in`、输出 `/cea-work/out`。

`hydraulic-edge/hc01-v2`：`DATASET` 为 STRING 数据集引用 `hydraulic-signals/hc01-v1`，系统注入 `DATASET_PATH`；`EDGE_GROUP` 为 STRING 枚举 edge-a/b/c。未压缩NPZ必须恰好包含对应原生采样率 float32 信号 `[2205,60*Hz]` 和唯一 `cycle_ids` int64。输出同一周期索引及对应 `[2205,6,5]` float64 特征，顺序 mean、population std、min、max、RMS；全数据参与，NaN/Inf失败。

`hydraulic-fusion/hc01-v2`：`REFERENCE` 为 STRING `hydraulic-reference/hc01-v1`，注入 `REFERENCE_PATH`；`Z_THRESHOLD` 为正 NUMBER，默认3。输入文件名称固定 `edge-a.npz`、`edge-b.npz`、`edge-c.npz`，及各自 `<edge>-profile.json`。合并后形状 `[cycle,window,17 sensors,5 features]`，周期索引不一致失败。参考含 `[6,17,5]` center/scale、cycle_ids、calibration_ids、healthy/stable标签、unique_cycles；center/scale仅拟合前5个稳定健康周期，scale下限1e-6。

计算 `z=abs((features-center)/scale)`，按5种特征取最大得到 sensor_scores `[2205,6,17]` float32；再跨传感器取最大得到 window_scores `[2205,6]`；大于阈值得 window_flags。原生特征之间尺度通过各自参考标准差归一，不将原始压力与温度直接相加。输出 `anomalies.npz` 含 cycle_ids、sensor_scores、window_scores、window_flags、evaluation_mask。标签只用于稳定非校准周期的检测统计，不参与阈值选择、特征计算或评分。

v2以 float64平方求和减少完整中心化临时数组；极小方差窗口回退中心化计算避免相减抵消。全通道全窗口与独立中心化 float64 统计对照 rtol1e-5/atol1e-9通过；没有改通道/采样率、数据量、结果定义、集群资源或计时区间。数据参考保留v1，旧镜像/契约和r1均保留。

每次完整加载后、校验与计算前记录UTC纳秒和单调时钟，计算结果生成后、序列化前结束。profile字段 startedNs/endedNs/durationNs/inputBytes/outputBytes。报告computeGBps为四调用业务数组的真实输入+输出字节／全部区间并集／1e9；数组输出在后续任务被再次消费，按应用处理量计入两次，与原SDK流水线输入输出语义一致，不代表唯一数据量或网络带宽。profile及报告文件不计入该核心数组字节。原SDK定义和执行页完全不变。

当前正常参考仅5周期且默认阈值误报全部5留出正常周期，明确为协作计算/统计异常演示，不宣称故障检测精度。具体功能和实测见 [验证](../verification/VER-HC-01.md)。
