# JOB-RES-01 Application任务资源限制

任务编辑器“位置与文件”中增加可选资源限制，沿用原SchemaField/YAML同源编辑和服务端schema。CLUSTER任务可分别填CPU/内存，示例500m/512Mi；留空保持原行为，不增加默认额度或应用契约字段。

链路：Flow编辑/校验→保存修订→Execution冻结定义→原WorkerJob→KubernetesJobRunner首次创建时读取container.resources.limits→task容器。直接复用原生命周期，不改变ApplicationTaskRunner、资源准入/槽位、文件助手或独立卸载实验。已有Job接管不改配置。终端Docker资源配置不在此批，保存非空配置会明确拒绝。

模型只在FlowDefinition内新增ContainerResources/ResourceLimits记录和Container.resources字段，无新生产Java文件/表/接口。运行时负责容器资源；业务参数仍由应用契约负责。

参考本地Kestra提交0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4，`script/src/main/java/io/kestra/plugin/scripts/runner/docker/Cpu.java`以及`Docker.java`914–934行：可选任务运行资源由runner写入容器配置，未配置不写。本系统有意仅实现K3s Job原生limits，而非复制DockerOptions、动态属性或完整Runner体系；资源单位与默认请求语义遵循Kubernetes。

字段协议见[Job协议](../contracts/s4-job-execution.md)，测试与部署见[验证](../verification/VER-JOB-RES-01.md)。
