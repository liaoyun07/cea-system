# 终端负载与调度

脚本创建终端；页面只负责发送负载、切换策略和查看结果，不创建 Docker 容器。

## 使用

在 backend 目录运行 PowerShell（Docker Desktop Linux 容器、cgroup v2）：

```powershell
./deploy/terminal-load/setup.ps1 -Action Prepare -Count 4 -Cpu 0.5 -MemoryMiB 512
# 首次准备后，发布本批后端与前端，使 terminal-load.yaml 配置生效。
./deploy/terminal-load/setup.ps1 -Action Start
./deploy/terminal-load/setup.ps1 -Action Calibrate -CalibrationBatch v1
```

打开“基础资源管理 → 终端设备接入 → 负载与调度”，选择模拟终端，点击“开始发送”，切换“全部终端执行 / DQN 智能卸载”，完成后“停止发送”。任务排空后才释放终端供下一批使用。原终端的登记、编辑功能保留。

`Prepare` 可指定 1～64 个终端；`Start` 按已保存配置启动。调整数量/限额前先停止发送并等待任务排空。`Stop` 停止本批网关、执行环境，不删除数据；下一次用 `Start` 启动。几十个终端共用执行引擎，数量不等于物理机器数，实际并发还受宿主机、后端 Worker 和集群槽位限制。本次实际联调为 4 个终端，不宣称 64 台满载测试通过。

## 模拟与真实计算

- 新容器 `cea-terminal-load-engine` 是专用 DinD，Docker 仅 Unix socket，不对外开放 TCP；`cea-terminal-load-gateway` 仅负责终端认证/转发。旧 engine/gateway/terminal 不变。
- 每个 `sim-terminal-NNN` 是 Agent＋发送器容器。它与该终端的任务容器共用父 cgroup；0.5 核、512 MiB 是默认资源预算，不是每个任务再分一份。
- 信号为确定性合成振动数值（含周期脉冲），小/中/大为 131072/524288/2097152 个样本。CSV 文件只预置在终端挂载目录；逻辑终端使用相同样本池，底层磁盘/宿主机共享。
- 原 `offload-signal/off02-v1` 镜像在终端与集群执行同一 Python 程序，计算均值、RMS、峰值及越阈窗口；只生成 `result.json`。没有等待/虚假 CPU 曲线替代计算。
- 请求按独立终端种子的指数间隔到达，不等待上一任务结束；混合规模使用另一个随机序列。固定种子便于复现到达序列，不保证 OS 调度时刻完全相同。
- 仅选到云/边时才读取并上传原始文件；云端通过授权读取边缘存储，不强制再复制原始数据到中心存储。结果返回终端，单调时钟在取得结果后结束。
- `Calibrate` 预热镜像，并通过每个终端的边/云请求采集现有 DQN 所需传输记录。复用 `off04-dqn` 的固定模型版本、exploration=0，不改网络、奖励或选择结果。校准不是模型训练。

## 本地生成文件

`.local/cea/terminal-load/` 保存本批 Compose、私密令牌、信号文件、Agent 状态、校准回执及测试证据；不提交 Git。`deploy/cea/secrets/backend/terminal-load.yaml` 仅增加本批 CONNECT 网关、传输连接及策略对。新增 S3 账号仅能读写这些模拟终端的 ingress 前缀，不改变旧网关权限。

重新校准使用新的 `-CalibrationBatch`，旧失败回执仍保留，不将失败覆盖成成功。每个已接收请求仍是一条原生 Execution，可在数据流执行记录中查到；页面负载批次只是关联与统计。

## 验证

`verify.mjs capture` 保存发布前服务/定义快照和数据库备份；`ready` 检查无活动执行；`browser` 在真实页面完成四终端开始/切换/停止；`screenshot` 只读截图；`preserved` 验证旧对象与非目标服务不变。`audit.py` 独立复算数值并检查原始文件是否真的上传。命令依赖本地私密 `.env`，不输出凭据。

完整结果见 [TERM-LOAD-01 验证记录](../../docs/verification/VER-TERM-LOAD-01.md)。
