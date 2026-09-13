# ADR-0022 管理删除、人员身份与独立构建边界

2026-09-13，UI-10。用户授权删除、简单ADMIN/USER、在线构建并发布前后端，随后明确允许新增独立BuildKit和缓存。

删除是管理可见性，不串联业务文件/工作负载销毁。沿已有Application tombstone语义给Flow头、Execution、DatasetVersion增加deleted真实判断列。保留版本身份防复用、保留request key防重复运行；活动执行/后处理时不删Flow/历史。使用现有提交/调度/登记的事务锁，不另增分布式锁/SPI。dataflow通过resource/deployment公开服务协调Dataset引用，不跨表。

人员在server既有IdentityDirectory维护sec_user，沿用AccessPolicy。ADMIN增加人员管理，USER使用授权空间；不做组织/SSO/角色编辑器。配置只用于一次bootstrap，避免重启覆盖改密；CONNECT继续外置。表字段均参与当前登录或权限行为，不增Repository接口/域模块。Basic仍限回环/可信网络，不扩大TLS后置范围。

在线构建不是Flow任务或第二条Worker。ImageBuildService管理有界进程/临时文件，独立rootless BuildKit执行Dockerfile，归档复用ImageUploadService。不挂宿主Docker控制接口，不接受请求命令、不传业务凭据；builder保留process sandbox，仅其容器调整seccomp/AppArmor/systempaths支持rootless嵌套，独立于CEA业务网络。此实验室配置不是强多租户沙箱。保留层缓存，不提前实现持久构建历史/队列/异步重试。

参考本地Kestra提交0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4：webserver的FlowController.deleteFlow、ExecutionController.deleteExecution；jdbc的AbstractJdbcFlowRepository.delete。借鉴定义/执行独立生命周期及逻辑删除，**有意简化**purge、产物/日志清理和非终态删除。Execution已有definition快照作为历史图事实源。

BuildKit依据[官方README](https://github.com/moby/buildkit/blob/v0.33.0/README.md)和[rootless文档](https://github.com/moby/buildkit/blob/v0.33.0/docs/rootless.md)，不使用no-process-sandbox。独立构建属于本项目应用目录/多云分发需求，不声称迁移了Kestra IAM或构建实现。
