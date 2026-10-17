# HC-14/15/16/17：3 GB/s 目标输入下的完整业务压测

## HC-17：低复制输入的隔离对照

按 `baseline → views → return` 顺序执行，每阶段完成清理和审计后才启动下一阶段，共用NodePort31097。证据与命名空间分别为 `.local/cea/hc17-<阶段>-20261017`、`cea-hc17-<阶段>-20261017`，失败记录及旧批次不可覆盖。baseline/return使用已有 `hc15-fixed` 镜像及原NPZ输入；views使用 `hc17-views` 镜像和array-view输入格式。业务算法、原35批/64周期数据、32 VU、273批/秒、全部资源额度和完整HTTP链计量不变，禁止 `configure`。

准备输入时仅views额外传 `arrays` 参数，manifest每文件声明 `application/vnd.cea.hydraulic-arrays`；k6按文件声明发送Content-Type，无声明仍为原 `application/octet-stream`。verify由当前阶段镜像内的fixtures程序执行。三个阶段的service/fixtures/test_service源码均从实际prepare容器归档，而非把当前工作树新源码冒充旧镜像；仅views再归档input_codec及其测试。镜像ID记录于plan和protocol证据。

每阶段手动执行：

```powershell
$env:HC_EXPERIMENT='HC-17'
$env:HC_REVISION='baseline' # baseline清理审计后改views；views清理审计后改return
node examples/hydraulic-cloud-edge/resident/rate/run.mjs setup
node examples/hydraulic-cloud-edge/resident/rate/run.mjs verify
node examples/hydraulic-cloud-edge/resident/rate/run.mjs trial probe-10s 10s 32 32
# 查看错误、TCP、内存和宿主保护，等待load Pod正常删除，再继续。
node examples/hydraulic-cloud-edge/resident/rate/run.mjs trial compare-30s 30s 32 32
node examples/hydraulic-cloud-edge/resident/rate/run.mjs report
# 仅views在显式审核30秒较本批baseline明显提速且零错后，才执行下方可选确认。
node examples/hydraulic-cloud-edge/resident/rate/run.mjs cleanup
node examples/hydraulic-cloud-edge/resident/rate/run.mjs audit
```

可选确认仅在views尚未清理时执行；不会自动追加。在用户已授权的整批范围内，实验执行代理结合漂移与资源证据显式审核通过后设置 `$env:HC17_CONFIRM_APPROVED='1'`，依次运行 `trial confirm-1 60s 32 32`、`confirm-2`、`confirm-3`，每轮独立检查健康并等前轮Pod删除。脚本还会核验本批baseline和views的30秒报告均零错、额度相同且views实测速率更高；“明显”不靠任意硬编码阈值。审核记录保存 `reviewApproved:true`、`reviewer:experiment-runner`，不将代理的审核写成用户逐次确认。结束后重新report、cleanup、audit，再进入return阶段。

短测结果与可选三次60秒确认分别报告，原始信号字节仍只计一次，不能把格式包装/中间输出算进业务字节，不能将名义3GB/s当实际承接或把单次短测当稳定收益。保留全部TCP、cgroup、宿主和漏发证据，错误/OOM/危急内存/监控失败停止，不自动重试。

## HC-16：32 → 48 VU 小对照

仅改变k6并发上限，继续使用已有 `cea/hydraulic-resident:hc15-fixed` 镜像。四业务各2核、边缘2GiB/中心1GiB，k6为7核5GiB、Go软预算4GiB；原35批、64周期、算法、HTTP结果核验和273批/秒目标不变。不允许 `configure`、64 VU或额外60秒确认。

独立命名空间 `cea-hc16-20261017`、NodePort31096和证据目录 `.local/cea/hc16-20261017`，不读取覆盖HC14/15结果。冻结顺序如下，各轮结束后人工查看内存、错误、TCP计数和漏发再继续，不可无条件整段执行；失败或宿主保护触发后不重跑。

