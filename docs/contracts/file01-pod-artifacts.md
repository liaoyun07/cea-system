# FILE-01 文件助手协议

FILE-01原批次不增加外部HTTP API、Flow字段或SQL迁移，替代 [S4 Job](s4-job-execution.md) 的Kubernetes中心搬运；终端Docker的Filesystem保留。后续ART-CLEAN-01增加的清理标记与V34迁移见本文末尾。

## 所有权与文件计划

1. ApplicationTaskRunner 解析原 Binding、NamespaceFile 修订和 DatasetVersion。原 Placement 选择 cluster，原镜像分发准备算法 digest。
2. Prepared 冻结 cluster/spec/inputUris/inlineFiles/**outputUris/helperImage**/终端目标，仍写 `wf_worker_job.prepared_json`。两个新增字段分别由输出确认和 Job 构建读取；无签名 URL、密钥、额外执行状态或兼容旧计划分支。
3. ObjectStorage 按 namespace + bucket 唯一定位源存储；outputs 配置只决定新 Attempt 的输出目的地。保留历史 bucket 后，旧 URI 仍可用于后续任务和精确产物 JSON 读取。不能用当前输出配置重算历史 URI。
4. Runtime 通过 `ContainerTask.Transfers.authorization()` 获取瞬时 JSON：`inputs: {name: GET授权}`、`outputs: {name: PUT授权}`、`inline: {name: 小文本}`；`published(name)` 只 HEAD 已冻结 URI。无 runtime → platform 依赖。

## Pod 生命周期

Job 身份、租约、取消和 retry 不变：一个 Attempt 一个 Job，backoffLimit=0，Never。

FLPAR-11 启动顺序：Runner 创建 `suspend: true` 的 Job，附 `cea.platform/files-pending: "true"`，先写入该 Job UID 所有的文件授权 Secret，然后在一次 Job 更新中删除 annotation 并解除挂起；因此 Pod 创建前 Secret 已存在。Worker 在准备断点恢复时沿原 Job UID 继续，不新建第二个 Job。annotation 的唯一消费者是 Runner，用于区分“准备尚未完成”与外部暂停；无 marker 的挂起 Job 仍按原暂停/停止语义处理，不能自动复活。准备前及解除挂起前检查取消；观察到取消不解除挂起，跨数据库/Kubernetes的最后一刻竞态仍由原取消轮询停止，不声称跨系统原子取消。无数据库字段/状态机或授权旁路。

- `files-in` init：建立共享目录，内联小文本落盘，流式 GET 输入；全部完成后写 start。失败不会启动算法。
- `task`：原镜像/command/env，读 in、写 out；原 wrapper 执行命令一次，记录 exit，再等待 published。
- `files-out` 普通伴随容器：等待 exit；算法成功才 PUT 全部声明输出，完成或失败均释放 wrapper；其自身失败使 Job 失败。Runner 检测任一容器异常退出（包括 OOM/被杀、没有 exit 标记）后 suspend 并等其停止，避免助手无限等待。
- 只有 Job Complete 且所有声明 URI 的对象存在，才返回成功 outputs。部分上传不会成为有效 TaskRun 输出；ART-CLEAN-01仅清理已配置的临时输出，包括失败Attempt留下的同名文件，其他部分对象不自动GC。

输出必须为助手可读的普通文件，拒绝路径穿越、目录、符号链接/FIFO；不展开用户压缩包。算法仍需 `/bin/sh`、sleep 和 wrapper 使用的基本文件命令；K8s 文件搬运不再要求 tar。Docker Runner 仍有自己的 tar/cp 需求。共享目录不是恶意算法强隔离沙箱。

传输采用单对象 GET/PUT，未实现分片上传或断点续传；大对象受具体 S3 服务的单次 PUT 限制。任务 timeout 包括文件传输，不把文件传输成功当作算法成功，也不将本批传输计时包装成数据处理速率。

## 授权和恢复

- 签名有效期 1 小时，固定对象及 GET/PUT 方法；Worker 每 15 分钟及接管时更新原 Secret。助手每次重试重新读整个投影文件（不使用 subPath）。网络/403/429/部分5xx 最多重试 5 分钟，任务原 timeout 同时生效；404/本地缺失输出直接失败。
- 每 Attempt 的 `cea-<taskRun>-a<n>-files` Secret 由 Job UID 所有，只挂到助手；算法没有 Secret mount/env，助手没有长期 S3 密钥或 Kubernetes token。JSON 上限 900000 字节，在 Prepared 提交前校验；小文件和签名 URL 属控制元数据，不在此传输模型/数据集。
- Secret 在成功、失败、取消后移除，Job ownerReference 在运维删除 Job 时兜底。RBAC 最小到执行 Namespace 的 secrets get/create/update/delete；K8s Runner 不再需要 pods/exec。Kubernetes RBAC 无法按动态名称前缀约束 create，故此权限是 Namespace 范围，并非只授权一个名字；执行 Namespace 不应混放其他业务敏感 Secret。
- Worker 离线不使 Pod 自动重跑。算法和文件阶段可继续，恢复后查同一 Job，再 HEAD/归并。中心不可达时没有新的调度/授权刷新；这不是离线边缘自治。
- 不上传异常信息中的 URL；日志只给阶段错误类型/HTTP 状态。生产多云必须为存储配置 Pod 可达的 TLS 地址，管理网络上控制 Kubernetes Secret 读取权限。

