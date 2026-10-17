# HC-13：k6压测端发送能力

2026-10-17已完成：优化版12并发三轮60秒为4.700977/4.740917/4.712209GB/s，平均4.718034GB/s，77168批零失败、完整CRC及双端字节核验通过。原方式30秒4.056862GB/s、复用方式30秒4.642298GB/s，单次A/B观察+14.43%，不当稳定收益。测试工作负载和派生大文件已清理、旧环境审计PASS；[完整验证记录](../../../../docs/verification/VER-HC-13.md)。

仅测试“k6→三个边缘接收器”的真实HTTP上传能力。接收器完整流式读取NPZ并校验长度和CRC32C后才确认；不执行液压算法、向中心转发、聚合、领取业务结果或持久化。这里达到3GB/s不等于业务处理达到3GB/s。

## 配置与优化

- 同一35批/2205周期原始输入、每批64周期（末批29），每次三路POST，按全局iteration%35轮转。循环重放明确为累计接收量，不是不同原始样本数。
- `legacy`每批分配三份新Uint8Array再读取；`reuse`为每VU、每组、每种精确文件长度复用缓冲区，仍逐批读取/上传原内容，不预加载每VU整套385MB、压缩数据、跳过传输或缓存结果。每VU约15.51MiB可复用缓冲；不同组不得共用同一buffer，短末批不得误发大buffer尾部。
- k6官方1.3.0，7核/5GiB、GOMEMLIMIT4096MiB、GOGC50；三个新Go接收器各2核512MiB，GOMAXPROCS2。独立四集群`cea-hc13-20261017` / NodePort31093，中心只运行k6，无业务聚合服务。
- CPU配额共13核，现场WSL16核；每档启动前可用RAM≥5632MiB。新增OOM、危急可用内存、监控/请求/对账失败停止；CPU忙、PSI、换页记录不作为旧保守停止条件。不改WSL、旧后台暂停状态或业务镜像。

k6 v1.3.0的[fs.read实现](https://github.com/grafana/k6/blob/v1.3.0/internal/js/modules/k6/experimental/fs/module.go#L219-L237)仍有临时Go缓冲和复制，[HTTP请求实现](https://github.com/grafana/k6/blob/v1.3.0/lib/netext/httpext/request.go#L106-L116)也保留请求body副本。本次只减少JS侧重复分配，不能称零复制，也没有改k6二进制。

## 计量和完整性

主速率=`成功批次原始信号字节总和 / (末次确认时间−首次发送时间) / 1e9`；另报完整NPZ请求体字节的速率。原始三组各算一次，不加中间数据/HTTP头。发送后等待CRC回执包含在时间内，setup/reset/初次发送前预读不计，后续载荷准备和GC停顿仍落在全局窗口内。不是只统计请求提交速度。

每个请求携带完整NPZ长度及CRC32C，接收器真正读取计算校验和后返回`{bytes,crc32c}`。`/stats`累计成功requests/bytes、failed/inflight；每档结束用manifest完整周期＋尾批前缀独立复算三端字节，并要求请求数=完成批数、failed/inflight=0。失败档只留诊断，不作性能成绩。不计重复发送失败重试，因为没有自动重试。

接收器`/resources`读取真实cgroup v2，runner独立采样CPU、限流和工作集；缺失信息失败，不伪造0。该采样不计业务上传请求。小型HTTP确认响应与额外采样开销始终保留。

## 运行

backend根目录：

```powershell
docker build --network none -t cea/hc-generator-receiver:hc13-v1 examples/hydraulic-cloud-edge/resident/generator
node examples/hydraulic-cloud-edge/resident/generator/run.mjs setup
node examples/hydraulic-cloud-edge/resident/generator/run.mjs trial legacy-v12 legacy 12 30s
node examples/hydraulic-cloud-edge/resident/generator/run.mjs trial reuse-v12 reuse 12 30s
# 核查证据后再选档；标签不可重复，失败不自动重跑。
node examples/hydraulic-cloud-edge/resident/generator/run.mjs trial confirm-1 reuse 12 60s
node examples/hydraulic-cloud-edge/resident/generator/run.mjs report
node examples/hydraulic-cloud-edge/resident/generator/run.mjs cleanup
# 等四个测试命名空间正常终止后执行，不强删finalizer。
node examples/hydraulic-cloud-edge/resident/generator/run.mjs audit
```

本批路径已经有证据时`setup`会拒绝覆盖；不能直接重跑上述旧标签。结束删除本批临时工作负载、派生fixtures及image.tar，保留原始数据和所有小型统计。失败诊断使用`capture <label>`。

原业务`../load.js`也提供同样的可选优化：新批setup前设`HC_REUSE_BUFFERS=1`，runner将选择冻结到plan并传递`REUSE_BUFFERS=1`。默认及旧plan仍使用原分配方式；**本批未重跑真实业务链路**，该接线只通过单测，不宣称业务吞吐提升，也未修复HC-12的失效连接问题。

测试：`node --test examples/hydraulic-cloud-edge/resident/generator/*.test.mjs`；Dockerfile构建执行接收器8项Go测试。正式结果记录在本批验证文档，单次A/B提升不当稳定收益。
