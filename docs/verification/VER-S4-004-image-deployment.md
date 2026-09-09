# VER-S4-004 镜像准备与常驻部署

日期2026-09-10，基线Git 6c7e9cf9288b61785c6f1edfc1fd201e388447b1，加本批工作区修改；对应S4-02b/c、DEP-002及SEC-001部分。

## 最终验证

JDK21.0.7、Maven3.8.8、Windows11、Docker Desktop29.5.3。运行 scripts/verify.ps1，于 **02:33:49 +08:00** 成功：103项，0失败、0错误、0跳过。19项runtime单元、72项真实MySQL回归、8项Registry/Kubernetes集成、3项协议、1项架构。随后仅更新文档，未改变生产代码或测试。

独立Testcontainers MySQL8.0、两个认证Registry2、Skopeo1.20.0、K3s v1.30.6-k3s1。应用使用实际Alpine镜像；另一个OCI tar layer fixture核验传输后的实际字节。K3s预载真实pause镜像，避免每次Pod启动依赖公网拉取。未连接旧数据库或旧K3d集群，临时集群、Registry、工具容器和凭据文件测试后清理。

## 新增8项

1. 真实跨Registry复制manifest/layers，逐层核验digest；同digest重复准备返回一致引用。
2. 禁用/未配置目标、未配置源Registry、权限不足均拒绝。
3. Registry真实401、错误认证和缺失镜像失败；错误不泄露认证数据。
4. 准备API的匿名401、只读403、授权200及真实digest返回。
5. 常驻Deployment实际启动就绪、列表、版本冲突拒绝、replicas=0停止、旧版本删除拒绝及实际删除。
6. 容器exit7导致未就绪，不返回成功标记；非本平台所有者资源不能读取/覆盖/删除。
7. 未知/错误类型契约参数、未配置集群连接、只读修改拒绝，未创建无效资源。
8. 部署HTTP身份边界；后端使用K3s namespace Role，仅可管理目标Deployment，读取节点和其它namespace Deployment均被真实API拒绝。

代码与协议：新增8份生产Java、1个测试类、5个HTTP操作；共62份生产Java、7个测试类、27个HTTP操作、30个record字段映射。业务表仍14张、迁移V1–V7不变。Execution主链及Flow模型没有修改，没有第二套alias/binding，没有新增无消费者SPI或业务checksum。

## 过程中失败与修正

- 初次镜像测试发现digest-only目标没有tag列表，Skopeo inspect改为--no-tags。
- 测试认证隔离和manifest Accept头不完整，修正为显式空authfile与OCI/schema2 Accept；不放宽生产认证。
- 审查Fabric8发现默认replace会刷新resourceVersion重试；改为显式lockResourceVersion更新/删除。
- 一次真实测试遇到Docker Hub pause下载EOF，预载实际pause镜像到隔离K3s；没有将业务测试替换成mock。
- 增补最小RBAC测试时误用JSON读取YAML kubeconfig导致初始化失败；改为YAMLMapper，定向8项及最终103项回归全部通过。
- 回归中的Flyway ERROR来自已有迁移保护的预期拒绝测试，不是忽略迁移失败。

## 未验收范围

本次没有完成整个S4。S4-03的一次性Job/资源观测/原子预约/命名产物/远端取消接管，S4-04的HTTP/SQL/隔离脚本，以及S4-05完整部署/进程和DB故障验收仍需实施。这里是单机隔离K3s模拟，不声称真实多云或生产集群验收。没有Service/Ingress、DQN、算法计量或旧数据迁移。
