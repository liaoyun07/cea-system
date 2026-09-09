# ADR-0008 S4外部运行接入

2026-09-10，ACCEPTED。用户授权完成S4剩余部分；基线6c7e9cf。逐批实现并验证S4-02b/c、S4-03、S4-04和S4-05，不进入S5。ADR-0007的显式Flow事实源继续有效，不恢复alias或自动Input派生。

## 来源与职责

本地Kestra提交0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4：core/models/tasks/RunnableTask.java由Worker调用run；core/models/tasks/runners/TaskRunner.java把执行环境、文件传输和取消交给Runner；script/src/main/java/io/kestra/plugin/scripts/runner/docker/Docker.java使用成熟Docker客户端执行显式命令与文件。项目不会复制插件市场或预建无消费者SPI。

镜像准备是deployment职责，不属于Flow控制节点。使用成熟[Skopeo copy](https://github.com/containers/skopeo/blob/main/docs/skopeo-copy.1.md)复制manifest与layers，采用--all和--preserve-digests；先解析源digest并固定源引用，完成后检查目标digest。digest参与实际复制和执行镜像定位，不是另加业务checksum。Registry认证使用管理员外置authfile，不把密码放入HTTP请求或命令行。

## 实施次序与当前消费者

1. S4-02b：ImageDistributionService经应用/资源公开目录检查权限、版本及集群启用状态；源Registry与目标地址仅由服务端配置允许。SkopeoImageClient执行真实复制。POST准备接口返回固定digest的目标镜像；同步、有界操作，不另建准备状态表或假后台队列。调用中断后可按不可变digest重试，不承诺多目标原子事务。
2. S4-02c：独立部署资源的期望配置与Kubernetes实际状态分开；deployment管理常驻Deployment，不写Execution状态。
3. S4-03：runtime在真实Task消费者处接入执行适配器；显式参数引用继续使用现有Binding，保存/提交不派生输入。resource拥有普通选址/资源预约和本地数据约束，runtime拥有TaskRun/Attempt及Job接管，Worker不写第二套Execution状态。
4. S4-04：HTTP/SQL及隔离Shell/Python通过同一Worker链，不把用户脚本放到宿主执行；外部副作用接管与取消必须有明确语义后再放开。
5. S4-05：独立环境验证凭据/权限、启动、进程/DB短时故障；不改动旧系统、旧集群或旧数据库。没有通过真实验收的批次保持未完成。

本决策只确定已授权S4的实施顺序，不将后续条目写成已实现。每个新增表/字段/接口必须有当批真实消费者，实际状态见进度文档。

## S4-02b/c 实现取舍

新增8份生产Java，无新表、字段迁移或SPI。Deployment生命周期直接使用Fabric8 7.7.0，Kubernetes持有期望/实际状态；不复制Kestra插件框架或新建Deployment状态机。与通用工作流的区别属于云边站点业务需求：镜像可预分发，常驻服务不是一次性Flow叶子任务。

客户端更新/删除显式lockResourceVersion，禁止客户端默认冲突重试覆盖并发修改。凭据仅由管理员配置，测试由真实K3s的namespace Role验证Deployment权限，节点/其它namespace访问被拒绝；Registry同样通过实际认证复制验证，不用mock权限。

镜像拉取认证与Skopeo复制认证分离，前者由目标集群管理。当前常驻Deployment不提供Service/Ingress路由。真实一次性Job、资源预约、脚本、进程/DB完整故障闭环必须在后续S4批次分别验收。
