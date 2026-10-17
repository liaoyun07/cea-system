# HC-05 常驻液压 HTTP 链路实验

2026-10-17实测：业务资源不变，1/2/4/8并发分别0.172/0.353/0.613/0.890GB/s；固定8并发三次60秒为0.899/0.879/0.920GB/s，平均0.899GB/s（约899MB/s），共14775批全部正确，P95为127～132ms。未达2GB/s；不是历史纯计算口径、持久化吞吐或省Job启动的独立提升比例。[完整结果](../../../docs/verification/VER-HC-05.md)。

用户确认的小实验：三个边缘各一个 Deployment（1 CPU / 1 GiB 上限），中心融合一个 Deployment（1 CPU / 512 MiB），固定副本、不加 HPA/DQN/预热池。旧 Flow、应用、数据、服务不改。不新增 Java、前端、数据库表或通用编排能力，故不涉及 Kestra 执行语义变更。

复用 HC-02 edge/fuse/C 计算核。完整 2205 周期、17 通道按 64 周期切成 35 批（末批29），三路原始 NPZ 经 HTTP 发到边缘；边缘真实计算，再通过 HTTP 将特征发送到中心，按 run/batch 对齐三组后融合，压测端取完成结果。每组只计一次。结果与完整数组原算法逐值核验；每个压测批次核对周期数、评分总和、标志数和输入字节。无结果缓存、无每批 Job、无 MinIO 中转或结果落盘，不宣称持久化吞吐或真实异地带宽。

主口径：成功融合的原始 float32 信号字节（不含 NPZ 包装、cycle_ids、特征和结果）/ 首批开始发送至最后一批结束的墙钟秒；失败耗时不扣、收尾等待保留。循环回放明确为累计处理量而非独立样本。输出阶段耗时为累计请求时间，并行阶段不可相加当墙钟。资源采样包含本批业务容器和独立 k6 容器，空闲/旧服务背景单列，不用于证明系统资源下降。

计划：完整正确性检查 → 10秒预热 → 并发1/2/4/8各30秒 → 在零错误档位选择吞吐最高者，60秒重复3次。不能将选档样本与复测混算、不能据单轮峰值宣称达到2 GB/s。前后环境审计、失败和原始日志均保留；实验后清理本批服务与大体积派生输入，保留原数据和小型记录。

运行入口（backend根目录，Docker已运行）：

```powershell
# 若本机没有原HC-02镜像，先从同仓库源码构建它。
docker build -f examples/hydraulic-cloud-edge/Dockerfile -t cea/hydraulic-cloud-edge:hc02-v1 .
docker build -f examples/hydraulic-cloud-edge/resident/Dockerfile -t cea/hydraulic-resident:hc05-v1 .
docker run --rm --network none --cpus 1 --memory 512m cea/hydraulic-resident:hc05-v1 python -m unittest -v test_app test_service
node --test examples/hydraulic-cloud-edge/resident/metrics.test.mjs
node examples/hydraulic-cloud-edge/resident/run.mjs setup
node examples/hydraulic-cloud-edge/resident/run.mjs verify
node examples/hydraulic-cloud-edge/resident/run.mjs trial warmup-v4 1 10s
# 每个标签只运行一次；失败保留，不覆盖原标签。
node examples/hydraulic-cloud-edge/resident/run.mjs trial v2-sweep-1 1 30s
node examples/hydraulic-cloud-edge/resident/run.mjs trial v2-sweep-2 2 30s
node examples/hydraulic-cloud-edge/resident/run.mjs trial v2-sweep-4 4 30s
node examples/hydraulic-cloud-edge/resident/run.mjs trial v2-sweep-8 8 30s
# 根据四档零错误结果选VUS，confirm-1/2/3各60s。
node examples/hydraulic-cloud-edge/resident/run.mjs report
node examples/hydraulic-cloud-edge/resident/run.mjs cleanup
# 等命名空间退出后执行，保存审计再删除本批派生文件。
node examples/hydraulic-cloud-edge/resident/run.mjs audit
```

脚本固定本批命名空间/目录，setup检测已存在则拒绝覆盖。后续复测须先明确新批次标识，而非删除历史证据。原始数据只读取 `.local/cea/hc01/full`，目录内文件由既有HC-01准备步骤产生。

压测端修订记录：最初k6 2核/1GiB在warmup触发OOM；GOMEMLIMIT600MiB/GOGC30后1、2并发成功，但2并发平均约1.96核且4并发OOM，故不能据此声称服务上限。失败4并发留下中心4个已融合、1个未齐批次，恢复时保存统计并仅重启本批四个服务。warmup-v3因残留状态拒绝reset也原样保留。新的独立v2标签统一k6 4核/2GiB、GOMEMLIMIT1400MiB/GOGC50，业务资源、算法和输入未变；旧成功/失败样本不并入v2复测。

k6使用既有1.3.0镜像，通过实验文件API按批读取，但文件API仍会缓存源数据，压测端内存与业务内存分列，不声称只占一个批次内存。参考：https://grafana.com/docs/k6/latest/javascript-api/k6-experimental/fs/file/read/ 。普通 Deployment：https://kubernetes.io/docs/concepts/workloads/controllers/deployment/ 。
