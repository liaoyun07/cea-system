# FL-RESOURCE95-01：首次95%准确率的Job资源成本

2026-10-17用户授权，复用现有 `mnist-strong-fedavg` / `mnist-strong-fedcads` r1。完整MNIST训练60000，三个边缘客户端3000/12000/45000，官方独立测试10000；MLP、batch128、local epoch1、lr0.1、seed31、40轮；CADS alpha0.001/rho0.1及schedule40。先FedAvg、再FedCADS，不同时争抢同一Docker宿主，不改算法镜像、数据、资源限额、Flow或服务。

原流程无自动早停，CADS schedule又与40轮绑定，因此保留两次40轮完整执行。事后选择首次accuracy>=0.95的evaluate，按父链确定轮号，累计init和截至该轮的所有train/aggregate/evaluate Job（包含失败Attempt）。不计后续轮次，不将事后截取冒称实际提前结束的流程。

主指标：三容器files-in/task/files-out累计CPU核秒与内存工作集积分GiB·s。辅助：积分除Flow.startedAt至首次达标evaluate.endedAt得到平均内存；另按角色、执行位置和task/helpers拆分。缺失摘要不能填0，采样峰值不相加冒充系统峰值。共享MySQL/MinIO/K3s控制面不在Job容器计量内。

```powershell
node --test examples/federated/resource95/analysis.test.mjs
node examples/federated/resource95/run.mjs prepare
node examples/federated/resource95/run.mjs run
node examples/federated/resource95/run.mjs report
node examples/federated/resource95/run.mjs audit
./examples/federated/resource95/audit.ps1
node examples/federated/resource95/run.mjs cleanup
```

prepare只读校验/快照，拒绝覆盖已有快照；run只新增两条Execution，已取得的executionId继续跟踪，不重复提交；失败保留、不自动替换。证据保存在忽略的 `.local/cea/fl-resource95-20261017/`，不提交凭据/数据/模型。单seed配对不证明稳定改善；若某方40轮未达95%，没有该方达标资源值。

训练中可用 `node examples/federated/resource95/run.mjs inspect` 只读检查资源采集；首次达标后可用 `prefix fedavg` / `prefix fedcads` 保存一次前缀快照，已有快照不覆盖。最终audit核对后续轮次未改变该前缀统计。

audit.ps1只读下载本批4份init/首次达标模型，用原镜像及原官方测试集离线复评，同时验证主初始权重一致、CADS schedule40和客户端权重。cleanup先确认双方执行成功且环境/模型审计通过、记录属于对应执行，再按名称/UID删除本批Job与Pod、核验数据库资源记录保持；不删除Flow、Execution、数据集或模型产物。清理后不再运行run的Pod/Job审计，但report可直接从保存的证据重新计算。

本批首达标CPU381.42→141.21核秒，内存101.55→40.47GiB·s；平均内存124.49→141.19MiB，未下降。完整40轮下CADS不省资源且最终准确率94.93%，不能把首达标结果解释为所有后续轮次保持95%。详见[真实结果及核验](../../../docs/verification/VER-FL-RESOURCE95-01.md)。
