# VER-S0-001 工程和文档框架验证

日期：2026-09-08。结果：PASS，仅针对S0脚手架。关联：FND-001、S0-01至S0-05。业务测试数量为0，所有业务功能尚未开始。

## 环境与版本

Windows 11 amd64；PowerShell 5.1；Maven 3.8.8。验证JDK为IDEA已有的JetBrains Runtime/JDK 21.0.7，路径 D:/IDE/IntelliJ IDEA 2025.1.3/jbr。默认旧环境仍为D:/developevn/jdk8（Temurin 1.8.0_492）。

父目录存在空.git目录但不是有效Git仓库；旧web-platform是独立仓库。本次未初始化或提交Git。构建输入以[SHA256清单](S0-source-sha256.md)追溯。

## 结果

| 检查 | 实际结果 |
|---|---|
| 模块/依赖检查 | 8模块；POM与文档一致，依赖无环 |
| Java文件索引 | 8份生产Java，全部为package-info.java，无业务类 |
| 功能与文档检查 | 30个唯一功能编号；本地链接有效 |
| JDK21 Maven verify | 父工程+8子模块全部SUCCESS，进程退出0；首次构建耗时14.901秒 |
| 业务测试 | 0；各模块输出No tests to run，不算业务通过 |
| JDK8负向验证 | Maven Enforcer拒绝，Maven退出1，符合预期 |
| 环境恢复 | 捕获预期失败后JAVA_HOME/PATH与运行前相同，仍为旧JDK8 |
| 外部副作用 | 没有启动服务/Docker、连接业务数据库、改旧代码或推镜像 |

首次检查遇到PowerShell单XML节点索引错误，修正为显式数组后重跑通过。该问题仅属于新建检查脚本，不涉及业务实现。

## 可复现命令

在backend目录：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-scaffold.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify.ps1 -JavaHome 'D:\IDE\IntelliJ IDEA 2025.1.3\jbr'
```

其他机器替换为本机JDK21路径。构建插件版本在POM锁定；首次运行需可下载Maven插件。

负向验证在同一个PowerShell进程中记录JAVA_HOME/PATH，调用verify.ps1指定JDK8，捕获异常，再比较环境。预期消息：

```text
Detected JDK version 1.8.0-492 ... is not in the allowed range [21,22).
EXPECTED_REJECTION: Maven verify failed: 1
ENVIRONMENT_RESTORED: JAVA_HOME=D:\developevn\jdk8
```

## Maven实际结束摘要

```text
Cloud Edge Terminal Backend ... SUCCESS
workflow-runtime ............... SUCCESS
platform-foundation ............ SUCCESS
platform-resource .............. SUCCESS
platform-deployment ............ SUCCESS
platform-offloading ............ SUCCESS
platform-edge .................. SUCCESS
platform-dataflow .............. SUCCESS
platform-server ................ SUCCESS
BUILD SUCCESS
Total time: 14.901 s
Finished at: 2026-09-08T16:57:17+08:00
```

## 未验证范围

没有数据库事务/恢复测试、API测试、K8s执行、真实多云、终端卸载或算法指标验证。没有类级架构测试，因为当前没有业务类。本记录只支持S0完成，不支持S1或任何业务功能验收。