## 存储配置

```yaml
platform:
  jobs:
    helpers:
      lab:
        edge-a: registry.example/cea/file-helper@sha256:<真实digest>
        cloud: registry.example/cea/file-helper@sha256:<真实digest>
    storage:
      lab:
        outputs: {cloud: center, edge-a: edge-a}
        terminal-store: center
        stores:
          center:
            endpoint: https://center-s3.example
            transfer-endpoint: https://center-s3.example
            access-key-file: /run/secrets/center-access
            secret-key-file: /run/secrets/center-secret
            artifact-bucket: cea-artifacts
            readable-buckets: [datasets]
          edge-a:
            endpoint: https://edge-a-s3.example
            transfer-endpoint: https://edge-a-s3.example
            access-key-file: /run/secrets/edge-a-access
            secret-key-file: /run/secrets/edge-a-secret
            artifact-bucket: cea-artifacts-edge-a
```

endpoint 用于后端 HEAD/有界 JSON/终端搬运；transfer-endpoint 用于助手授权地址，省略则等于 endpoint。签名 region 当前固定 us-east-1（CEA MinIO）；不是任意 AWS region 的完整适配。namespace 内各 bucket 必须唯一归属一个 store，禁止同名桶跨 endpoint 引起 URI 歧义。输出 store 必须显式映射，不可用时失败/协调，不偷偷转中心。

CEA 使用既有中心 MinIO 和三个新边缘 MinIO/独立持久卷，无新增宿主公开端口。四算法集群不重启；`setup-files.ps1` 配置 Bucket/用户权限、推送助手 digest、应用 RBAC、生成 ignored 的 `secrets/backend/storage-endpoints.yaml`。因当前关闭 CoreDNS，授权使用发现的 Docker 内网 IP；重建存储/更换网络后需重新运行此配置步骤并更新后端。实际跨地域部署应使用稳定可达的存储域名。现有 datasets 仍在原中心桶，未迁移，也不能据此宣称训练数据已物理驻留边缘。

## 流程结束后的临时输出清理（ART-CLEAN-01）

CEA默认配置 `platform.jobs.temporary-output-files: prepared.pt`；无配置的环境不启用。此文件是同一次执行内部消费的临时产物，不能再把它当作跨执行持久数据源；新执行会重新预处理。原始数据集、model.pt、report.json及其他结果不受影响，历史输出URI和日志保留，但已清理的prepared.pt不能再下载。

调用链：ExecutorPump每10秒调用ExecutionArtifactCleanup → ExecutionService按批查询 → ObjectStorage逐存储删除 → ExecutionService记录完成。只有Execution与全部TaskRun（包括errors/finally/afterExecution）都进入终态才处理；SUCCESS、FAILED、KILLED、SKIPPED及软删除历史均纳入。只列举本执行 `namespace/executionId/` 前缀、只匹配 `taskRunId/attempt/配置文件名`，不扫描或删除datasets桶。S3调用不持有DB事务；失败保留待清理标记，下批重试，不改变原执行状态、耗时、日志、输出或指标。

V34新增 `wf_execution.temporary_outputs_cleaned` 及候选索引，唯一消费者是该批处理，用于成功后停止重复扫描并支持进程重启；未新增表、API、Flow字段或执行状态。当前配置按固定策略使用，不提供历史保留时间或策略变更回溯。IAM只增加各产物桶 `lab/*/prepared.pt` 的DeleteObject权限，不授予删除模型/报告/数据集的权限。

参考本地Kestra `core/src/main/java/io/kestra/plugin/core/storage/PurgeCurrentExecutionFiles.java`，提交0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4：其显式任务调用storage删除当前执行文件。本系统有意简化为执行结束后的后台维护，且只删除配置的临时文件，而非删除全部输入输出；不新增工作流任务类型。验证见[ART-CLEAN-01](../verification/VER-ART-CLEAN-01.md)。

## FILE-01原始升级边界

上线前排空全部活动 Execution/旧 prepared；无 SQL migration，也无旧 K8s 搬运兼容链。保留中心 bucket/原 URI 和所有历史修订/产物。新边缘输出上线后，回退版本也必须理解多存储 URI；旧中心-only版本不能直接接手这些结果。验证及部署状态见 [进度](../04-progress.md)。