```powershell
$env:HC_EXPERIMENT='HC-16'
$env:HC_REVISION='fixed'
node examples/hydraulic-cloud-edge/resident/rate/run.mjs setup
node examples/hydraulic-cloud-edge/resident/rate/run.mjs verify
node examples/hydraulic-cloud-edge/resident/rate/run.mjs trial warmup-32 10s 32 32
# 每轮必须先检查健康和余量；此处仅列出顺序，不是自动连续运行脚本。
node examples/hydraulic-cloud-edge/resident/rate/run.mjs trial baseline-32 30s 32 32
node examples/hydraulic-cloud-edge/resident/rate/run.mjs trial probe-48 10s 48 48
node examples/hydraulic-cloud-edge/resident/rate/run.mjs trial candidate-48 30s 48 48
node examples/hydraulic-cloud-edge/resident/rate/run.mjs trial return-32 30s 32 32
node examples/hydraulic-cloud-edge/resident/rate/run.mjs report
node examples/hydraulic-cloud-edge/resident/rate/run.mjs cleanup
node examples/hydraulic-cloud-edge/resident/rate/run.mjs audit
```

只比较 `baseline-32`、`candidate-48`、`return-32` 的完整业务速率、时延、漏发和资源。预热/探测不计入对照；最后32 VU用于观察执行顺序/热缓存漂移。每轮继续保存四Pod TCP原始计数、cgroup、宿主和k6证据，保留原来的错误/内存保护。增加VU不等于增加CPU配额，不预先宣称提高吞吐或稳定达到2GB/s。

本次结果：32/48/32为1.460758/1.186767/1.275676 GB/s，正式10747批全成功，但48慢于前后32、均有漏发，且后32比前32低12.67%。不能把全部差异视为无漂移A/B效应；未达2GB/s。五档及清理审计完整保留，见[HC-16验证](../../../../docs/verification/VER-HC-16.md)。每档结束只请求异步删除压测Pod，须等该Pod正常删除再进入下一档；不要强制删除或因前档仍终止而重跑已提交档位。

## HC-15 连接修复与复测

HC14之后用户授权定位修复。新的诊断批次实证中心连接接入队列溢出、SYN-cookie失败和首次转发连接RST，并测得空载小响应正文约45ms等待。修复仅涉及监听队列128、TCP_NODELAY和坏连接清理（失败不重试）；计算并发/算法/资源/数据不改。完整来源与实测见[HC-15](../../../../docs/verification/VER-HC-15.md)。

通过环境变量选择独立revision，各自保留证据/失败标记。先清理并审计diagnostic，才能复用31095部署fixed；不能删failed标记或重用已有标签。对应镜像分别为`cea/hydraulic-resident:hc15-diagnostic`、`cea/hydraulic-resident:hc15-fixed`，需要先构建明确的镜像版本。

HC-15两版当时源码保留在各自本地证据的protocol中，原镜像仍保留；当前工作树已进入后续实验，不能用当前源码覆盖历史diagnostic/fixed标签。以下是协议说明，已存在的批次目录不会被脚本重跑或覆盖。

```powershell
$env:HC_EXPERIMENT='HC-15'
$env:HC_REVISION='fixed' # diagnostic为原接入参数+异常诊断版本
node examples/hydraulic-cloud-edge/resident/rate/run.mjs setup
node examples/hydraulic-cloud-edge/resident/rate/run.mjs verify
node examples/hydraulic-cloud-edge/resident/rate/run.mjs trial fixed-10s 10s 32 32
# 查看本轮validation/host/网络计数后再运行下一轮；等待上一load Pod终止。
node examples/hydraulic-cloud-edge/resident/rate/run.mjs report
node examples/hydraulic-cloud-edge/resident/rate/run.mjs capture fixed-10s
node examples/hydraulic-cloud-edge/resident/rate/run.mjs cleanup
node examples/hydraulic-cloud-edge/resident/rate/run.mjs audit
```

每轮前后保存四Pod的TCP原始计数、容器身份与cgroup。`trace_tcp.py`是诊断期单独运行的控制包头观察器，使用Pod现有权限，不扩权、不采集载荷；正式吞吐轮次不运行它。`test_trace_tcp.py`验证解析与内核过滤程序。

报告保留名义计划及实际到达槽数，k6纳秒间隔造成的已知+1边界不误判为业务失败；实际漏发/迟发不豁免。`initiatedWithinWindowGBps`只表示在窗口内发起HTTP调用的原始字节，不是服务器实收或完成吞吐。三轮稳定性测试即使零错也不等于2GB/s已达标，速率条件单独判断。

## HC-14 历史协议与结果

