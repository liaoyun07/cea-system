# HC-14/15：3 GB/s 目标输入下的完整业务压测

## HC-15 连接修复与复测

HC14之后用户授权定位修复。新的诊断批次实证中心连接接入队列溢出、SYN-cookie失败和首次转发连接RST，并测得空载小响应正文约45ms等待。修复仅涉及监听队列128、TCP_NODELAY和坏连接清理（失败不重试）；计算并发/算法/资源/数据不改。完整来源与实测见[HC-15](../../../../docs/verification/VER-HC-15.md)。

通过环境变量选择独立revision，各自保留证据/失败标记。先清理并审计diagnostic，才能复用31095部署fixed；不能删failed标记或重用已有标签。对应镜像分别为`cea/hydraulic-resident:hc15-diagnostic`、`cea/hydraulic-resident:hc15-fixed`，需要先构建明确的镜像版本。

当前源码是fixed版，可用本目录上级Dockerfile构建；diagnostic当时源码保留在本地证据的protocol中，原镜像仍保留，不能用当前修复源码覆盖历史diagnostic标签。以下是协议说明，已存在的批次目录不会被脚本重跑或覆盖。

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
