# VER-DEP-WARM-01 中心云 Agent Sandbox 安装验证

2026-10-16（Asia/Shanghai），安装与功能闭环通过。仓库基于 `8607b0aa775333c93022708df9eacd7817d31fe6` 加本批脚本/文档；最终源码提交见 Git 记录。未修改平台生产代码或复跑 Java/前端业务回归。

## 环境与安装

- 仅 `cea-cloud-1`，K3s `v1.30.6+k3s1`、containerd `1.7.22-k3s1`、Linux amd64。
- 上游 `v1.0.2/sandbox-with-extensions.yaml`；镜像 `registry.k8s.io/agent-sandbox/agent-sandbox-controller:v1.0.2`。
- Namespace `agent-sandbox-system`，单副本 core + extensions controller，四类 v1beta1 CRD。服务端校验与实际安装成功。
- 只给上游控制器增加 requests CPU100m/内存128Mi、limits CPU500m/内存512Mi。没有安装数据库、消息队列、router 或替换容器运行时。
- 控制器健康接口返回 `ok`，Ready=1/1、重启0；测试清理后一次 Metrics Server 采样为 **CPU 1m、内存77Mi**，不是长期平均值或预热池总成本。

## 真实功能验证

独立 Namespace `cea-warm-verify`，同一非特权 Nginx 镜像：

`nginxinc/nginx-unprivileged@sha256:7377697a821c131a924a7105fafbe7414db4e9fcc77a6f08f776f33f141ec3f8`

每个应用 Pod requests CPU50m/内存32Mi、limits CPU500m/内存128Mi，HTTP8080 就绪检查；仅通过配置 HTTP 响应返回 Pod 名识别真实实例，没有自建镜像或人为增加启动延迟。

| 检查 | 结果 |
| --- | --- |
| 预热池维持2个就绪实例 | 通过 |
| 未领取实例不在业务Service endpoints | 通过，0个 |
| 同时提交2个Claim领取预热实例 | 通过，2个不同实例 |
| 领取前后Pod UID、containerID、startedAt一致 | 通过，真实复用，没有重新启动容器 |
| 领取后Pod直连及共享Service HTTP | 通过，返回被领取Pod名称 |
| 自动补池 | 通过，2个已领取＋2个新的就绪备用实例 |
| 0库存池新建实例 | 通过，新Pod UID、HTTP可用 |
| 删除Claim回收已领取实例 | 通过，3个已领取Pod删除、只剩2个备用、业务endpoints归零 |
| PVC/业务存储 | 无PVC，无MinIO/MySQL写入 |

首次两个备用 Pod 为 `warm-http-gkxtb`（UID `26f81644-cfa4-4a9a-a7d9-7616daeb184a`）和 `warm-http-rrq5p`（UID `90b403e8-ed7f-4243-b130-467bed106dcb`），均在 UTC17:31:50 启动。两个 Claim 分别接管这两个原 Pod；补池创建 `warm-http-47cbt` 和 `warm-http-nbk2d`，在 UTC17:31:54 启动。新建路径为 `cold-application`，UTC17:31:59 启动。

测试记录包含双Claim校验全过程3.076秒、单冷Claim校验全过程2.686秒。这两个区间包含不同数量的CLI查询、Pod/容器身份检查和HTTP验证，**不是同负载性能对照**；冷路径镜像也已缓存，不计算提升比例，不据此声称预热加速或20%达标。

## 日志、清理与环境保持

日志未掩盖：创建模板时出现一次 NetworkPolicy `already exists` 重试（2行error），随后策略建立、领取与HTTP全部成功；删除测试命名空间时控制器仍短暂补建对象，被 Kubernetes 的 terminating namespace 拒绝（27行error），随后命名空间完全删除，无遗留或持续错误。删除冷实例期间有一次 readiness 连接拒绝事件；发生在停止容器阶段，不是启动失败。原始日志/事件留在本地证据。

测试 Namespace、Claim、Sandbox、Pod、Service、ConfigMap、NetworkPolicy 已清理；这些都是本批无持久数据的测试对象，配置清单保留，可重建。控制器/CRD/RBAC保留，当前没有业务预热池。未删除镜像缓存，不涉及旧数据。

环境审计通过：原 **31个CEA Docker服务** 的容器ID和启动时间未变且仍运行；四集群原 **23个Deployment** 的UID/完整spec、HPA未变；三个边缘集群的Deployment/CRD/Namespace没有新增或变化。中心云只新增本批组件。没有后端账号权限修改、HPA开启或生产应用重启。

三个脚本 `node --check` 通过；`scripts/check-scaffold.ps1` 通过。这里只验证组件和相关文档，不替代平台完整业务回归。

## 证据与下一步

本地 `.local/cea/agent-sandbox-cloud-20261016/` 包含上游原清单、安装清单、before、兼容校验、controller-health、test-manifest、warm-before/claimed/refilled、cold-claimed、test-result、test-events、test-final-objects、test-cleanup、audit、controller.log 和控制器采样。原 `before.json` 的 `commit` 字段存放的是 Kubernetes version JSON 字符串，不是源码提交；源码基线以上文为准。

需要进一步验证效率时，使用相同服务镜像、资源、探针与目标新增副本数，对比“扩容请求到新增实例可服务”，单独记录池补充时间和备用实例开销；本批尚未进行该对照，也未接入现有部署页面。

[功能说明](../features/DEP-WARM-01.md) · [操作脚本](../../deploy/agent-sandbox/README.md)
