# 液压云边协同演示（HC-01）

当前 CEA：`lab/hydraulic-cloud-edge` r3，两个应用 `hydraulic-edge/hc02-v1`、`hydraulic-fusion/hc02-v1`，同一个 NumPy＋预编译单遍C镜像 `lab/hydraulic-cloud-edge:hc02-v1`。当前例子为flow-native.yaml，原v1/v2和r1/r2保留。PS4小方差回退慢路径已用稳定锚定统计消除，CPU/数据/指标不改。

三边缘按通道处理完整 UCI 447 数据的 2205 个周期：edge-a PS1..3，edge-b PS4..6，edge-c 其余11通道。每个60秒周期切为6个10秒窗口，保留通道原1/10/100Hz采样率，计算 mean/std/min/max/RMS。云端对齐三个分片，使用正常参考计算各传感器标准化偏离、窗口最大异常评分与报告。17个通道来自同一试验台，不是真实三个站点采集。

页面进入数据流编排，选择 `hydraulic-cloud-edge` 执行即可。`dataset` 和 `reference` 保留登记的默认版本；`z_threshold` 默认3，可改变告警阈值。最终 `report.json`、`anomalies.npz`，各任务另有 `features.npz`、`metrics.json`、`compute-profile.json`、原SDK `cea-measurement.json`。

参考使用10个完整健康且稳定周期中的前5个；另外5个不参与拟合。当前阈值下5个留出正常周期全部误报，因此仅为统计融合和吞吐演示，不可当生产故障检测器。没有训练故障类别模型，不宣称论文准确率复现。

## 本机重现

在 backend 根目录运行：

```powershell
docker build -f examples/hydraulic-cloud-edge/Dockerfile -t cea/hydraulic-cloud-edge:hc02-v1 .
docker run --rm cea/hydraulic-cloud-edge:hc02-v1 python -m unittest -v test_app
# 完整源包已在 .local/cea/edge-processing/raw/hydraulic.zip；输出目录先创建
New-Item -ItemType Directory -Force .local/cea/hc01/full
docker run --rm --memory 2g --mount "type=bind,source=$PWD/.local/cea/edge-processing/raw,target=/source,readonly" --mount "type=bind,source=$PWD/.local/cea/hc01/full,target=/data" cea/hydraulic-cloud-edge:hc02-v1 python /app/prepare.py --source /source/hydraulic.zip --output /data
```

`publish.ps1` 仅适用于该 Flow 尚未存在的首次登记，不替换当前修订。源信号存中心 MinIO `datasets/hydraulic/hc01-v1/`，按照现有全局 bucket→store 配置下载；数据目录中的 `clusterId` 不是自动选择 MinIO 的规则。边缘输出存各自 artifact bucket，融合任务读取三边缘产物。无需新增存储权限或重启服务。

`verify.ps1 -Batch <新的批次目录名>` 固定当前修订，一次预热＋三正式；保存每次完整状态和失败，不自动补跑失败。`download-arrays.ps1 -Batch <同一批次>` 下载已成功批次实际产物，然后用挂载的 `audit.py` 做所有元素和区间独立复核。

## 两种吞吐率

报告 `metrics.computeGBps`：实际消费/生成的业务数组字节之和（本批404425053字节），除以四个核心计算区间的并集。完整 eager load 后起表，包含检查、数组分配、全部统计和融合；写文件前停表。云端等待/传输和Pod启动不在核心区间内，但首尾跨度、端到端耗时另外记录。不是原始信号入站网络吞吐，也不是端到端吞吐。

原系统执行页仍显示原SDK完整读入—计算—写出活动区间口径，没有换成纯计算数字。单独报告完整SDK、计算首尾跨度和提交到完成耗时，禁止混用。

HC-01历史正式纯计算1.306/1.578/1.372 GB/s，平均1.419。当前HC-02正式4.873/4.052/4.841 GB/s，均4.589，三次均超过2；完整SDK均0.598 GB/s，端到端10.36～11.12秒。核心口径达标不代表完整或端到端2GB/s。没有重复epoch、扩大字节、排除慢任务或制造同步等待。

[完整验证与限制](../../docs/verification/VER-HC-01.md)、[协议](../../docs/contracts/hydraulic-cloud-edge.md)。

[HC-02优化实测](../../docs/verification/VER-HC-02.md)。当前发布使用release-native.ps1；publish.ps1和upgrade-v2.ps1是旧版首次安装/升级记录，不用于覆盖现在r3或重建已登记的旧标签。已有数据不必重做。
