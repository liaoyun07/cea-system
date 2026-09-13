# ADR-0023：Pod 文件助手与按执行位置存储

状态：已接受并实施，FILE-01已发布CEA（2026-09-13），现场验收见[验证记录](../verification/VER-FILE-001-pod-artifacts.md)。

## 决策与边界

用户授权修改、测试并部署。将 Kubernetes Runner 的文件传输从中心后端移入 Pod：输入 init 助手下载，算法容器执行，输出助手上传。三者共用临时工作目录，算法仍使用 `/cea-work/in`、`/cea-work/out`，不修改算法镜像或 Flow DSL。

ApplicationTaskRunner 在原 Placement 确定 cluster 后，将输出 URI 冻结到该 Attempt 的 Prepared；ObjectStorage 根据 namespace + bucket 定位源存储。同域和跨域输入都由目标 Pod 直接读取源存储，不自动绕中心，不增加目标存储缓存。中心仍控制 Job、确认已发布对象及读取限量 JSON/Metrics。

只使用现有 Execution/TaskRun/Attempt/Worker/Runner/Binding。取消继续 suspend 原 Job，传输或控制面恢复协调同一个 Job，不重新执行算法命令。输入助手失败不得启动算法；输出上传失败不得成功完成任务。

短期、限定对象和 GET/PUT 方法的授权通过每 Attempt 的 Secret 提供，只挂助手，不挂算法；无长期 S3 密钥进入 Pod。Secret 由 Job 所有，完成时移除。存储/网络重试限于文件传输；Worker 可刷新 Secret 中的授权。禁止把授权 URL 存入 Prepared、日志或业务输出。

不新增常驻“交接服务”。此前讨论的该服务方案由本 ADR 的 Pod 助手方案替代。不引入终端上传、边缘策略触发、DQN、吞吐率、数据迁移或新存储 GC。Docker 终端 Runner 是既有 Filesystem 的独立消费者，本批保留其文件传输，显式配置终端输出存储。

## 参考与差异

- 本地 Kestra `0354ddf8cb`：`core/.../models/tasks/runners/TaskRunner.java`、`core/.../storages/StorageInterface.java` 的 Runner 文件生命周期和 namespace 存储职责；不复制类数量或引入另一执行引擎。
- [Argo Workflows 3.7 architecture](https://argo-workflows.readthedocs.io/en/release-3.7/architecture/)、`cmd/argoexec/commands/init.go`、`wait.go`：init/main/wait 分工。只借鉴分工，不复制 Argo CRD/控制器/执行器。
- 云边业务差异：按实际 cluster 选择持久存储；输入源可跨存储。阶段简化：声明文件、HTTP S3 签名传输，无缓存、GC、任意传输协议。

## 持久化、部署与验收

不新增 SQL 表/列；Prepared 增加 outputUris、helperImage，分别被发布确认和 Job 创建消费。签名每次生成，不持久化。升级前须排空旧 prepared 的活动任务，历史产物按原 URI 查找，保留中心 bucket。接受新边缘产物后，不可简单回退到只认识中心存储的旧版本。

CEA 新增三个独立卷的边缘 MinIO 与助手 Secret RBAC，需要单独确认后应用。中心 MinIO/数据库/Registry/算法集群不重启。Pod 必须能访问源/目的存储；CEA Docker 内部地址由部署脚本发现并写入本地配置，不假设禁用 CoreDNS 的集群能解析 Docker 服务名。真实多云部署须配置可达地址和 TLS。

验收：真实 K3s 输入/输出、跨存储、历史 JSON/Metrics、缺失输入/输出、取消、同 Attempt 恢复、Secret 隔离；FedAvg/FedProx 不改 Flow/镜像运行；完整 verify、scaffold、上线健康及原有数据保护。测试和部署结果另记，本文不表示已完成。
