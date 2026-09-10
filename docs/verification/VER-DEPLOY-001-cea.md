# VER-DEPLOY-001 CEA独立部署

## 对应范围

DEPLOY-01 / OPS-001：D盘Compose独立部署并真实运行FedAvg/FedProx；不做旧库导入/切换、吞吐指标或物理多云验收。

## 环境与版本

2026-09-11，Windows11/Docker Desktop WSL2；源码基线297e6bc，加本批部署文件/上传修正/数值审计脚本（纳入本记录所在提交）。JDK21/Maven3.8.8、Java容器Temurin21.0.12、Skopeo1.20、MySQL8.0、K3sv1.30.6-k3s1，MinIO/MC固定RELEASE标签，前端Nginx1.28-alpine。Docker数据盘已离线复制、全文件SHA256校验并切到`D:\DockerDesktop\DockerDesktopWSL`；C盘原件保留，未清理其占用。

## 执行与结果

- 完整 `scripts/verify.ps1`：修正上传后04:20:01再次通过，212项Maven，0失败/错误/跳过（先前03:46:43的回归不替代本次结果）；真实隔离MySQL/K3s/Registry/MinIO及JAR验证。算法/卸载Python测试另有12项，见target证据。
- 前端9项Node单元测试和Vite生产构建通过。
- Compose专用空库成功执行17项Flyway迁移；12个常驻容器启动。
- 后端UID10001，配置/凭据只读挂载，无宿主Docker socket。
- 未认证前端代理API与Registry均返回401；四个ServiceAccount可list nodes，不能读取default namespace secrets。
- 两算法真实执行、数值/浏览器/整组重启复核：**PASS**，以下为实际结果，不包含旧系统切换。

## 联邦算法实际结果

同一真实MNIST训练集60000条，三个互不重叠、按标签排序分片分别10000/20000/30000；独立测试10000条。每算法2轮，每客户端每轮1 epoch、batch32、lr0.01，FedProx mu=0.1，seed13。云端init→Repeat(Loop(三个边缘train)→云aggregate→云evaluate)→反馈；每算法14个TaskRun（含控制节点）、11个实际成功Job。没有固定到单个集群冒充四集群。

| 算法 | Execution ID | 真实执行时间（本地+08:00） | 第1/2轮准确率 | 第1/2轮loss | 数值复核 |
|---|---|---|---|---|---|
| FedAvg | 71f3c4de-9fe1-4e66-b5ed-a9969e796237 | 04:20:33–04:21:23 | 0.5318 / 0.6229 | 1.369264 / 1.103557 | PASS |
| FedProx | de5e03eb-c343-4643-b47e-219110a230e1 | 04:22:46–04:23:33 | 0.5812 / 0.6346 | 1.348799 / 1.056201 | PASS |

复核从新MinIO取回每轮全部模型/指标文件，独立重算每客户端训练张量、按真实样本数加权聚合与全局测试。检查两轮模型确实变化、baseRound正确、数据分片不重叠。两轮功能验收不等于充分收敛、算法性能排名或吞吐达标。

新算法镜像中心上传后，经原分发服务按应用ID/digest进入三个边缘Registry。实际Job所用镜像从对应Registry读取digest均为 `sha256:4be6695009acdaed67303869a7d5c5aed9a59bb4920fd58ec053b53a7b79928e`；不是复制旧Harbor中的业务镜像。

04:26–04:27将12个CEA服务完整stop/start（未down -v、未重启/切换旧Harbor）。四K3s恢复Ready；两个Flow r1及四条执行的状态/输出保持一致，早期FAILED/KILLED仍保留。使用同ExecutionId重新下载22个成功Job的全部产物并数值复核PASS；04:28:03再次浏览器检查PASS。没有重提业务执行掩盖丢失数据。

浏览器实测登录、两Flow/YAML Loop、两SUCCESS详情、每算法6个训练实例、最终输出通过，页面无JS异常。**现有限制**：Application Pod stdout未进入Execution日志，API返回空数组，页面正确显示暂无日志；未虚构日志或临时插入Log任务来凑通过。容器日志仍通过对应集群kubectl读取，日志采集留待另行授权。

## 保留的失败与修正

1. 最初K3s健康命令 `k3s kubectl` 在该容器PATH中报重复子命令；改为实际可用的 `kubectl get --raw=/readyz`，四节点Ready/健康检查通过。
2. 初始Ubuntu jammy apt Skopeo1.4.1不支持现有代码的 `--no-tags`/`--preserve-digests`，FedAvg执行2799a60e-d4bf-445c-81fd-3f6dec5bb665在创建Job前阻塞，人工通过原API取消，终态KILLED，记录保留。尝试拉取新版Ubuntu基础镜像又遭遇Docker Hub认证连接EOF。
3. 改为固定Skopeo1.20基础镜像组合官方Java21 JRE，构建时校验参数；不加入Java旧版兼容分支。后端重建后真实带认证digest读取通过。
4. 数值审计仅移除固定256条测试样本的假设，改从真实文件读取样本数；未改变算法和指标口径。
5. 第二次FedAvg ecb8b9ad-2ec3-498f-bbd9-cf7c3d6f2a30的云初始化完成，但边缘输入传输反复失败，最终FAILED/attempt timed out。Fabric8 Path上传创建带UID/GID的tar，非root后端文件属主无法由drop ALL capabilities的Pod恢复；文件已出现不代表上传完成。`KubernetesJobRunner.upload`改为原库InputStream上传，传字节而不传宿主归属，保持Pod权限与同一执行主链；完整回归和非root Linux实跑均通过。没有新增表/字段/API/SPI或第二执行链。
6. 新验收脚本最初用`@(Invoke-RestMethod ...)`包装数组，导致叶子数量误判；改为读取原数组，并支持ExecutionId复核已有成功执行，不靠重跑任务隐藏脚本问题。浏览器断言修正实际表格含UUID的单元格定位及请求baseURL；按真实API验证空日志，没有改前端业务代码。

## 证据与限制

本地证据在 `.local/cea/`（含失败执行记录、真实数据与产物，不提交Git）：mnist/manifest.json、registry-digests.json、两算法execution/tasks/11份Job/模型/numerical-audit.json、browser截图/result.json、restart-before/after.json。Docker物理迁移证据与回退配置保存在`D:\DockerDesktop\migration-20260911`。

PowerShell六个脚本语法、Compose config、Node脚本语法、文档结构链接及git diff检查通过；发布前扫描本批文件不包含生成的六项真实密码。`.env`/secrets/.local被Git与构建上下文排除。

当前服务保持运行。单机多集群和中央存储不是跨地域物理多云；S7旧业务迁移/切换、HA/自动备份/TLS、物理终端网关、Pod stdout采集、DQN与速率不在本次范围。
