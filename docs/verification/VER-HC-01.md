# VER-HC-01：液压云边协同

2026-10-04，核心演示PASS/2GB/s目标未达。Windows＋Docker Desktop，CEA后端18085/前端18080，cloud/edge-a/b/c，Python3.11.15、NumPy1.26.4。源码基点f0d4f7e4c20f181caaec73caf7bc25ae843578b0，本批代码未提交，原大量未提交/暂存修改保持。

## 已部署

`lab/hydraulic-cloud-edge` r2：三个边缘Application并行，随后一个云端融合Application。两个应用 `hydraulic-edge/hc01-v2`、`hydraulic-fusion/hc01-v2`。新镜像 `registry-center:5000/lab/hydraulic-cloud-edge:hc01-v2` digest `sha256:ab1a3d31d876a1763c5be66eff8744f7e3ee6624166f15184ec2a42d7a9b0a3f`。完整2205周期、17通道、原采样率、float32未压缩，replay=1；校准1787..1791、留出健康1792..1796。数据版本hydraulic-signals/hc01-v1和hydraulic-reference/hc01-v1。

v1镜像、契约、r1和执行历史保留。v2改为float64平方求和以减少完整中心化临时数组，极小方差回退稳定公式；统计语义、数据、参考、资源、计量不变。没有新增Java/API/表/权限或工作流控制语义，没有重启任何服务。

## 验证

- 镜像单测：v1六项、v2七项PASS，含标量统计、原频率、通道/周期、极小方差、非有限值、云端评分、参考排除、eager load、区间并集。
- audit.py独立中心化float64重算全部17×2205×6×5特征和参考，rtol1e-5/atol1e-9通过；简单标量案例1e-12通过。
- 实际v1/v2各4次执行回读32成功Job的NPZ：全部特征、周期索引、云端每个传感器/窗口评分、标志、评价掩码和检测统计通过。实际数组字节与profile相等，事件扫描独立复算区间并集/GBps，核心时间在原SDK内，profile不计SDK业务字节。
- 真实API validate、数据集/契约、并行依赖、最终输出通过；当前r2预热＋3正式4/4 SUCCESS，未补跑筛掉慢样本。
- API健康UP；前后20 Docker服务ID/镜像/名称和51原Flow摘要保持，旧Job/历史未清理。
- scripts/check-scaffold.ps1 PASS。未重跑完整Maven和前端回归；不把过去测试当本批通过。

## 原始性能

核心口径：全部四应用实际消费/生成数组404425053字节／核心区间并集。完整读完后、检查与分配前启表；全部计算后、序列化前停表。不含等Pod、文件读取、对象传输和依赖等待。原SDK完整读入—计算—写出口径未改；两种数字不能混用。

| v2批次 | 执行ID | 核心GB/s | 核心并集秒 | 计算首尾跨度秒 | 原SDK GB/s | 提交到结束秒 |
|---|---|---:|---:|---:|---:|---:|
| 预热 | 40ccb43a-c11c-4e41-b936-0ead8d609278 | 1.225 | 0.330 | 5.343 | 0.613 | 11.211 |
| 正式1 | 92445ab0-c01f-4e2b-884c-6b6c3726797e | 1.306 | 0.310 | 5.047 | 0.511 | 10.266 |
| 正式2 | c26c9024-7558-445b-98f5-c7fb822240be | 1.578 | 0.256 | 5.396 | 0.612 | 10.440 |
| 正式3 | d732a00d-e347-429c-a097-921c7ee03425 | 1.372 | 0.295 | 5.470 | 0.617 | 10.634 |

正式核心平均1.419GB/s、原SDK平均0.580GB/s，端到端10.27～10.63秒。edge-a/b/c正式核心分别约58～74 /151～211 /36～51ms。**未到2GB/s**，更不能宣称端到端2GB/s。没有扩大资源、重复epoch或把回放说成唯一样本。

v1基线保留：预热c2263397-ad81-4a97-84c2-2a9a41e0adcb为0.470；正式78ec7eeb-ce87-4fe6-abc3-b89ff51bca01 / ef849235-a2db-4ddd-ab0b-988b06a2bfbc / af305806-0ad7-4e94-aa39-8c2cc8976476为0.599/0.644/0.457GB/s。不是受控交替对照，期间存在部署/产物回读工具活动，不能只据此认定稳定提升比例或硬件上限。

## 失败与限制

首次86a33701-17d8-41b7-9665-d74500a850e7和诊断90f4fce3-171c-4398-b304-3109ed916e00的files-in HTTP404：误把同名s3://datasets/...分片写进边缘MinIO；当前全局bucket→store解析datasets到中心，并非由Dataset Location clusterId选择存储。已写入中心同名对象，不改原配置/扩权。初次边缘datasets副本保留但不使用，失败执行保留。

升级validate误带expectedRevision导致400，修正只传source后按expectedRevision1登记r2。观察器初次仍跑r1：22c2420d-8a12-44b2-b625-2cf71ff361e6成功0.340GB/s；35313c79-53ff-4d33-915f-8c48fd21137b边缘失败，原因未确认，不作为v2结果、不覆盖记录。随后新批次固定修订，v2四次成功。首次观察器PowerShell数组/空对象读取错误修复后读取原accepted ID，没有重复提交该次。

质量限制：threshold3将2200周期标异常；1444稳定非校准周期中TP1439、FP5、FN0，**全部五个留出正常周期误报**。仅5个参考周期，最大值多重比较和阈值未校准；不能只宣传TP高。本版是统计特征/云边融合及测速演示，不是生产故障检测器或论文精度复现。

证据保留.local/cea/hc01/before.json、full/source.json、validated和optimized-v2各trial-0..3.json、arrays-0..3及audit.json；root trial-0和optimized失败也保留。真实凭据/数据/产物不上传Git。性能目标未达，本批暂未提交推送，不混入既有暂存批次。后续优化应独立验证，不修改计量宣称达标。
