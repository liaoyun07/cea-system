# 三档文件 × 三个执行位置

TERM-SIZE-01：先验证5/50/500 MB都能在终端、边缘和中心云执行，不训练DQN或预设最优位置。串行一次每组合，是可执行性和初步耗时实验，不是稳定性能验收。

## 环境与口径

- 复用TERM-LOAD-01隔离模拟环境，来源sim-terminal-001，所属edge-a、中心cloud。终端Agent和任务共享0.5CPU/512MiB；本轮不改变云边Pod限额或加入网络整形，不能据此模拟中心云距离更远。
- 三档文件分别是5,000,000 / 50,000,000 / 500,000,000字节的合成振动CSV，固定10字节一行，500,000 / 5,000,000 / 50,000,000条。8192条确定性波形循环扩量，不是新增真实传感器采样。
- 同一新镜像、同一算法：均值、RMS、峰值、1024点窗口及越阈窗口数。每次最多保存一个窗口；与原offload-signal输出数值核验，旧应用版本不修改。内存占用不要求与文件大小相同。
- 镜像事先预热。完整耗时从终端POST请求前至成功结果解析完成，包括控制链、排队、文件准备/上传/下载、容器启动、计算及结果返回，0.5秒轮询。数据生成、镜像预热和事后审计不计入。
- result.json附加measurement：readComputeSeconds从打开文件前到统计结束，包含读取；cpuSeconds为算法进程CPU时间；maxRssKiB是算法进程峰RSS（不是整个终端或Pod资源组）；inputBytes为实际文件字节。
- 新任务超时PT20M，观察器最多25分钟；本批不提交DQN训练反馈，不混入原120秒奖励定义。
- 终端本地文件描述上限改为1GiB，文件读取/本地复制仍流式；Agent授权下载和普通/v1/uploads的64MiB上限不变。本批模拟网关/tmp改磁盘暂存，旧网关不动。

## 执行

先完成相关Python测试及JDK21完整verify，确认CEA无活动执行。不要重复capture/publish或删除失败回执以补成功。

```powershell
node deploy/terminal-load/matrix/experiment.mjs capture
node deploy/terminal-load/matrix/experiment.mjs prepare
# 完整verify通过后构建受影响backend镜像；不构建/重启无关服务。
docker build -f deploy/cea/backend.Dockerfile -t cea/backend:local .
node deploy/terminal-load/matrix/experiment.mjs publish
node deploy/terminal-load/matrix/experiment.mjs run
node deploy/terminal-load/matrix/experiment.mjs verify
```

数据及证据在`.local/cea/terminal-load/matrix`；终端原始回执在`.local/cea/terminal-load/state/sim-terminal-001/matrix`。run遇已有成功跳过；已有失败/未完成则停止，检查原executionId，不重复提交。audit.py需在现有网关镜像、CEA网络中运行，挂载/sim并通过私密环境文件读取S3凭据。

仅更新backend、这批模拟Agent和模拟网关暂存配置；原策略/Flow/数据集/旧网关及集群服务保持。页面数据流执行记录可以查看size-matrix-*策略的9条原生Execution。本批不新增API、数据库表或执行状态机。

结果见[验证记录](../../../docs/verification/VER-TERM-SIZE-01.md)。
