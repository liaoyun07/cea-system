# S5-04a 终端 Docker 执行

本文维护终端Docker执行基础；S5-04b已增加[显式卸载/画像/队列协议](s5-terminal-offloading.md)。下面无offload时仍必须本地执行。没有S5-05计量SDK。

## 一份Flow、一份Application

`platform.Application`新增可选 `container.execution`：

- `CLUSTER`（默认）：必须声明candidateClusters，保持已有Kubernetes执行/资源槽语义。
- `TERMINAL`：不得声明candidateClusters；从实际网关提交回执确定来源终端。必须通过现有edge-access接口提交，不能由普通用户/Schedule伪造来源。不会因终端繁忙或离线而自动卸载。

[完整示例](../../examples/s5-terminal-flow.yaml)中第一步在终端生成文件，第二步在边缘处理同一文件。仍使用INPUT/VARIABLE/TASK_OUTPUT/LITERAL/ITEM；无需另一份应用契约或终端程序映射。

示例要求预先登记`shell-tools/v1`，镜像提供`sh`、`printf`、`wc`，契约声明STRING参数`GREETING`并带默认值；第二步使用默认值，不重新定义应用。示例不是后端自动注册的内置模板。

## 管理员配置

1. 通过既有API登记EDGE集群、网关CONNECT账号及终端，例如lab下terminal-pc归属gateway-a。
2. Worker主机安装Docker CLI；终端安装Linux Docker Engine。按[Docker官方SSH连接说明](https://docs.docker.com/engine/security/protect-access/)建立并测试context，例如：

   ```powershell
   docker context create cea-terminal-pc --docker host=ssh://cea-runner@terminal-pc
   docker --context cea-terminal-pc info
   ```

   SSH用户名须能访问终端Docker socket。需要经过网关时，在该主机SSH配置中为terminal-pc设置ProxyJump；不将SSH地址、私钥或Docker socket写进Flow。生产不用裸TCP、关闭主机校验或业务镜像挂载Docker socket。Docker控制凭据等同高权限，应只由受信Worker持有。
3. 使用外部Spring配置：`platform.jobs.terminals.lab.terminal-pc.docker-context=cea-terminal-pc`和`platform.jobs.terminals.lab.terminal-pc.slots=1`。04b将原字符串改为对象，不保留双格式。namespace/terminal ID须与登记一致；所有Worker必须具备同名同目标context及相同slots。进行中的执行未排空前不要重定向context。
4. 配置该网关所属EDGE集群的既有镜像分发目标及S3存储。Worker进程使用的Docker CLI凭据配置须能拉取目标仓库；终端必须能访问目标仓库并信任其TLS。账号/凭据只放部署配置，不传入算法环境变量。

后端仍只开放原有接入/管理API，没有Docker管理或Worker HTTP接口。本机context仅适合开发验证；单机Docker-in-Docker测试不代表SSH/ProxyJump或真实多机验证。

部署前先排空现有执行，统一更新新后端API/Executor/Worker；不混跑不认识新字段的旧Worker。04a本身无数据库迁移，当前04b增加V14/V15，只用于新后端专用库；不启动或替换旧工程服务。

## 文件、命令和结果

与Kubernetes使用同一份ContainerTask协议：输入`/cea-work/in/<name>`，输出`/cea-work/out/<name>`，工作目录`/cea-work`。镜像需要/bin/sh、tar、sleep；没有新增SDK。环境变量来自已验证的Application参数。

数据集参数仍受Application DatasetRule约束。终端读取所属网关集群登记的数据集对象，经原ObjectStorage和Docker文件接口暂存；并非创建一个TERMINAL类型的伪集群或宣称文件已经在终端。数据集路径和中间产物各自保持现有命名文件语义。

Docker容器禁用业务网络、drop ALL capabilities、不挂载宿主路径或Docker socket。镜像拉取由daemon完成，业务命令只处理已暂存文件；网络型算法不在本批支持范围。

Docker通过文件传递实际命令和参数：先复制UTF-8脚本，再原子发布ready标志。避免Windows宿主命令行吞掉引号/换行；参数在容器内按字面量导出，不让参数值变成宿主命令。共享包装仍是同一份ContainerTask，不改变Kubernetes既有命令语义。

准备完成后将clusterId、dockerContext、digest、参数及文件存入原Worker prepared_json。容器名为`cea-<TaskRunId>-a<Attempt>`，业务命令最多由该容器的启动标志触发一次。Worker中断后接管相同容器，已经发布的文件通过原S3产物前缀查询，不另建Execution。

成功必须命令退出0且全部声明产物发布成功；退出非0或缺文件返回真实失败。取消/超时停止容器后才交给Executor推进Finally。取消不删除已产生的用户产物。已结束容器保留用于同Attempt结果确认，运维只在对应Execution终态且无接管需求后清理，不自动prune用户Docker。

终端/SSH失联不是业务成功，也不盲目启动新Attempt；没有离线补发、断点续跑或恢复ACK。平台无法连接终端时无法证明远端停止，故不会提前宣称取消完成。当前04b终端FIFO是另一层平台容量，不等同全局Worker并发或CPU/内存物理预约。

与Kubernetes路径相同，禁止在活跃Attempt期间外部强删容器；强删后不存在跨远端销毁的exactly-once保证。该运维边界没有通过新增业务状态表掩盖。

## 权限修复

S5-03提交时临时使用READ/EXECUTE，但Worker原先按submittedBy重新取到CONNECT账号，导致真实Application无法读取目录。现在server通过edge公开服务检查`edge_submission → edge_terminal → edge_gateway`与提交账号，生成只覆盖当前namespace的内部执行Actor。HTTP账号仍只有CONNECT，不能直接读写目录；禁用接入不撤销此前已接受执行。

## 数据与边界

04a无新表/迁移/HTTP API/第二套Binding；当前04b表/API增量以卸载协议为准。Container.execution用于目标校验、Prepared.dockerContext/terminalId用于接管和释放正确终端、Settings.terminals用于部署连接和容量选择。Origin/TerminalTarget是内部方法返回值，不是HTTP record。Executor、TaskRun、Attempt和状态归并主链不变。基础对照见[ADR-0015](../decisions/ADR-0015-terminal-docker.md)。
