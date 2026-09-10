# VER-S5-005：S5-04a终端Docker与可信接入执行

日期：2026-09-10；基线`11b605ae427691761014adbe5d18daf9aa730648`，本记录对应其后的S5-04a工作区，最终提交由Git追溯。S5-04整体未完成，规则/DQN、画像及反馈仍未实现。

## 范围与环境

Windows、JDK21.0.7（IDEA JBR）、Maven3.8.8；Docker Desktop29.5.3。Testcontainers创建独立MySQL8、Registry2、Skopeo1.20、MinIO、K3s1.30.6及Docker28-dind终端引擎。使用真实镜像/命令/文件和同一Worker；无业务成功mock。

Docker-in-Docker只为隔离测试终端，测试TCP端口随机映射到127.0.0.1。临时context显式命名并于测试结束删除，不切换用户当前context，不改用户Dockerdaemon配置。生产协议要求SSH或受认证TLS；尚未做SSH/ProxyJump及物理终端验证。

## 过程记录（不隐藏失败）

- 18:05:52首轮定向测试失败：15项Definition、17项Edge、3项Contract、1项Architecture及5项容器场景，共41项，4项容器场景超时。其余37项通过。Docker Hub首次拉取EOF重试后取得官方docker:28-dind镜像；不是跳过测试。
- 排查发现Windows Java ProcessBuilder默认legacy命令行转义丢失内嵌引号；先移除Docker label查询中的内嵌引号。18:08:31单场景复测仍失败，暴露实际业务脚本同样被改写，虽容器退出0却缺少声明产物；系统正确拒绝成功。
- 改为固定bootstrap及UTF-8脚本传输，显式参数按POSIX字面量写入容器脚本；不在宿主shell运行，不改全局JVM属性。另加引号、中文、多行及命令替换字面量回归。
- 18:13:52第三轮5项容器场景中3项通过、2项测试等待超时：本地→边缘真实文件链及非零/缺文件失败已通过；取消/接管测试驱动只推进了一次Executor，未等任务派发就调用runOnce。改为与现有集群测试一致，等TaskRun进入RUNNING再启动测试Worker；取消测试进一步等待算法命令自己的executing标志，避免只测bootstrap启动。
- 18:15:50取消/同Attempt接管/复杂参数3项定向复测全部通过。随后增加数据集契约本地读取、真正算法运行中的取消、显式retry与timeout回归，进入全量verify。
- 18:26:58首轮全量verify未通过：ImageDistributionTest共30项，29项通过、1项断言失败。超时用例实际得到既有Executor的`attempt timed out`，测试错误检查`timeout`；已将断言改为`timed out`，不为适配断言改变生产超时语义。其余容器/联邦学习场景通过，但本轮没有完成后续JAR验收，不能称为全量PASS。
- 18:31重新执行标准verify，包含修正后的超时断言与全部既有回归；18:41:25完成，BUILD SUCCESS，退出码0。175项Maven测试零失败/错误/跳过，7项Python数值测试通过。30项真实镜像/Job/Docker场景全部通过，随后实际打包JAR空库启动验收通过。

## 最终结果：PASS（仅S5-04a）

| 测试范围 | 本轮数量 | 结果 |
|---|---:|---|
| runtime定义、生命周期、控制流 | 31 | PASS |
| 持久化/队列/重试/故障恢复 | 86 | PASS |
| 网关/终端/策略接入 | 17 | PASS |
| 真实Registry/K3s/Docker/文件/联邦学习 | 30 | PASS |
| HTTP/SQL | 6 | PASS |
| 协议与示例 | 3 | PASS |
| 架构约束 | 1 | PASS |
| 实际打包JAR启动 | 1 | PASS |
| Python算法数值单测（另计） | 7 | PASS |

FedAvg与FedProx各两轮数值审计均为PASS；证据保存在本轮`platform-server/target/federated-evidence`，构建产物不上传仓库。MySQL短时断连及迁移拒绝日志来自预期故障注入，最终所属测试通过。代码/文档结构检查与`git diff --check`通过；源码版本由本记录所在Git提交确定。

## 验收项目

1. CONNECT网关的原始执行关系必须存在；不同网关、无回执、错误namespace与普通用户不能借用内部READ/EXECUTE。既有已接受执行不因接入禁用失权。
2. 网关提交的终端Docker产生实际文件，经S3进入边缘Kubernetes任务并核对最终字节内容；证明真实Application权限链，不是只测试Log。
3. 本地真实非零退出及显式retry、缺文件失败；取消/超时停止后执行Finally。
4. Worker中断/同Attempt接管保留容器ID，文件只有一次写入，无新业务Attempt。
5. Windows引号/换行/中文环境参数原样传递，不执行参数中的命令替换。
6. 原Kubernetes、Loop、Repeat、FedAvg/FedProx和部署故障全量回归；协议、源码索引和模块依赖检查。

## 复现命令

在backend仓库根目录，确保Docker Engine和CLI可用：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1 -JavaHome 'D:\IDE\IntelliJ IDEA 2025.1.3\jbr' -MavenCommand 'D:\developevn\maven\bin\mvn.cmd'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-scaffold.ps1
git diff --check
```

完整verify包含真实FedAvg/FedProx两轮和打包JAR启动，不用定向测试数量冒充全量覆盖。中途生成的旧Surefire报告不能当作尚在运行的新一轮结果；以本轮Maven最终退出和所有报告时间为准。

## 边界

本批无新数据库表/列/迁移、HTTP API、第二套Binding/Executor/Worker链。新增ContainerTask、DockerTaskRunner两份生产Java，当前78份。未实现卸载规则/DQN/应用画像、终端容量队列、计量SDK、物理终端/真实多云或性能验收；不改旧服务/数据库/镜像。
