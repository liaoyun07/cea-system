# ADR-0015：终端 Docker 与统一 Application 执行链

状态：已接受，S5-04a已实施并通过完整验证，见[验收记录](../verification/VER-S5-005-terminal-docker.md)。用户于2026-09-10确认参与本地算法执行的终端安装Docker；不要求传感器安装Docker。S5-04b仍未实现，不进入S5-05。

## 决策和批次

S5-04先完成a：可信终端来源、真实Docker本地运行、文件传递、取消及失败回传；随后b实现允许卸载、规则/DQN决策、应用画像与反馈。a不是S5-04整体完成，也不把普通网关提交误当成允许卸载。

- 复用 `platform.Application`、ApplicationVersion、显式Binding、Execution/TaskRun/Attempt、Worker和结果队列。`container.execution` 默认 `CLUSTER`，显式 `TERMINAL` 表示必须在请求来源终端执行，本批不自动卸载。
- 来源只从已持久化的edge_submission及网关/终端归属读取，不接受Flow Input中的terminalId或Docker地址。普通用户、Schedule、没有接入回执的执行不能选择TERMINAL。
- 终端由管理员配置namespace/terminalId到Docker context。生产使用SSH context（需要网关中转时由SSH ProxyJump经过网关），不开放无认证Docker TCP；本机context仅用于开发测试。Docker context/凭据不进入Flow或任务镜像。
- 复用现有Application契约和digest镜像准备。终端通过所属网关EDGE集群的镜像仓库取镜像；数据集读取该集群登记的位置，经既有存储/文件接口暂存到终端，不新增终端伪集群或Dataset模型。
- 将Kubernetes和Docker真实共享的命令、文件接口、启动/结束包装提取到ContainerTask；两个运行器只管理实际容器生命周期。无第二个Executor或业务状态表。
- Worker使用原prepared_json冻结目标、digest、参数和文件。TaskRun/Attempt固定容器名；Worker接管不重复执行命令。终端连接中断不自动重放新任务，也不实现终端恢复协议。运行中断结果不明确仍由已有租约/取消机制处理，不报假成功。
- 修复S5-03 CONNECT→Application权限缺口：内部READ/EXECUTE仅授予已验证的接入执行、仅当前namespace；HTTP网关账号仍只有CONNECT。禁用接入不撤销已接受执行。

## 对照Kestra

参考本地Kestra `0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4`，`core/src/main/java/io/kestra/core/models/tasks/runners/TaskRunner.java`：任务命令与本地/远程runner分离，runner负责文件传输和停止。采用职责边界，不复制插件体系或另建调度链。

差异：终端来源和网关归属是云边端业务要求；外部Docker context和两种固定运行器是当前阶段的有意简化。不增加通用Runner SPI、Docker管理API、任意Docker参数、容器宿主挂载或Docker socket挂载。

Windows实测暴露Java ProcessBuilder默认legacy转义使内部引号丢失；参考[OpenJDK 21实现](https://github.com/openjdk/jdk21u/blob/master/src/java.base/windows/classes/java/lang/ProcessImpl.java)。因此Docker只接收固定引导命令，实际命令/环境以UTF-8脚本文件暂存到容器。POSIX单引号只在容器内保护参数，不通过宿主shell执行，不修改全局JVM转义属性或再造命令执行器。

## 文件与真实消费者

- runtime `FlowDefinition.Container.execution`、FlowValidator：保存/执行目标验证；ContainerTask、DockerTaskRunner：实际Docker命令、文件与取消；KubernetesJobRunner使用共享命令协议。
- edge `executionOrigin/workerActor`：Worker鉴权与终端配置选择；只读原有四表，无新表/列。
- dataflow `ApplicationTaskRunner.Prepared.dockerContext`：恢复时选择原Docker目标；只用原prepared_json，无新表/列。
- server `JobConfiguration.Settings.terminals`：管理员配置终端Docker context；server装配来源/权限，dataflow不依赖edge，模块依赖不变。

## 验收与尚未实现

必须验证网关真实Application链、来源伪造拒绝、本地真实镜像输出/文件回传、同Attempt接管、命令失败、取消/缺文件；普通Kubernetes链回归。Docker本机测试不代表物理终端/SSH多机验收。

本批不加入没有真实消费者的DQN字段、profile表或allowOffload占位开关。S5-04b仍需落实规则/DQN、画像/结果反馈、终端并发与远端容量决策，不能把a标为完整卸载能力。
