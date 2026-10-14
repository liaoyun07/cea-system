# 独立卸载实验

代码状态：已部署，云边端五任务真实验证通过；30 终端配对实验结果见 [验证记录](../../docs/verification/VER-OFF-INDEP-01.md)。

本目录不调用普通流任务接口。三个边缘各有网关/执行队列，中心云独立队列；控制服务只管实验启停和统计。终端一个计算槽和一个独立串行上传槽。详细协议见 [OFF-INDEP-01](../../docs/contracts/offload-independent.md)。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| core.py | 五维输入、策略、字节积压、泊松计划、短 SQL 存取 |
| node.py | 网关决策、目的地预约、输入就绪与本地执行队列 |
| terminal.py | 终端请求、FIFO 上传限速、本地执行与 cgroup 采样 |
| execution.py / worker.py | 直接 k3s/Docker 执行，同一原振动统计算法 |
| controller.py / server.py | 实验控制、统计、批次清理、内部 HTTP 接口 |
| setup.mjs / bootstrap.py / initialize.py | 显式新增环境，不重建旧终端 |
| provision-kubernetes.mjs | 四集群专用 Namespace 与限域执行账号，不扩大旧后端权限 |
| refresh.mjs / cleanup_run.py | 空闲时更新本批环境 / 重试终态实验清理，保留原执行结果 |
| compare.mjs | 相同轨迹 LOCAL → RANDOM；保存原 ID，失败停止，不重放 |

## 固定配置

- 30 新终端 `oil-terminal-001..030`，每边缘 10 台；旧 `sim-terminal-*` 不动。
- 每终端总 CPU 0.1 核、内存 512 MiB，代理及计算子容器同一父 cgroup。每终端同时计算 1 个任务，计算子容器内存上限 256 MiB。复用专用模拟 Docker 引擎；共享 Docker daemon 开销不归属于某个终端。
- 每边缘 2 槽 × 0.5 核，中心云 2 槽 × 1 核，每个 Job 512 MiB。任务池总 CPU 比为单终端∶单边缘∶中心云 = 1∶10∶20；这是任务资源额度，不是物理 GHz，也不是修改集群宿主机硬件。
- 每终端独立 100 Mbps 上传，云边一致；应用层额外等待边缘 10 ms、中心 100 ms。等待占用该终端上传槽；真实数据仍实际 HTTP PUT，明确不是内核网络整形。
- 5/50/500 MB 概率 60%/38%/2%，同一现有只读模板；任务最大运行 1800 秒。
- 首批计划发送 90 秒、每终端平均间隔 10 秒、seed31。每实验完全排空后才开始下一批。

## 命令

从 backend 根目录执行。`prepare` 仅生成被 Git 忽略的 `.local/cea/terminal-load/offload-lab` 配置；`install` 必须先得到新增环境和目录删除权限的用户授权。

```powershell
python -B -m unittest discover -s deploy/offload-lab -p 'test_*.py' -v
docker build --target runtime -f deploy/offload-lab/Dockerfile -t cea/offload-lab:independent-v1 .
docker build --target worker -f deploy/offload-lab/Dockerfile -t cea/offload-worker:independent-v1 .
node deploy/offload-lab/test-integration.mjs
node deploy/offload-lab/setup.mjs prepare
# 仅取得授权并核对旧任务已排空后：
node deploy/offload-lab/setup.mjs install --approved-new-environment
# 完整验证通过后单独发布 CEA backend/frontend，使页面代理配置生效。
node deploy/offload-lab/compare.mjs
```

安装新建 SQL 三表及专用 SQL 账号；MinIO 专用账号仅本批 `lab/offload-lab/*` 前缀读写删。四集群新建 `cea-offload-lab` Namespace，专用 ServiceAccount 仅在本 Namespace 创建/查询/删除 Job、查询 Pod，不能修改旧业务，也不需要 Pod 日志权限。仅预载新任务镜像，不删旧缓存。安装不自动重启原后端/前端。脚本非幂等重建器：中断后检查已存在资源，不能盲目重复 install。

实验结束保留 JSON 证据、SQL 记录和资源采样；任务结果文件/输入副本/Job/容器按整批清理。新链路不提供高可用自动重放。出错保留原记录/文件并停止对比，不宣称失败子集的平均数代表收益。
