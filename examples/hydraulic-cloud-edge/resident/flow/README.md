# 从流程部署常驻液压处理服务

流程：中心云部署 → 三边缘并行部署。`CLOUD_URL` 使用中心任务的 `endpoint` 输出，`ROLE` 来自应用契约；全部业务 Deployment/Service 经 CEA 流程创建，不直接用 kubectl 代替任务。

前置：已发布 FLOW-DEP-01；CEA四集群/镜像仓库可用；已有 HC20 镜像和 `.local/cea/hc01/full` 原输入。镜像只增加固定参考文件，处理算法不变。目标命名空间 `cea-lab-flow-dep01`、NodePort31101、Flow `hydraulic-resident-services`；只创建本批资源。

更新Service要求现有后端账号拥有Service update。`permissions.mjs` 是本次获批准后的单次最小补权脚本，保存前后快照并保持其他规则/绑定；不是流程执行时自动提权。未获相应授权不运行。

在 backend 目录执行：

```powershell
node examples/hydraulic-cloud-edge/resident/flow/run.mjs before
node examples/hydraulic-cloud-edge/resident/flow/run.mjs prepare
node examples/hydraulic-cloud-edge/resident/flow/run.mjs deploy
node examples/hydraulic-cloud-edge/resident/flow/run.mjs repeat
node examples/hydraulic-cloud-edge/resident/flow/run.mjs update
node examples/hydraulic-cloud-edge/resident/flow/run.mjs verify
node examples/hydraulic-cloud-edge/resident/flow/run.mjs trial probe 10s
node examples/hydraulic-cloud-edge/resident/flow/run.mjs trial measure 60s
node examples/hydraulic-cloud-edge/resident/flow/run.mjs audit
```

`before` 在发布前保存原环境；`prepare` 注册带参考文件的应用版本、生成输入、通过平台创建命名空间；`deploy` 保存并执行真实 Flow。`repeat` 检查重复执行不替换 Pod；`update` 验证中心命令/Service端口更新而对象UID不变。`verify` 比较2205周期共90数组，并核对实际资源限制。

压测仍复用 HC20 的 load.js 和计量方法，日志前缀 HC20 表示该协议，RUN 和证据目录为本批 FLOW-DEP-01。每批128周期、32VU、目标140批/s（约2.996GB/s），业务各2核（中心1GiB、边缘2GiB），k6为7核5GiB；不调整WSL或旧服务。先10秒探针再60秒实测，错误或容量门槛触发即停止，不重跑失败标签。端到端速率为成功校验的原始信号字节÷首次HTTP发出至最后结果校验的跨度；不含部署/准备，不重复累计三边缘字节，漏发单独报告。

证据写 `.local/cea/flow-dep-01-20261018/`。任务完成后保留四个业务服务，成功测量后只释放负载Pod；未成功时保留现场等待诊断。页面可在原流任务编排打开该Flow，服务可在原边缘服务部署/资源管理查看。

## 本批结果（2026-10-18）

创建、重复执行通过；首次更新因旧RBAC缺update失败。获批补权后用 `run.mjs update-fixed` 提交同r2的新执行并验证成功，未覆盖原失败。90数组/2205周期正确性通过。探针1.451857GB/s；正式 `run.mjs trial measure-01 60s` 为2.209357GB/s，6199批全部成功，2202漏发。速率=132,685,163,520字节÷60.056秒，不是目标约3GB/s，也不代表重复稳定性。

旧 `measure` 标签仅预检发现探针Pod仍Terminating，未提交负载；证据保留。脚本现等待成功轮次Pod删除完成再返回，新正式标签只执行一次。审计PASS，负载Pod为0，四业务服务保持。已存在证据或Flow时不要重跑本批命令；完整记录见[验证](../../../../docs/verification/VER-FLOW-DEP-01.md)。
