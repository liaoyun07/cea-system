# VER-S4-001 资源目录与候选本地性

## 范围与源码

2026-09-09，S4-01；涉及RES-001/RES-002部分能力和SEC-001现有权限回归。S4整体仍IN_PROGRESS，不含真实资源观测、Kubernetes Job、镜像准备、容量预约或脚本隔离。

基线提交071ff4b8fc61dbae5093e5369adcaa8634c3e474（S1–S3）。验证对象为该提交加本批未提交工作区改动；没有伪造新提交号或自动推送。新增5个生产Java文件、V6的3张资源表，具体路径及消费者见[Java索引](../01-code-architecture.md)。修改server装配/异常映射/Flyway配置、resource的spring-jdbc依赖，以及现有3个测试类；不增加项目模块依赖，不改变Execution主链。

职责参考及本项目业务差异见[ADR-0006](../decisions/ADR-0006-s4-resource-boundary.md)。本批是真实目录API，不是模拟Job执行。

## 环境

- Windows，JDK21.0.7：D:/IDE/IntelliJ IDEA 2025.1.3/jbr。
- Maven3.8.8：D:/developevn/maven/bin/mvn.cmd；保留父POM的Boot4.1.1依赖管理。
- Docker29.5.3，Testcontainers独立MySQL8.0.46（mysql:8.0）；无旧库连接或迁移。
- 无物理多云/真实Kubernetes任务验收；注册的测试集群只是数据库目录值。

## 可复现命令

在backend目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify.ps1 -JavaHome 'D:\IDE\IntelliJ IDEA 2025.1.3\jbr' -MavenCommand 'D:\developevn\maven\bin\mvn.cmd'
```

verify先检查模块/Java索引/链接，再执行Maven verify。报告在各模块target/surefire-reports（构建产物不提交）。

## 执行记录

首次编译因测试方法使用Java不允许的复合var声明失败；改为两条独立声明。随后Maven verify于17:50:53 +08:00通过，86项，0失败/错误/跳过。之后将位置写入失败注入固定在排序后第二条位置，确保覆盖已有位置写入后的整体回滚。

最终scripts/verify.ps1于18:01:48 +08:00退出0：86项，0失败/错误/跳过，Maven耗时约82秒，DurableWorkflowTest为75.833秒。结构检查通过8模块、48个生产Java索引、30个功能编号及150个本地链接。Surefire六份XML数量与结果核对一致，S4-01验收PASS。收尾仅更新本验证事实和进度，不改生产代码。

验证后docker ps按Testcontainers标签查询无残留容器，按本批BackendApplication测试类路径查询无残留测试Java进程。git diff --check通过（只有既有Windows换行转换提示）；HEAD仍为上述基线，本批未提交/推送。

| 测试类 | 数量 | 覆盖 |
|---|---|---|
| DefinitionTest | 10 | 定义/类型/绑定/模板 |
| LifecycleTest | 3 | 重试/阶段与纯决策 |
| ControlFlowTest | 6 | 控制树/并发/Cron |
| DurableWorkflowTest | 63 | 原52项真实MySQL执行测试与下列11项资源测试 |
| ContractTest | 3 | 19个路由、23个record字段映射/引用和示例 |
| ArchitectureTest | 1 | 模块方向与Controller不访问Repository |

新增资源测试验证：

1. 目录重启后可读，集群可禁用但不改数据集版本。
2. 同内容注册忽略位置顺序；同版本不可改格式/URI，新版本不影响旧版本。
3. 8个并发相同注册只形成一份版本及位置。
4. 两个并发不同内容只有一个成功，失败者409，不混合格式与位置。
5. MySQL trigger在第二条位置写入时抛错，版本与首条位置一并回滚，重试可成功。
6. 禁止引用其他namespace的集群，不残留版本记录。
7. 多个数据集按本地性取交集；候选预览不创建Execution。
8. 禁用、格式不符和缺本地数据三个原因分别累计，未知版本拒绝。
9. 拒绝重复ID/需求、非法版本、含凭据/参数/父路径的对象URI。
10. HTTP身份/READ/WRITE/namespace隔离，400/401/403/404/409/422行为及只读预览。
11. 分页边界、稳定排序与namespace隔离。

S1/S2升级保护测试会故意产生Flyway ERROR日志；以Surefire的断言结果判断，不能把该预期注入失败误当未处理的构建错误。

## 限制与剩余验收

只证明目录持久化和声明式约束有效，不证明对象存在、同版本各地点内容相同或数据不可变。没有启动真实Job，没有预约表，未测容量竞争、外部副作用恢复及跨云网络故障。Basic/READ/WRITE回归不是P04远程通信鉴权完成；P05/P06/P11仍随S4后续运行接入验收。未修改或启动/停止旧系统服务。