2026-10-17已测试并停止：175数组及实际额度通过；首次10秒1044发起/1042成功、2次edge-a连接重置、1687次漏发，未达到有效2GB/s成绩。四业务无CPU限流或内存额度事件，未增配、未续30秒；测试资源已清理，保留错误证据，旧环境审计PASS。[完整结果](../../../../docs/verification/VER-HC-14.md)。下列命令是协议说明，不能复用旧标签覆盖或绕过failed标记继续。

仍使用原三个边缘数据处理服务和中心云聚合服务、原镜像及液压算法。不是HC-13只接收不计算的测试，也不是纯计算计时。

## 输入与统计口径

原35批总385257600信号字节，每批平均11007360字节。k6使用固定到达速率273批/秒，目标约3.00500928GB/s（三路合计），每批真实读取并分别POST到三个边缘，中心完成融合后读取并核验结果才计成功。64周期/批，末批29周期，按全局iteration轮转；不同VU独立复用精确长度缓冲区，不缓存计算结果。

本批同时把k6 `batch` 从3设为4，`batchPerHost=3`不变：k6 v1.3.0的[HTTP transport](https://github.com/grafana/k6/blob/v1.3.0/internal/js/runner.go#L181-L188)将该值用于每VU的全局空闲连接池。完整业务有三个边缘及一个中心共四host，保留四条连接可避免配置上必然驱逐；实际 `http.batch`仍只有三条POST，不增加单批业务并发。此为测试前固定的压测端配置，未修改业务连接恢复，也不能预先认定吞吐收益或旧reset的根因。

目标输入不代表实际完成。报告区分计划批次/字节、实际开始上传、完整成功处理、失败、`dropped_iterations`和收尾时间。原始信号字节只计一次；中间特征和NPZ包装不能叠加到业务吞吐。处理速率分母从首次HTTP发送到最后已发批次结束，包含HTTP、处理和收尾，不包含部署/输入准备。

固定到达模式只有空闲VU才能启动下一批；业务处理变慢会占满VU而漏发，不能把漏发量当已送入集群，也不能因此断言k6自身带宽不足。见[k6官方说明](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/constant-arrival-rate/)。本批不靠无限VU或几十GB缓冲强行保持目标输入。

## 冻结配置和调整条件

- 独立四集群命名空间 `cea-hc14-20261017`、NodePort31094；原业务镜像 `cea/hydraulic-resident:hc05-v1` 不修改。
- 初始业务各2核；边缘各2GiB，中心1GiB。k6初始7核5GiB、Go软预算4GiB，PRE/MAX各32。
- 先完整175数组核验，再10秒诊断、健康后30秒；零错误处理达到2GB/s后3×60秒确认。
- CPU持续接近额度且限流增长，或内存接近额度且伴相关事件/压力，才增配相应业务服务；不是CPU超过1核就判定2核额度耗尽。
- 实验CPU配额总和最多WSL核数减1。需增配时，仅在实际k6有余量的前提下将k6从7降到6或5核腾出配额；不改WSL上限或旧服务。
- 请求/结果错误、新OOM、危急可用内存、监控失败即停止加压并保留证据；不自动重试或覆盖标签。漏发单独标明，不伪称成功承接3GB/s。
- 不改业务并行实现、连接错误恢复、算法、批量大小或参考结果。实验结束清理本批临时工作负载和可重建副本，保留原始数据和结果证据。

## 运行

在backend根目录执行，已有批次不可覆盖：

```powershell
node examples/hydraulic-cloud-edge/resident/rate/run.mjs setup
node examples/hydraulic-cloud-edge/resident/rate/run.mjs verify
node examples/hydraulic-cloud-edge/resident/rate/run.mjs trial initial-10s 10s 32 32
# 先核查错误、资源和漏发，再决定是否继续，不能无条件整段执行。
node examples/hydraulic-cloud-edge/resident/rate/run.mjs trial initial-30s 30s 32 32
node examples/hydraulic-cloud-edge/resident/rate/run.mjs report
node examples/hydraulic-cloud-edge/resident/rate/run.mjs cleanup
node examples/hydraulic-cloud-edge/resident/rate/run.mjs audit
```

配置命令 `configure <edge-a|edge-b|edge-c|cloud|load> <cpu> <memoryMiB>` 仅在无负载且有本轮采样证据时使用；之后必须重新verify。需要故障取证时使用 `capture <label>`。最终实测结果另记验证文档，当前运行方案不能当作已达标证据。
